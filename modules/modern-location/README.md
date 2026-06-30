# modern-location

Local Expo native module that wraps iOS 17+ `CLLocationUpdate.liveUpdates()` + `CLBackgroundActivitySession`. Built in response to the stale-tracking audit (see repo-root `STALE_TRACKING_AUDIT.md`).

## Why this exists

`expo-location`'s background task uses Apple's legacy `CLLocationManager` + `allowsBackgroundLocationUpdates` API. That API has two documented failure modes that match the stale-pin symptom on this fleet:

1. **Pause-on-stationary without resume.** When iOS decides the device is stationary it pauses background updates. The legacy API delivers a "did pause" event, but a suspended app cannot programmatically resume itself — only foregrounding the app brings it back.
2. **No relaunch after termination.** If iOS kills the process, the legacy background task is gone until the user reopens the app.

The modern API (`CLLocationUpdate.liveUpdates()` consumed inside a held `CLBackgroundActivitySession`) is documented to:

- Auto-resume the stream when movement returns after a stationary pause.
- Relaunch the app after termination if the session was active.

Per-driver instrumentation from Phase 2 confirmed at least two drivers going completely silent mid-trip on the legacy path while iOS was actively waking *other* drivers. That's the audit's "Suspect A" — selective rather than fleet-wide.

## What this module does NOT do

- It does not replace `expo-location` for the foreground watcher, geofence, SLC restart, or anything Android. Those keep working as-is.
- It does not change the data shape. The JS API exposes `LocationUpdate` events that look like an expo-location `LocationObject`, so the wire-up into the existing four-paths code is small.
- It does not depend on `expo-location` at runtime — but you should still use `expo-location` to *ask* the user for "Always" permission before calling `startBackgroundSession`. The session inherits whatever Location authorization the OS has granted; if it's "When in use" the session will be terminated as soon as the app backgrounds.

## API

```ts
import {
  getModernLocation,
  subscribeToLocationUpdates,
  subscribeToStateChanges,
  subscribeToErrors,
} from 'modern-location';

const mod = getModernLocation();
if (mod && mod.isAvailable()) {
  const sub1 = subscribeToLocationUpdates((u) => {
    // u.latitude, u.longitude, u.timestamp, u.speed, ...
  });
  const sub2 = subscribeToStateChanges((s) => {
    // s.state === 'stationary' | 'active'
  });
  const sub3 = subscribeToErrors((e) => {
    // e.code === 'authorization_revoked' | 'stream_error'
  });

  await mod.startBackgroundSession();  // MUST be called from foreground

  // ... later, when the trip ends:
  await mod.stopBackgroundSession();
  sub1.remove(); sub2.remove(); sub3.remove();
}
```

`getModernLocation()` returns `null` on non-iOS or when the module isn't compiled into the running native build. `isAvailable()` returns `false` on iOS < 17.

## Caveats (from the audit, all real)

- **Foreground-only session start.** Calling `startBackgroundSession()` from the background will fail. The integration must guarantee the call happens while the app is foregrounded.
- **Session/stream reference management.** The module holds the `CLBackgroundActivitySession` in `sessionStorage` for the active lifetime, and cancels the update `Task` on stop. Failing to do this leaks the persistent blue-bar indicator and drains battery. The `deinit` is the belt-and-suspenders backstop.
- **Stationary pauses still happen.** They just don't kill the stream. The `onStateChange` event surfaces them so JS can log them but the stream resumes automatically on movement.

## Build

This is a local Expo module — no `npm install` needed. The Expo prebuild step picks up `modules/modern-location` automatically. Run a native build via EAS (`production` profile) to ship it. Once compiled, `requireNativeModule('ModernLocation')` resolves on iOS 17+ devices; on older iOS it throws, which `getModernLocation()` catches and returns `null` from.

## Integration status

- [x] Module skeleton + Swift implementation + JS API
- [ ] Wire into `MyTripsScreen.js` as the iOS-17+ background path
- [ ] Provenance: tag writes with `source: 'modern_bg'` and `'modern_bg_replay'`
- [ ] Verify in dev build (`expo run:ios`) before production rebuild
- [ ] Compare per-driver fire rates: `bg_task` (legacy) vs `modern_bg`
