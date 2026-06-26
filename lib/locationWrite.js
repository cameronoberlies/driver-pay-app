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
        });
      return { success: false, error };
    }
    return { success: true };
  } catch (e) {
    // Network / unexpected throw. Different signal than RLS rejection above —
    // tag separately so dashboards can split them.
    await logWithClient(client, 'error', 'driver_location_write_threw',
      `driver_locations upsert threw: ${e?.message || 'unknown'}`,
      {
        source,
        app_state: appState || 'unknown',
        driver_id: driverId,
        error_message: e?.message || 'unknown',
        fix_age_ms: fixAgeMs,
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
