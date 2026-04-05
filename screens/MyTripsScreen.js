import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, ActivityIndicator, Alert, RefreshControl, AppState,
} from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { supabase } from '../lib/supabase';
import { getDistanceMiles, formatDuration } from '../lib/utils';
import { logEvent } from '../lib/systemLog';
import { colors, spacing, radius, typography, components } from '../lib/theme';
import useResponsive from '../lib/useResponsive';

const LOCATION_TASK = 'background-location-task';
const TIMEOUT_MS = 8000;

// ── Background task definition (must be at module level) ─────────────────────
// This task runs natively even when iOS kills the JS runtime
// PROPER FIX FOR BACKGROUND TRACKING TOKEN EXPIRATION
// Replace your existing LOCATION_TASK definition in MyTripsScreen.js

TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data) return;
  const { locations } = data;
  if (!locations || locations.length === 0) return;

  const AsyncStorage = require('@react-native-async-storage/async-storage').default;
  const { createClient } = require('@supabase/supabase-js');

  try {
    const stored = await AsyncStorage.getItem('activeTrip');
    if (!stored) return;
    const parsed = JSON.parse(stored);
    if (parsed.paused) return; // Skip everything if trip is paused
    const { tripId, userId, lastLat, lastLon, miles, startTime } = parsed;
    const storedTopSpeed = parsed.topSpeed;
    const storedOver80 = parsed.secondsOver80;
    const storedOver90 = parsed.secondsOver90;
    const storedSpeedTime = parsed.lastSpeedTime;
    let bgStopStart = parsed.currentStopStart;

    // FIX: Get session from Supabase v2 storage key
    const STORAGE_KEY = 'sb-yincjogkjvotupzgetqg-auth-token';
    const sessionStr = await AsyncStorage.getItem(STORAGE_KEY);
    if (!sessionStr) {
      console.log('[BG Task] No session in storage');
      return;
    }

    const sessionData = JSON.parse(sessionStr);
    let accessToken = sessionData?.access_token;
    const refreshToken = sessionData?.refresh_token;

    // Check if token is expired or about to expire
    const expiresAt = sessionData?.expires_at;
    const now = Math.floor(Date.now() / 1000);
    const isExpired = expiresAt && now >= expiresAt;
    const expiringSoon = expiresAt && (expiresAt - now) < 300; // Less than 5 minutes left

    // Refresh token if expired or expiring soon
    if ((isExpired || expiringSoon) && refreshToken) {
      console.log('[BG Task] Token expired/expiring, refreshing...');

      const tempClient = createClient(
        'https://yincjogkjvotupzgetqg.supabase.co',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpbmNqb2dranZvdHVwemdldHFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5MTc2MTAsImV4cCI6MjA4ODQ5MzYxMH0._gxry5gqeBUFRz8la2IeHW8if1M1IdAHACMKUWy1las'
      );

      const { data: refreshData, error: refreshError } = await tempClient.auth.refreshSession({
        refresh_token: refreshToken
      });

      if (refreshError || !refreshData.session) {
        console.log('[BG Task] Token refresh failed:', refreshError?.message);
        return;
      }

      // Write back the refreshed session in the same format Supabase v2 expects
      accessToken = refreshData.session.access_token;
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(refreshData.session));
      console.log('[BG Task] Token refreshed successfully');
    }

    if (!accessToken) {
      console.log('[BG Task] No access token available');
      return;
    }

    // Create authenticated client with fresh token
    const client = createClient(
      'https://yincjogkjvotupzgetqg.supabase.co',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpbmNqb2dranZvdHVwemdldHFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5MTc2MTAsImV4cCI6MjA4ODQ5MzYxMH0._gxry5gqeBUFRz8la2IeHW8if1M1IdAHACMKUWy1las',
      { global: { headers: { Authorization: `Bearer ${accessToken}` } } }
    );

    const loc = locations[locations.length - 1];
    const { latitude, longitude, speed: rawSpeed } = loc.coords;

    // Only accumulate miles if mileage tracking is active
    // For fly trips, mileage starts at scheduled pickup time
    const bgMileageActive = !parsed.mileageStartTime || Date.now() >= parsed.mileageStartTime;

    let newMiles = miles;
    if (bgMileageActive && lastLat && lastLon) {
      // Calculate distance using Haversine formula
      const R = 3958.8; // Earth radius in miles
      const dLat = (latitude - lastLat) * Math.PI / 180;
      const dLon = (longitude - lastLon) * Math.PI / 180;
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(lastLat * Math.PI / 180) * Math.cos(latitude * Math.PI / 180) *
                Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      const distance = R * c;
      newMiles += distance;
    }

    // Speed tracking (rawSpeed is m/s, convert to mph)
    const speedNow = Date.now();
    // Fallback: calculate speed from distance if GPS speed unavailable (-1)
    let speedMph = 0;
    if (rawSpeed != null && rawSpeed >= 0) {
      speedMph = rawSpeed * 2.237;
    } else if (lastLat && lastLon && storedSpeedTime) {
      const R = 3958.8;
      const dLat2 = (latitude - lastLat) * Math.PI / 180;
      const dLon2 = (longitude - lastLon) * Math.PI / 180;
      const a2 = Math.sin(dLat2/2) * Math.sin(dLat2/2) +
                Math.cos(lastLat * Math.PI / 180) * Math.cos(latitude * Math.PI / 180) *
                Math.sin(dLon2/2) * Math.sin(dLon2/2);
      const dist = R * 2 * Math.atan2(Math.sqrt(a2), Math.sqrt(1-a2));
      const timeSec = (speedNow - storedSpeedTime) / 1000;
      if (timeSec > 0 && timeSec < 120) {
        speedMph = (dist / timeSec) * 3600;
      }
    }
    let topSpeed = storedTopSpeed || 0;
    let secondsOver80 = storedOver80 || 0;
    let secondsOver90 = storedOver90 || 0;

    if (bgMileageActive && speedMph > topSpeed) topSpeed = Math.round(speedMph);
    const elapsed = storedSpeedTime ? (speedNow - storedSpeedTime) / 1000 : 0;
    if (bgMileageActive && elapsed > 0 && elapsed < 120) {
      if (speedMph > 80) secondsOver80 += elapsed;
      if (speedMph > 90) secondsOver90 += elapsed;
    }

    // Stop tracking (under 5 mph = stopped) — writes to trip_stops table in real-time
    let bgStopId = parsed.currentStopId;
    if (speedMph < 5) {
      if (!bgStopStart) {
        bgStopStart = speedNow;
      } else if (!bgStopId && (speedNow - bgStopStart) >= 5 * 60 * 1000) {
        // 5 min threshold reached, insert stop into DB
        const { data: stopRow } = await client.from('trip_stops').insert({
          trip_id: tripId,
          driver_id: userId,
          latitude,
          longitude,
          started_at: new Date(bgStopStart).toISOString(),
        }).select('id').single();
        if (stopRow) bgStopId = stopRow.id;
      }
    } else if (bgStopStart) {
      if (bgStopId) {
        const stopDuration = Math.round((speedNow - bgStopStart) / 60000);
        const { error: bgStopErr } = await client.from('trip_stops').update({
          ended_at: new Date().toISOString(),
          duration_minutes: stopDuration,
        }).eq('id', bgStopId);
        if (bgStopErr) console.log('[BG Task] Stop end failed:', bgStopErr.message);
        else console.log('[BG Task] Stop ended:', bgStopId, stopDuration + 'min');
      }
      bgStopId = null;
      bgStopStart = null;
    }

    // Write to database
    const { error: dbError } = await client.from('driver_locations').upsert({
      driver_id: userId,
      latitude,
      longitude,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'driver_id' });

    if (dbError) {
      console.log('[BG Task] DB write error:', dbError.message);
    } else {
      console.log('[BG Task] Location updated successfully');
    }

    // Update AsyncStorage
    await AsyncStorage.setItem('activeTrip', JSON.stringify({
      tripId, userId,
      lastLat: latitude,
      lastLon: longitude,
      miles: newMiles,
      startTime,
      topSpeed,
      secondsOver80,
      secondsOver90,
      lastSpeedTime: speedNow,
      currentStopId: bgStopId,
      currentStopStart: bgStopStart,
    }));

  } catch (e) {
    console.log('[BG Task] Error:', e.message);
  }
});

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

