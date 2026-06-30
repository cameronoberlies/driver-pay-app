// Provenance-stamped write to driver_locations.
//
// Every write site in the app (foreground watcher, BG location task, BLE
// heartbeat, geofence, silent-push wake, SLC restart) must go through this
// helper. It does three things the raw upsert never did:
//
//   1. Stamps `source`, `fix_age_ms`, and `app_state` so the row carries its
//      own provenance and we can finally answer "which path is carrying which
//      driver" instead of guessing.
//   2. Catches and EXPLICITLY logs upsert errors (auth/RLS rejection, network
//      failure) to system_logs. The audit identified silent failures here as
//      the most likely reason we couldn't tell "iOS never woke us" from
//      "iOS woke us but Supabase rejected the write".
//   3. Optionally adds a Sentry breadcrumb so a later crash report shows the
//      last few writes leading up to it.
//
// IMPORTANT: this helper does not yet change behavior beyond instrumentation.
// Phase 1 of the audit response is "see what's actually happening". Behavior
// fixes (token refresh hardening, switching to a modern Core Location API)
// land in Phase 2 once we have 5 days of source-tagged data.

import { logEvent } from './systemLog';

// Offline write queue. When a network failure rejects a write we don't drop
// the fix — we stash it in AsyncStorage and replay on the next successful
// write (which proves connectivity is back). Phase 1 data showed network
// failures were the largest remaining category of real rejections
// (~4,700/5 days), so this is the bulk of the residual stale-tracking fix.
const QUEUE_KEY = 'driver_locations_offline_queue';
const QUEUE_MAX = 50;          // most we'll ever buffer per driver before dropping
const QUEUE_MAX_AGE_MS = 30 * 60 * 1000; // drop fixes older than 30 min — dispatch doesn't care
let asyncStorage = null;
function getAsyncStorage() {
  if (asyncStorage) return asyncStorage;
  try { asyncStorage = require('@react-native-async-storage/async-storage').default; } catch {}
  return asyncStorage;
}

function isNetworkError(err) {
  if (!err) return false;
  const msg = err.message || String(err);
  return /network request failed|network request timed out|Failed to fetch|TypeError: Network/i.test(msg);
}

async function enqueueOffline(row) {
  const AS = getAsyncStorage();
  if (!AS) return;
  try {
    const raw = await AS.getItem(QUEUE_KEY);
    const queue = raw ? JSON.parse(raw) : [];
    queue.push({ ...row, _queued_at: Date.now() });
    // Keep newest QUEUE_MAX so memory doesn't grow unbounded if the driver is
    // offline for hours. We'd rather have the most recent fixes than the oldest.
    const trimmed = queue.length > QUEUE_MAX ? queue.slice(-QUEUE_MAX) : queue;
    await AS.setItem(QUEUE_KEY, JSON.stringify(trimmed));
  } catch {}
}

async function drainQueue(client) {
  const AS = getAsyncStorage();
  if (!AS || !client) return { drained: 0, dropped: 0 };
  let queue = [];
  try {
    const raw = await AS.getItem(QUEUE_KEY);
    if (!raw) return { drained: 0, dropped: 0 };
    queue = JSON.parse(raw);
  } catch { return { drained: 0, dropped: 0 }; }
  if (!Array.isArray(queue) || queue.length === 0) return { drained: 0, dropped: 0 };

  const now = Date.now();
  const fresh = queue.filter(r => (now - (r._queued_at || 0)) < QUEUE_MAX_AGE_MS);
  const dropped = queue.length - fresh.length;
  let drained = 0;
  const stillQueued = [];

  for (const row of fresh) {
    const { _queued_at, ...payload } = row;
    payload.source = (payload.source || '') + '_replay';
    try {
      const { error } = await client.from('driver_locations').upsert(payload, { onConflict: 'driver_id' });
      if (error) { stillQueued.push(row); } else { drained++; }
    } catch { stillQueued.push(row); }
  }

  try { await AS.setItem(QUEUE_KEY, JSON.stringify(stillQueued)); } catch {}

  if (drained > 0 || dropped > 0) {
    try {
      await client.from('system_logs').insert({
        source: 'mobile', level: 'info', event: 'offline_queue_drained',
        message: `Drained ${drained} queued writes, dropped ${dropped} stale`,
        metadata: { drained, dropped, remaining: stillQueued.length },
        created_at: new Date().toISOString(),
      });
    } catch {}
  }
  return { drained, dropped };
}

