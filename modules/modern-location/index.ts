// JS API for the modern-location native module.
//
// The native side wraps iOS 17+ CLLocationUpdate.liveUpdates +
// CLBackgroundActivitySession. We expose a small surface here: query
// availability, start/stop the background session, and subscribe to
// location/state/error events.
//
// Integration plan (next commit, not this one):
//   - On iOS 17+: this module replaces the expo-location background-task
//     leg of the four-paths tracking system. The foreground watcher,
//     BLE heartbeat, SLC restart, and silent-push wake stay as-is and
//     remain useful as defence-in-depth.
//   - On iOS < 17 or Android: this module is unavailable; the existing
//     expo-location background task remains the only background path
//     (same behaviour we have today).
//
// Provenance: when wired into the location pipeline, hits from this
// module should be tagged with `source: 'modern_bg'` so Phase 1
// instrumentation can compare the new path against the legacy one in
// the same dashboards.

import { NativeModule, requireNativeModule, EventSubscription } from 'expo';
import { Platform } from 'react-native';

export type LocationUpdate = {
  latitude: number;
  longitude: number;
  /** ms since epoch — same units as JS Date.now() */
  timestamp: number;
  /** meters; -1 if unavailable */
  horizontalAccuracy: number;
  verticalAccuracy: number;
  /** m/s; -1 if unavailable */
  speed: number;
  /** degrees from true north; -1 if unavailable */
  course: number;
  altitude: number;
  isStationary: boolean;
};

export type StateChange = {
  state: 'stationary' | 'active';
  authorization: string;
};

export type ModernLocationError = {
  code: 'authorization_revoked' | 'stream_error' | string;
  message: string;
};

declare class ModernLocationModuleType extends NativeModule<{
  onLocationUpdate: (event: LocationUpdate) => void;
  onStateChange: (event: StateChange) => void;
  onError: (event: ModernLocationError) => void;
}> {
  /** True if CLLocationUpdate.liveUpdates is available (iOS 17+). False elsewhere. */
  isAvailable(): boolean;
  /** Must be called from foreground. Idempotent. */
  startBackgroundSession(): Promise<{ started: boolean; reason?: string }>;
  /** Safe to call even if not started. */
  stopBackgroundSession(): Promise<void>;
}

let cached: ModernLocationModuleType | null = null;

/**
 * Returns the native module if available on this platform/OS, otherwise null.
 * Callers should null-check before using.
 */
export function getModernLocation(): ModernLocationModuleType | null {
  if (Platform.OS !== 'ios') return null;
  if (cached) return cached;
  try {
    cached = requireNativeModule<ModernLocationModuleType>('ModernLocation');
    return cached;
  } catch {
    // Module not present in this build (e.g. older runtime that predates the
    // native rebuild that included this module). Caller falls back to
    // expo-location.
    return null;
  }
}

/**
 * Convenience: subscribe to location updates and return an EventSubscription
 * for cleanup. Returns null if the module isn't available.
 */
export function subscribeToLocationUpdates(
  handler: (update: LocationUpdate) => void
): EventSubscription | null {
  const mod = getModernLocation();
  if (!mod) return null;
  return mod.addListener('onLocationUpdate', handler);
}

export function subscribeToStateChanges(
  handler: (state: StateChange) => void
): EventSubscription | null {
  const mod = getModernLocation();
  if (!mod) return null;
  return mod.addListener('onStateChange', handler);
}

export function subscribeToErrors(
  handler: (err: ModernLocationError) => void
): EventSubscription | null {
  const mod = getModernLocation();
  if (!mod) return null;
  return mod.addListener('onError', handler);
}