function statusColor(status) {
  if (status === 'pending') return colors.info;
  if (status === 'in_progress') return colors.primary;
  if (status === 'completed') return colors.success;
  return colors.textMuted;
}

function statusLabel(status) {
  if (status === 'pending') return 'PENDING';
  if (status === 'in_progress') return 'IN PROGRESS';
  if (status === 'completed') return 'AWAITING FINALIZATION';
  return status.toUpperCase();
}

function TripCard({ trip, currentUserId, onStart, onEnd, onPause, onResume, activeTrip, unreadCount, onChatPress }) {
  const isDesignated = trip.designated_driver_id === currentUserId;
  const isFlyTrip = trip.trip_type === 'fly';
  const isActive = activeTrip?.id === trip.id;
  const isPaused = isActive && activeTrip.paused;

  const canStart = isDesignated && trip.status === 'pending' && !activeTrip;
  const canPause = isDesignated && trip.status === 'in_progress' && isActive && !isPaused;
  const canResume = isDesignated && trip.status === 'in_progress' && isActive && isPaused;
  const waitingForDesignated = !isDesignated && trip.trip_type === 'drive' && trip.status === 'pending';

  return (
    <View style={[s.card, { borderLeftColor: statusColor(trip.status) }]}>
      <View style={s.cardHeader}>
        <View style={s.cardHeaderLeft}>
          <Text style={s.cardCrm}>{trip.carpage_id ?? trip.crm_id ?? '—'}</Text>
          <Text style={s.cardCity}>{trip.city}</Text>
        </View>
        <View style={[s.statusBadge, { borderColor: statusColor(trip.status) }]}>
          <Text style={[s.statusText, { color: statusColor(trip.status) }]}>
            {statusLabel(trip.status)}
          </Text>
        </View>
      </View>

      <View style={s.cardMeta}>
        <Text style={s.metaItem}>{isFlyTrip ? '✈ FLY' : '🚗 DRIVE'}</Text>
        {trip.scheduled_pickup && (
          <Text style={s.metaItem}>
            {new Date(trip.scheduled_pickup).toLocaleDateString('en-US', {
              month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
            })}
          </Text>
        )}
      </View>

      {trip.notes ? <Text style={s.notes}>{trip.notes}</Text> : null}

      {isActive && !isPaused && (
        <View style={[s.liveRow, activeTrip.stale && s.liveRowStale]}>
          <View style={[s.liveDot, activeTrip.stale && s.liveDotStale]} />
          <Text style={[s.liveText, activeTrip.stale && s.liveTextStale]}>
            {activeTrip.stale ? 'RECONNECTING...' : 'TRACKING'}
          </Text>
          <Text style={s.liveMiles}>{(activeTrip.miles ?? 0).toFixed(1)} mi  ·  {formatDuration(activeTrip.elapsed ?? 0)}</Text>
        </View>
      )}

      {isPaused && (
        <View style={s.pausedRow}>
          <Text style={s.pausedIcon}>⏸</Text>
          <Text style={s.pausedText}>PAUSED</Text>
          <Text style={s.liveMiles}>{(activeTrip.miles ?? 0).toFixed(1)} mi  ·  {formatDuration(activeTrip.elapsed ?? 0)}</Text>
        </View>
      )}

      {canStart && (
        <TouchableOpacity style={s.startBtn} onPress={() => onStart(trip)}>
          <Text style={s.startBtnText}>▶ START TRIP</Text>
        </TouchableOpacity>
      )}

      {canPause && (
        <View style={s.tripActions}>
          <TouchableOpacity style={s.pauseBtn} onPress={() => onPause(trip)}>
            <Text style={s.pauseBtnText}>⏸ PAUSE</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.endBtn} onPress={() => onEnd(trip)}>
            <Text style={s.endBtnText}>⏹ END TRIP</Text>
          </TouchableOpacity>
        </View>
      )}

      {canResume && (
        <View style={s.tripActions}>
          <TouchableOpacity style={s.resumeBtn} onPress={() => onResume(trip)}>
            <Text style={s.resumeBtnText}>▶ RESUME</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.endBtn} onPress={() => onEnd(trip)}>
            <Text style={s.endBtnText}>⏹ END TRIP</Text>
          </TouchableOpacity>
        </View>
      )}

      {waitingForDesignated && (
        <Text style={s.waitingText}>Waiting for designated driver to start</Text>
      )}

      {activeTrip && !isActive && trip.status === 'pending' && (
        <Text style={s.waitingText}>Another trip is currently active</Text>
      )}

      {/* Chat Button */}
      <View style={s.chatRow}>
        <TouchableOpacity
          style={s.chatBtn}
          onPress={() => onChatPress(trip)}
          activeOpacity={0.7}
        >
          <Text style={s.chatIcon}>💬</Text>
          <Text style={s.chatBtnText}>Messages</Text>
          {unreadCount > 0 && (
            <View style={s.chatBadge}>
              <Text style={s.chatBadgeText}>{unreadCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function MyTripsScreen({ session, navigation }) {
  const { isTablet } = useResponsive();
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [activeTrip, setActiveTrip] = useState(null);
  const [unreadCounts, setUnreadCounts] = useState({});

  const startTimeRef = useRef(null);
  const timerRef = useRef(null);
  const locationWatcherRef = useRef(null);
  const appStateRef = useRef(AppState.currentState);

  const AsyncStorage = require('@react-native-async-storage/async-storage').default;

  // ── Sync miles from background task storage ──────────────────────────────
  async function syncMilesFromStorage() {
    try {
      const stored = await AsyncStorage.getItem('activeTrip');
      if (!stored) return;
      const { miles } = JSON.parse(stored);
      setActiveTrip(prev => prev ? { ...prev, miles } : prev);
    } catch {}
  }

  // ── AppState listener to sync miles when foregrounded ────────────────────
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (appStateRef.current.match(/inactive|background/) && nextState === 'active') {
        syncMilesFromStorage();
      }
      appStateRef.current = nextState;
    });
    return () => sub.remove();
  }, []);

  // ── Cleanup on unmount ───────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (locationWatcherRef.current) locationWatcherRef.current.remove();
    };
  }, []);

  async function load() {
    setError(false);
    try {
      const userId = session.user.id;
      const { data, error: err } = await withTimeout(
        supabase
          .from('trips')
          .select('*')
          .or(`driver_id.eq.${userId},second_driver_id.eq.${userId}`)
          .in('status', ['pending', 'in_progress', 'completed'])
          .order('scheduled_pickup', { ascending: true }),
        TIMEOUT_MS
      );
      if (err) throw err;
      setTrips(data ?? []);

      // Rehydrate activeTrip if there's an in_progress trip
      const inProgress = (data ?? []).find(
        t => t.status === 'in_progress' && t.designated_driver_id === userId
      );
      if (inProgress) {
        // Check if background task has stored state
        const stored = await AsyncStorage.getItem('activeTrip');
        const storedData = stored ? JSON.parse(stored) : null;
        const miles = storedData?.miles ?? inProgress.miles ?? 0;
        const startTime = storedData?.startTime ?? Date.now();
        startTimeRef.current = startTime;

        const isPaused = storedData?.paused ?? false;
        let elapsed;
        if (isPaused && storedData?.pausedAt) {
          // Show only active time, not pause time
          elapsed = Math.floor((storedData.pausedAt - startTime) / 1000);
        } else {
          elapsed = Math.floor((Date.now() - startTime) / 1000);
        }
        setActiveTrip({ id: inProgress.id, miles, elapsed, paused: isPaused });

        // Restart elapsed timer (only if not paused)
        if (!isPaused) {
          if (timerRef.current) clearInterval(timerRef.current);
          timerRef.current = setInterval(() => {
            setActiveTrip(prev => {
              if (!prev) return prev;
              const isStale = prev.lastGps && (Date.now() - prev.lastGps) > 60000;
              return {
                ...prev,
                elapsed: Math.floor((Date.now() - startTimeRef.current) / 1000),
                stale: isStale,
              };
            });
          }, 1000);
        }
      }

      loadUnreadCounts(data ?? []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function loadUnreadCounts(tripList) {
    const userId = session.user.id;
    const tripIds = tripList.map(t => t.id);
    if (tripIds.length === 0) return;

    const { data: messages } = await supabase
      .from('trip_messages')
      .select('trip_id, sender_id')
      .in('trip_id', tripIds);

    if (!messages) return;

    const counts = {};
    messages.forEach(msg => {
      if (msg.sender_id !== userId) {
        counts[msg.trip_id] = (counts[msg.trip_id] || 0) + 1;
      }
    });

    setUnreadCounts(counts);
  }

  useEffect(() => {
    load();

    // Realtime: refresh when trips are created/updated/assigned
    const subscription = supabase
      .channel('driver_trips')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trips' },
        (payload) => {
          const row = payload.new || payload.old;
          const userId = session.user.id;
          // Only reload if this trip involves the current driver
          if (row?.driver_id === userId || row?.second_driver_id === userId) {
            load();
          }
        }
      )
      .subscribe();

    return () => { subscription.unsubscribe(); };
  }, []);
  function onRefresh() { setRefreshing(true); load(); }

  // ── GPS helpers ──────────────────────────────────────────────────────────
  const requestPermissions = async () => {
    const { status: fg } = await Location.requestForegroundPermissionsAsync();
    if (fg !== 'granted') {
      Alert.alert('Permission Required', 'Location access is needed to track your trip.');
      return false;
    }
    const { status: bg } = await Location.requestBackgroundPermissionsAsync();
    if (bg !== 'granted') {
      Alert.alert('Background Location Required', 'Please allow "Always" location access in Settings so the app can track miles when your screen is locked.', [{ text: 'OK' }]);
      return false;
    }
    return true;
  };

  const clearLiveLocation = async () => {
    if (!session?.user?.id) return;
    await supabase.from('driver_locations').delete().eq('driver_id', session.user.id);
  };

  // ── Notify admins of trip status change (fire-and-forget) ──
  function notifyTripStatus(tripId, action) {
    fetch('https://yincjogkjvotupzgetqg.supabase.co/functions/v1/notify-trip-status', {
      method: 'POST',
      headers: {
        apikey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpbmNqb2dranZvdHVwemdldHFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5MTc2MTAsImV4cCI6MjA4ODQ5MzYxMH0._gxry5gqeBUFRz8la2IeHW8if1M1IdAHACMKUWy1las',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ trip_id: tripId, driver_id: session.user.id, action }),
    }).catch(() => {}); // Silent fail — don't block trip flow
  }

  // ── Start trip ───────────────────────────────────────────────────────────
  async function handleStart(trip) {
    const permitted = await requestPermissions();
    if (!permitted) return;

    const { error: err } = await supabase
      .from('trips')
      .update({ status: 'in_progress', actual_start: new Date().toISOString() })
      .eq('id', trip.id);

    if (err) { Alert.alert('Failed to start trip', err.message); return; }

    notifyTripStatus(trip.id, 'started');

    const startTime = Date.now();
    startTimeRef.current = startTime;

    // Update UI immediately — don't wait for GPS/background task startup
    setActiveTrip({ id: trip.id, miles: 0, elapsed: 0 });
    setTrips(prev => prev.map(t => t.id === trip.id ? { ...t, status: 'in_progress' } : t));

    // Start elapsed timer
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setActiveTrip(prev => {
        if (!prev) return prev;
        const isStale = prev.lastGps && (Date.now() - prev.lastGps) > 60000;
        return {
          ...prev,
          elapsed: Math.floor((Date.now() - startTimeRef.current) / 1000),
          stale: isStale,
        };
      });
    }, 1000);

    // Store trip state in AsyncStorage for background task
    const mileageStartTime = trip.trip_type === 'fly' && trip.scheduled_pickup
      ? new Date(trip.scheduled_pickup).getTime()
      : null; // null = start counting immediately (drive trips)

    await AsyncStorage.setItem('activeTrip', JSON.stringify({
      tripId: trip.id,
      userId: session.user.id,
      lastLat: null,
      lastLon: null,
      miles: 0,
      startTime,
      topSpeed: 0,
      secondsOver80: 0,
      secondsOver90: 0,
      lastSpeedTime: null,
      currentStopId: null,
      currentStopStart: null,
      tripType: trip.trip_type,
      mileageStartTime,
    }));

    // Foreground watcher — pushes live location to driver_locations while app is open.
    // This is the reliable path for the Live Drivers admin view; the background task
    // (below) takes over if iOS kills the JS runtime.
    if (locationWatcherRef.current) locationWatcherRef.current.remove();
    locationWatcherRef.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 10000, distanceInterval: 10 },
      async (loc) => {
        const { latitude, longitude, speed: rawSpeed } = loc.coords;

        // Push live location to DB for admin Live Drivers view
        await supabase.from('driver_locations').upsert({
          driver_id: session.user.id,
          latitude,
          longitude,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'driver_id' });

        // Accumulate miles and speed data in AsyncStorage
        try {
          const stored = await AsyncStorage.getItem('activeTrip');
          if (!stored) return;
          const tripData = JSON.parse(stored);
          let newMiles = tripData.miles || 0;

          // Only accumulate miles if mileage tracking is active
          // For fly trips, mileage starts at scheduled pickup time
          const mileageActive = !tripData.mileageStartTime || Date.now() >= tripData.mileageStartTime;

          if (mileageActive && tripData.lastLat && tripData.lastLon) {
            newMiles += getDistanceMiles(tripData.lastLat, tripData.lastLon, latitude, longitude);
          }

          // Speed tracking (rawSpeed is m/s, convert to mph)
          const now = Date.now();
          // Fallback: calculate speed from distance if GPS speed unavailable (-1)
          let speedMph = 0;
          if (rawSpeed != null && rawSpeed >= 0) {
            speedMph = rawSpeed * 2.237;
          } else if (tripData.lastLat && tripData.lastLon && tripData.lastSpeedTime) {
            const dist = getDistanceMiles(tripData.lastLat, tripData.lastLon, latitude, longitude);
            const timeSec = (now - tripData.lastSpeedTime) / 1000;
            if (timeSec > 0 && timeSec < 120) {
              speedMph = (dist / timeSec) * 3600;
            }
          }
          let topSpeed = tripData.topSpeed || 0;
          let secondsOver80 = tripData.secondsOver80 || 0;
          let secondsOver90 = tripData.secondsOver90 || 0;

          // Only track speed metrics after mileage is active
          if (mileageActive && speedMph > topSpeed) topSpeed = Math.round(speedMph);
          const elapsed = tripData.lastSpeedTime ? (now - tripData.lastSpeedTime) / 1000 : 0;
          if (mileageActive && elapsed > 0 && elapsed < 120) {
            if (speedMph > 80) secondsOver80 += elapsed;
            if (speedMph > 90) secondsOver90 += elapsed;
          }

          // Stop tracking (under 5 mph = stopped) — writes to trip_stops table in real-time
          let currentStopId = tripData.currentStopId;
          let currentStopStart = tripData.currentStopStart;

          if (speedMph < 5) {
            if (!currentStopStart) {
              // Start a new stop — insert into DB after 5 min threshold
              currentStopStart = now;
            } else if (!currentStopId && (now - currentStopStart) >= 5 * 60 * 1000) {
              // 5 min threshold reached, insert stop into DB
              const { data: stopRow } = await supabase.from('trip_stops').insert({
                trip_id: tripData.tripId,
                driver_id: session.user.id,
                latitude,
                longitude,
                started_at: new Date(currentStopStart).toISOString(),
              }).select('id').single();
              if (stopRow) currentStopId = stopRow.id;
            }
          } else if (currentStopStart) {
            // Movement resumed — end the stop
            if (currentStopId) {
              const stopDuration = Math.round((now - currentStopStart) / 60000);
              const { error: stopEndErr } = await supabase.from('trip_stops').update({
                ended_at: new Date().toISOString(),
                duration_minutes: stopDuration,
              }).eq('id', currentStopId);
              if (stopEndErr) console.log('[Stop] End failed:', stopEndErr.message);
            }
            currentStopId = null;
            currentStopStart = null;
          }

          await AsyncStorage.setItem('activeTrip', JSON.stringify({
            ...tripData,
            lastLat: latitude,
            lastLon: longitude,
            miles: newMiles,
            topSpeed,
            secondsOver80,
            secondsOver90,
            lastSpeedTime: now,
            currentStopId,
            currentStopStart,
          }));

          // Update UI with new miles
          setActiveTrip(prev => prev ? { ...prev, miles: newMiles, stale: false, lastGps: Date.now() } : prev);
        } catch {}
      }
    );

    // Background task — survives iOS runtime kills
    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      activityType: Location.ActivityType.AutomotiveNavigation,
      timeInterval: 10000,
      distanceInterval: 50,
      foregroundService: {
        notificationTitle: 'Trip in Progress',
        notificationBody: 'Discovery Driver Portal is tracking your location.',
        notificationColor: '#f5a623',
      },
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
    });
  }

  // ── Pause trip ───────────────────────────────────────────────────────────
  async function handlePause(trip) {
    // Stop foreground watcher
    if (locationWatcherRef.current) { locationWatcherRef.current.remove(); locationWatcherRef.current = null; }
    // Stop background task
    try {
      const isTracking = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
      if (isTracking) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    } catch {}
    // Stop elapsed timer
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    // Clear live location from map
    await supabase.from('driver_locations').delete().eq('driver_id', session.user.id);
    // Finalize any active stop
    const stored = await AsyncStorage.getItem('activeTrip');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.currentStopId) {
        const stopDuration = Math.round((Date.now() - parsed.currentStopStart) / 60000);
        await supabase.from('trip_stops').update({
          ended_at: new Date().toISOString(),
          duration_minutes: stopDuration,
        }).eq('id', parsed.currentStopId);
      }
      // Mark as paused in AsyncStorage
      await AsyncStorage.setItem('activeTrip', JSON.stringify({
        ...parsed,
        paused: true,
        pausedAt: Date.now(),
        currentStopId: null,
        currentStopStart: null,
      }));
    }
    setActiveTrip(prev => prev ? { ...prev, paused: true } : prev);
    notifyTripStatus(trip.id, 'paused');
    logEvent('info', 'trip_paused', `Trip to ${trip.city} paused`, { trip_id: trip.id });
  }

  // ── Resume trip ─────────────────────────────────────────────────────────
  async function handleResume(trip) {
    const permitted = await requestPermissions();
    if (!permitted) return;

    const stored = await AsyncStorage.getItem('activeTrip');
    if (!stored) return;
    const parsed = JSON.parse(stored);

    // Adjust start time to account for pause duration
    const pauseDuration = parsed.pausedAt ? (Date.now() - parsed.pausedAt) : 0;
    const adjustedStartTime = parsed.startTime + pauseDuration;

    // Unpause in AsyncStorage
    await AsyncStorage.setItem('activeTrip', JSON.stringify({
      ...parsed,
      paused: false,
      pausedAt: null,
      startTime: adjustedStartTime,
    }));

    setActiveTrip(prev => prev ? { ...prev, paused: false, stale: false } : prev);

    // Restart elapsed timer
    startTimeRef.current = adjustedStartTime;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setActiveTrip(prev => {
        if (!prev) return prev;
        const isStale = prev.lastGps && (Date.now() - prev.lastGps) > 60000;
        return {
          ...prev,
          elapsed: Math.floor((Date.now() - startTimeRef.current) / 1000),
          stale: isStale,
        };
      });
    }, 1000);

    // Restart foreground watcher
    if (locationWatcherRef.current) locationWatcherRef.current.remove();
    locationWatcherRef.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 10000, distanceInterval: 10 },
      async (loc) => {
        const { latitude, longitude, speed: rawSpeed } = loc.coords;
        await supabase.from('driver_locations').upsert({
          driver_id: session.user.id,
          latitude,
          longitude,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'driver_id' });

        try {
          const tripStored = await AsyncStorage.getItem('activeTrip');
          if (!tripStored) return;
          const tripData = JSON.parse(tripStored);
          if (tripData.paused) return;

          const resumeMileageActive = !tripData.mileageStartTime || Date.now() >= tripData.mileageStartTime;

          let newMiles = tripData.miles || 0;
          if (resumeMileageActive && tripData.lastLat && tripData.lastLon) {
            newMiles += getDistanceMiles(tripData.lastLat, tripData.lastLon, latitude, longitude);
          }

          let speedMph = 0;
          const now = Date.now();
          if (rawSpeed != null && rawSpeed >= 0) {
            speedMph = rawSpeed * 2.237;
          } else if (tripData.lastLat && tripData.lastLon && tripData.lastSpeedTime) {
            const dist = getDistanceMiles(tripData.lastLat, tripData.lastLon, latitude, longitude);
            const timeSec = (now - tripData.lastSpeedTime) / 1000;
            if (timeSec > 0 && timeSec < 120) speedMph = (dist / timeSec) * 3600;
          }

          let topSpeed = tripData.topSpeed || 0;
          let secondsOver80 = tripData.secondsOver80 || 0;
          let secondsOver90 = tripData.secondsOver90 || 0;
          if (resumeMileageActive && speedMph > topSpeed) topSpeed = Math.round(speedMph);
          const elapsed = tripData.lastSpeedTime ? (now - tripData.lastSpeedTime) / 1000 : 0;
          if (resumeMileageActive && elapsed > 0 && elapsed < 120) {
            if (speedMph > 80) secondsOver80 += elapsed;
            if (speedMph > 90) secondsOver90 += elapsed;
          }

          let currentStopId = tripData.currentStopId;
          let currentStopStart = tripData.currentStopStart;
          if (speedMph < 5) {
            if (!currentStopStart) currentStopStart = now;
            else if (!currentStopId && (now - currentStopStart) >= 5 * 60 * 1000) {
              const { data: stopRow } = await supabase.from('trip_stops').insert({
                trip_id: tripData.tripId, driver_id: session.user.id,
                latitude, longitude, started_at: new Date(currentStopStart).toISOString(),
              }).select('id').single();
              if (stopRow) currentStopId = stopRow.id;
            }
          } else if (currentStopStart) {
            if (currentStopId) {
              await supabase.from('trip_stops').update({
                ended_at: new Date().toISOString(),
                duration_minutes: Math.round((now - currentStopStart) / 60000),
              }).eq('id', currentStopId);
            }
            currentStopId = null;
            currentStopStart = null;
          }

          await AsyncStorage.setItem('activeTrip', JSON.stringify({
            ...tripData, lastLat: latitude, lastLon: longitude, miles: newMiles,
            topSpeed, secondsOver80, secondsOver90, lastSpeedTime: now,
            currentStopId, currentStopStart,
          }));
          setActiveTrip(prev => prev ? { ...prev, miles: newMiles, stale: false, lastGps: Date.now() } : prev);
        } catch {}
      }
    );

    // Restart background task
    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      activityType: Location.ActivityType.AutomotiveNavigation,
      timeInterval: 10000,
      distanceInterval: 50,
      foregroundService: {
        notificationTitle: 'Trip in Progress',
        notificationBody: 'Discovery Driver Portal is tracking your location.',
        notificationColor: '#f5a623',
      },
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
    });

    notifyTripStatus(trip.id, 'resumed');
    logEvent('info', 'trip_resumed', `Trip to ${trip.city} resumed`, { trip_id: trip.id });
  }

  // ── End trip ─────────────────────────────────────────────────────────────
  async function handleEnd(trip) {
    Alert.alert(
      'End Trip?',
      'This will stop GPS tracking and mark the trip as complete.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End Trip', style: 'destructive', onPress: async () => {
            // Check if trip was already ended (e.g. by geofence auto-end)
            const { data: currentTrip } = await supabase
              .from('trips')
              .select('status')
              .eq('id', trip.id)
              .single();

            if (currentTrip?.status === 'completed' || currentTrip?.status === 'finalized') {
              // Trip already ended — just clean up local state
              if (locationWatcherRef.current) { locationWatcherRef.current.remove(); locationWatcherRef.current = null; }
              try {
                const isTracking = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
                if (isTracking) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
              } catch {}
              if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
              await AsyncStorage.removeItem('activeTrip');
              setActiveTrip(null);
              load();
              Alert.alert('Trip Already Ended', 'This trip was automatically ended when you arrived at the dealership.');
              return;
            }

            // Stop foreground watcher and background task
            if (locationWatcherRef.current) { locationWatcherRef.current.remove(); locationWatcherRef.current = null; }
            const isTracking = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
            if (isTracking) await Location.stopLocationUpdatesAsync(LOCATION_TASK);

            if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
            clearLiveLocation();

            // Get final miles and speed data from AsyncStorage
            let finalMiles = 0;
            let finalDriveTime = 0;
            let speedData = null;
            try {
              const stored = await AsyncStorage.getItem('activeTrip');
              if (!stored) {
                // AsyncStorage already cleared — geofence likely already ended this trip
                const { data: recheck } = await supabase.from('trips').select('status').eq('id', trip.id).single();
                if (recheck?.status === 'completed' || recheck?.status === 'finalized') {
                  setActiveTrip(null);
                  load();
                  Alert.alert('Trip Already Ended', 'This trip was automatically ended when you arrived at the dealership.');
                  return;
                }
              }
              if (stored) {
                const parsed = JSON.parse(stored);
                finalMiles = parseFloat(parsed.miles.toFixed(1));
                finalDriveTime = parseFloat(((Date.now() - parsed.startTime) / 3600000).toFixed(2));
                const avgSpeed = finalDriveTime > 0 ? Math.round(finalMiles / finalDriveTime) : 0;
                // Finalize any in-progress stop in the DB
                if (parsed.currentStopId) {
                  const stopDuration = Math.round((Date.now() - parsed.currentStopStart) / 60000);
                  await supabase.from('trip_stops').update({
                    ended_at: new Date().toISOString(),
                    duration_minutes: stopDuration,
                  }).eq('id', parsed.currentStopId);
                }
                speedData = {
                  top_speed: parsed.topSpeed || 0,
                  avg_speed: avgSpeed,
                  seconds_over_80: Math.round(parsed.secondsOver80 || 0),
                  seconds_over_90: Math.round(parsed.secondsOver90 || 0),
                };
              }
            } catch {}

            await AsyncStorage.removeItem('activeTrip');

            const tripUpdate = {
              status: 'completed',
              actual_end: new Date().toISOString(),
              miles: finalMiles,
              hours: finalDriveTime,
            };
            if (speedData) tripUpdate.speed_data = speedData;

            const { error: err } = await supabase
              .from('trips')
              .update(tripUpdate)
              .eq('id', trip.id);

            if (err) { Alert.alert('Failed to end trip', err.message); return; }

            notifyTripStatus(trip.id, 'ended');

            setActiveTrip(null);
            setTrips(prev => prev.map(t =>
              t.id === trip.id
                ? { ...t, status: 'completed', miles: finalMiles, hours: finalDriveTime }
                : t
            ));
          }
        },
      ]
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────
  if (loading) return <View style={s.center}><ActivityIndicator color={colors.primary} /></View>;

  if (error) return (
    <View style={s.center}>
      <Text style={s.errorText}>Failed to load trips</Text>
      <TouchableOpacity style={s.retryBtn} onPress={() => { setLoading(true); load(); }}>
        <Text style={s.retryText}>RETRY</Text>
      </TouchableOpacity>
    </View>
  );

  const activeTrips = trips.filter(t => t.status === 'pending' || t.status === 'in_progress');
  const completedTrips = trips.filter(t => t.status === 'completed');

  return (
    <ScrollView
      style={s.container}
      contentContainerStyle={[s.content, { maxWidth: 700, alignSelf: 'center', width: '100%' }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      {activeTrips.length === 0 && completedTrips.length === 0 && (
        <View style={s.empty}>
          <Text style={s.emptyTitle}>NO TRIPS ASSIGNED</Text>
          <Text style={s.emptySub}>Your admin will assign trips here</Text>
        </View>
      )}

      {activeTrips.length > 0 && (
        <>
          <Text style={s.sectionTitle}>YOUR TRIPS</Text>
          {activeTrips.map(trip => (
            <TripCard
              key={trip.id}
              trip={trip}
              currentUserId={session.user.id}
              onStart={handleStart}
              onEnd={handleEnd}
              onPause={handlePause}
              onResume={handleResume}
              activeTrip={activeTrip}
              unreadCount={unreadCounts[trip.id] || 0}
              onChatPress={(selectedTrip) => {
                navigation.navigate('TripChat', {
                  trip: selectedTrip,
                  currentUser: { id: session.user.id, name: 'You' },
                  allProfiles: [],
                });
              }}
            />
          ))}
        </>
      )}

      {completedTrips.length > 0 && (
        <>
          <Text style={s.sectionTitle}>COMPLETED</Text>
          {completedTrips.map(trip => (
            <TripCard
              key={trip.id}
              trip={trip}
              currentUserId={session.user.id}
              onStart={handleStart}
              onEnd={handleEnd}
              onPause={handlePause}
              onResume={handleResume}
              activeTrip={activeTrip}
              unreadCount={unreadCounts[trip.id] || 0}
              onChatPress={(selectedTrip) => {
                navigation.navigate('TripChat', {
                  trip: selectedTrip,
                  currentUser: { id: session.user.id, name: 'You' },
                  allProfiles: [],
                });
              }}
            />
          ))}
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { ...components.screen },
  content: { padding: spacing.xl, paddingTop: 60, paddingBottom: spacing.xxxxl },
  center: { ...components.center },
  sectionTitle: { ...components.sectionTitle },

  card: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderLeftWidth: 3, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.md,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.sm },
  cardHeaderLeft: { flex: 1 },
  cardCrm: { ...typography.caption, color: colors.textTertiary, letterSpacing: 1, marginBottom: 2 },
  cardCity: { ...typography.displaySm, fontSize: 20, color: colors.textPrimary },
  statusBadge: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, marginLeft: spacing.sm },
  statusText: { ...typography.labelSm, letterSpacing: 1.5 },

  cardMeta: { flexDirection: 'row', gap: spacing.lg, marginBottom: spacing.sm },
  metaItem: { ...typography.captionSm, color: colors.textTertiary },
  notes: { ...typography.bodySm, fontSize: 12, color: colors.textTertiary, fontStyle: 'italic', marginBottom: spacing.sm, marginTop: spacing.xs },

  liveRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginTop: spacing.sm, marginBottom: spacing.xs,
    backgroundColor: colors.successDim, borderRadius: radius.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderWidth: 1, borderColor: colors.successBorder,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  liveDotStale: { backgroundColor: colors.warning },
  liveText: { ...typography.labelSm, fontSize: 10, color: colors.success, letterSpacing: 2 },
  liveTextStale: { color: colors.warning },
  liveRowStale: { backgroundColor: colors.warningDim, borderColor: colors.warningBorder },
  liveMiles: { ...typography.caption, color: colors.textSecondary, marginLeft: spacing.xs },

  startBtn: { backgroundColor: colors.primary, borderRadius: radius.sm, padding: spacing.md, alignItems: 'center', marginTop: spacing.md },
  startBtnText: { color: colors.bg, fontWeight: '900', fontSize: 13, letterSpacing: 2 },
  tripActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  pauseBtn: { flex: 1, borderWidth: 2, borderColor: colors.warning, borderRadius: radius.sm, padding: spacing.md, alignItems: 'center' },
  pauseBtnText: { color: colors.warning, fontWeight: '900', fontSize: 13, letterSpacing: 2 },
  resumeBtn: { flex: 1, backgroundColor: colors.success, borderRadius: radius.sm, padding: spacing.md, alignItems: 'center' },
  resumeBtnText: { color: colors.bg, fontWeight: '900', fontSize: 13, letterSpacing: 2 },
  endBtn: { flex: 1, borderWidth: 2, borderColor: colors.error, borderRadius: radius.sm, padding: spacing.md, alignItems: 'center' },
  endBtnText: { color: colors.error, fontWeight: '900', fontSize: 13, letterSpacing: 2 },
  pausedRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginTop: spacing.sm, marginBottom: spacing.xs,
    backgroundColor: colors.warningDim, borderRadius: radius.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderWidth: 1, borderColor: colors.warningBorder,
  },
  pausedIcon: { fontSize: 14 },
  pausedText: { ...typography.labelSm, fontSize: 10, color: colors.warning, letterSpacing: 2 },
  waitingText: { ...typography.captionSm, color: colors.textMuted, fontStyle: 'italic', marginTop: spacing.md, textAlign: 'center' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyTitle: { ...typography.h3, fontSize: 16, fontWeight: '900', color: colors.textMuted, letterSpacing: 2, marginBottom: spacing.sm },
  emptySub: { ...typography.bodySm, fontSize: 12, color: colors.textTertiary },

  errorText: { ...components.errorText },
  retryBtn: { ...components.retryBtn },
  retryText: { ...components.retryText },

  chatRow: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#1e1e1e',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  chatBtn: {
    position: 'relative',
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: 'rgba(245, 166, 35, 0.1)',
    borderWidth: 1,
    borderColor: '#f5a623',
    borderRadius: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chatIcon: {
    fontSize: 16,
  },
  chatBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#f5a623',
    letterSpacing: 1,
  },
  chatBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: '#ef4444',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  chatBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },
});