// Internal: write a system_logs row using a specific client. We can't always
// use the shared supabase singleton (the BG task has its own client built
// from AsyncStorage-cached credentials) — if we did, a stale-token failure
// at the upsert would also fail the log, blinding us to the very problem
// we're trying to surface.
async function logWithClient(client, level, event, message, metadata) {
  if (!client) {
    // Fall back to the shared logger if no client was provided.
    logEvent(level, event, message, metadata);
    return;
  }
  try {
    await client.from('system_logs').insert({
      source: 'mobile',
      level,
      event,
      message: message || null,
      metadata: metadata || {},
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    // Last resort — don't let logging failures break the caller.
    console.log('[locationWrite] log failed:', e?.message);
  }
}

// Allowed source values — keep in sync with the columns documented in
// 20260619_location_provenance.sql. Adding a new path? Add it here and in the
// dashboards that query the source column.
export const LOCATION_SOURCES = Object.freeze({
  FG_WATCH: 'fg_watch',           // foreground watchPositionAsync
  BG_TASK: 'bg_task',             // background-location-task
  BLE_HEARTBEAT: 'ble_heartbeat', // OBD BLE PID notification path
  GEOFENCE: 'geofence',           // GeofenceManager (arrival auto-end)
  SLC: 'slc',                     // significant-location-change-task restart
  SILENT_PUSH: 'silent_push',     // silent-push wake handler
  TRIP_START: 'trip_start',       // initial write when a trip starts
  MODERN_BG: 'modern_bg',         // iOS 17+ CLLocationUpdate.liveUpdates path
});

// Pass the supabaseClient explicitly because the BG task can't import the
// shared lib/supabase singleton (different AsyncStorage / session handling).
// The main app and the silent-push wake handler should pass the shared client.
export async function writeDriverLocation({
  client,
  driverId,
  latitude,
  longitude,
  source,
  fixTimestamp,   // ms since epoch the GPS fix was captured; null if not from GPS
  appState,       // 'active' | 'background' | 'unknown'
  extra = {},     // optional: obd_speed, obd_rpm, obd_fuel, obd_updated_at, etc.
}) {
  if (!client || !driverId || latitude == null || longitude == null || !source) {
    return { success: false, error: new Error('writeDriverLocation: missing required args') };
  }
  const now = Date.now();
  // iOS hands us fractional millisecond timestamps (e.g. 1782141202999.5625).
  // fix_age_ms is an INTEGER column, so floor the difference. Without this,
  // Postgres rejects the write with 22P02 and the row never lands — which
  // poisons exactly the rejection numbers we're trying to interpret.
  const fixAgeMs = fixTimestamp ? Math.floor(Math.max(0, now - fixTimestamp)) : null;
  const row = {
    driver_id: driverId,
    latitude,
    longitude,
    updated_at: new Date(now).toISOString(),
    source,
    fix_age_ms: fixAgeMs,
    app_state: appState || 'unknown',
    ...extra,
  };
  try {
    const { error } = await client.from('driver_locations').upsert(row, { onConflict: 'driver_id' });
    if (error) {
      // Network failure? Stash the row and try again on the next successful
      // write. We don't queue auth/RLS/validation rejections — replaying those
      // would just rejected again. Only transient connectivity issues belong
      // in the queue.
      if (isNetworkError(error)) {
        await enqueueOffline(row);
      }
      // The exact distinction the audit asked for: write was attempted but
      // rejected. Tag the source + app_state so we can correlate.
      await logWithClient(client, 'error', 'driver_location_write_rejected',
        `driver_locations upsert rejected: ${error.message}`,
        {
          source,
          app_state: appState || 'unknown',
          driver_id: driverId,
          error_code: error.code || null,
          error_message: error.message,
          fix_age_ms: fixAgeMs,
          queued: isNetworkError(error),
        });
      return { success: false, error };
    }
    // Success — opportunistic drain. If there are queued writes from a recent
    // offline period, replay them now. Fire-and-forget so we don't block the
    // hot path; if the drain fails the queue stays put until next success.
    drainQueue(client).catch(() => {});
    return { success: true };
  } catch (e) {
    // Thrown exception (almost always a network error). Queue and tag.
    if (isNetworkError(e)) {
      await enqueueOffline(row);
    }
    await logWithClient(client, 'error', 'driver_location_write_threw',
      `driver_locations upsert threw: ${e?.message || 'unknown'}`,
      {
        source,
        app_state: appState || 'unknown',
        driver_id: driverId,
        error_message: e?.message || 'unknown',
        fix_age_ms: fixAgeMs,
        queued: isNetworkError(e),
      });
    return { success: false, error: e };
  }
}

// Lightweight event for "this path fired, regardless of whether it wrote".
// The presence of provenance rows answers "did this path succeed". This event
// answers "did this path even fire". Together they distinguish "iOS never
// woke us" from "iOS woke us but the write failed" from "everything worked".
export async function logPathFired(source, metadata = {}, client = null) {
  await logWithClient(client, 'info', 'location_path_fired',
    `Location path fired: ${source}`,
    { source, ...metadata });
}
