import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, ActivityIndicator, Alert, RefreshControl, AppState,
} from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { supabase } from '../lib/supabase';
import { getDistanceMiles, formatDuration } from '../lib/utils';

const LOCATION_TASK = 'background-location-task';
const TIMEOUT_MS = 8000;

// ── Background task definition (must be at module level) ─────────────────────
// This task runs natively even when iOS kills the JS runtime
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data) return;
  const { locations } = data;
  if (!locations || locations.length === 0) return;

  const AsyncStorage = require('@react-native-async-storage/async-storage').default;
  const { createClient } = require('@supabase/supabase-js');

  try {
    const stored = await AsyncStorage.getItem('activeTrip');
    if (!stored) return;
    const { tripId, userId, lastLat, lastLon, miles, startTime } = JSON.parse(stored);

    // Get session token from AsyncStorage
    const sessionStr = await AsyncStorage.getItem('supabase.auth.token');
    const session = sessionStr ? JSON.parse(sessionStr) : null;
    const accessToken = session?.currentSession?.access_token;
    if (!accessToken) return;

    // Create fresh authenticated client
    const client = createClient(
      process.env.EXPO_PUBLIC_SUPABASE_URL,
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${accessToken}` } } }
    );

    const loc = locations[locations.length - 1];
    const { latitude, longitude } = loc.coords;

    let newMiles = miles;
    if (lastLat && lastLon) {
      newMiles += getDistanceMiles(lastLat, lastLon, latitude, longitude);
    }

    await client.from('driver_locations').upsert({
      driver_id: userId,
      latitude,
      longitude,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'driver_id' });

    await AsyncStorage.setItem('activeTrip', JSON.stringify({
      tripId, userId,
      lastLat: latitude,
      lastLon: longitude,
      miles: newMiles,
      startTime,
    }));
  } catch (e) {
    console.log('Background task error:', e);
  }
});

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

function statusColor(status) {
  if (status === 'pending') return '#3b8cf7';
  if (status === 'in_progress') return '#f5a623';
  if (status === 'completed') return '#4caf50';
  return '#444';
}

function statusLabel(status) {
  if (status === 'pending') return 'PENDING';
  if (status === 'in_progress') return 'IN PROGRESS';
  if (status === 'completed') return 'AWAITING FINALIZATION';
  return status.toUpperCase();
}

function TripCard({ trip, currentUserId, onStart, onEnd, activeTrip }) {
  const isDesignated = trip.designated_driver_id === currentUserId;
  const isFlyTrip = trip.trip_type === 'fly';
  const isActive = activeTrip?.id === trip.id;

  const canStart = isDesignated && trip.status === 'pending' && !activeTrip;
  const canEnd = isDesignated && trip.status === 'in_progress' && isActive;
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

      {isActive && (
        <View style={s.liveRow}>
          <View style={s.liveDot} />
          <Text style={s.liveText}>TRACKING</Text>
          <Text style={s.liveMiles}>{(activeTrip.miles ?? 0).toFixed(1)} mi  ·  {formatDuration(activeTrip.elapsed ?? 0)}</Text>
        </View>
      )}

      {canStart && (
        <TouchableOpacity style={s.startBtn} onPress={() => onStart(trip)}>
          <Text style={s.startBtnText}>▶ START TRIP</Text>
        </TouchableOpacity>
      )}

      {canEnd && (
        <TouchableOpacity style={s.endBtn} onPress={() => onEnd(trip)}>
          <Text style={s.endBtnText}>⏹ END TRIP</Text>
        </TouchableOpacity>
      )}

      {waitingForDesignated && (
        <Text style={s.waitingText}>Waiting for designated driver to start</Text>
      )}

      {activeTrip && !isActive && trip.status === 'pending' && (
        <Text style={s.waitingText}>Another trip is currently active</Text>
      )}
    </View>
  );
}

export default function MyTripsScreen({ session }) {
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [activeTrip, setActiveTrip] = useState(null);

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

        setActiveTrip({ id: inProgress.id, miles, elapsed: Math.floor((Date.now() - startTime) / 1000) });

        // Restart elapsed timer
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = setInterval(() => {
          setActiveTrip(prev => prev ? {
            ...prev,
            elapsed: Math.floor((Date.now() - startTimeRef.current) / 1000)
          } : prev);
        }, 1000);
      }

    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { load(); }, []);
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

  // ── Start trip ───────────────────────────────────────────────────────────
  async function handleStart(trip) {
    const permitted = await requestPermissions();
    if (!permitted) return;

    const { error: err } = await supabase
      .from('trips')
      .update({ status: 'in_progress', actual_start: new Date().toISOString() })
      .eq('id', trip.id);

    if (err) { Alert.alert('Failed to start trip', err.message); return; }

    const startTime = Date.now();
    startTimeRef.current = startTime;

    // Update UI immediately — don't wait for GPS/background task startup
    setActiveTrip({ id: trip.id, miles: 0, elapsed: 0 });
    setTrips(prev => prev.map(t => t.id === trip.id ? { ...t, status: 'in_progress' } : t));

    // Start elapsed timer
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setActiveTrip(prev => prev ? {
        ...prev,
        elapsed: Math.floor((Date.now() - startTimeRef.current) / 1000)
      } : prev);
    }, 1000);

    // Store trip state in AsyncStorage for background task
    await AsyncStorage.setItem('activeTrip', JSON.stringify({
      tripId: trip.id,
      userId: session.user.id,
      lastLat: null,
      lastLon: null,
      miles: 0,
      startTime,
    }));

    // Foreground watcher — pushes live location to driver_locations while app is open.
    // This is the reliable path for the Live Drivers admin view; the background task
    // (below) takes over if iOS kills the JS runtime.
    if (locationWatcherRef.current) locationWatcherRef.current.remove();
    locationWatcherRef.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 10000, distanceInterval: 10 },
      async (loc) => {
        await supabase.from('driver_locations').upsert({
          driver_id: session.user.id,
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'driver_id' });
      }
    );

    // Background task — survives iOS runtime kills
    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
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

  // ── End trip ─────────────────────────────────────────────────────────────
  async function handleEnd(trip) {
    Alert.alert(
      'End Trip?',
      'This will stop GPS tracking and mark the trip as complete.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End Trip', style: 'destructive', onPress: async () => {
            // Stop foreground watcher and background task
            if (locationWatcherRef.current) { locationWatcherRef.current.remove(); locationWatcherRef.current = null; }
            const isTracking = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
            if (isTracking) await Location.stopLocationUpdatesAsync(LOCATION_TASK);

            if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
            clearLiveLocation();

            // Get final miles from AsyncStorage (background task may have updated it)
            let finalMiles = 0;
            let finalDriveTime = 0;
            try {
              const stored = await AsyncStorage.getItem('activeTrip');
              if (stored) {
                const { miles, startTime } = JSON.parse(stored);
                finalMiles = parseFloat(miles.toFixed(1));
                finalDriveTime = parseFloat(((Date.now() - startTime) / 3600000).toFixed(2));
              }
            } catch {}

            await AsyncStorage.removeItem('activeTrip');

            const { error: err } = await supabase
              .from('trips')
              .update({
                status: 'completed',
                actual_end: new Date().toISOString(),
                miles: finalMiles,
                hours: finalDriveTime,
              })
              .eq('id', trip.id);

            if (err) { Alert.alert('Failed to end trip', err.message); return; }

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
  if (loading) return <View style={s.center}><ActivityIndicator color="#f5a623" /></View>;

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
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#f5a623" />}
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
              activeTrip={activeTrip}
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
              activeTrip={activeTrip}
            />
          ))}
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 20, paddingTop: 60, paddingBottom: 48 },
  center: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center' },
  sectionTitle: { fontSize: 10, color: '#444', letterSpacing: 2, fontWeight: '700', marginBottom: 10, marginTop: 4 },

  card: {
    backgroundColor: '#111', borderWidth: 1, borderColor: '#1e1e1e',
    borderLeftWidth: 3, padding: 16, marginBottom: 12,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  cardHeaderLeft: { flex: 1 },
  cardCrm: { fontSize: 12, color: '#555', letterSpacing: 1, fontWeight: '700', marginBottom: 2 },
  cardCity: { fontSize: 20, fontWeight: '900', color: '#fff' },
  statusBadge: { borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3, marginLeft: 8 },
  statusText: { fontSize: 9, fontWeight: '700', letterSpacing: 1.5 },

  cardMeta: { flexDirection: 'row', gap: 16, marginBottom: 8 },
  metaItem: { fontSize: 11, color: '#555' },
  notes: { fontSize: 12, color: '#666', fontStyle: 'italic', marginBottom: 8, marginTop: 4 },

  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 4 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4caf50' },
  liveText: { fontSize: 10, color: '#4caf50', letterSpacing: 2, fontWeight: '700' },
  liveMiles: { fontSize: 12, color: '#888', marginLeft: 4 },

  startBtn: { backgroundColor: '#f5a623', padding: 14, alignItems: 'center', marginTop: 12 },
  startBtnText: { color: '#0a0a0a', fontWeight: '900', fontSize: 13, letterSpacing: 2 },
  endBtn: { borderWidth: 2, borderColor: '#e05252', padding: 14, alignItems: 'center', marginTop: 12 },
  endBtnText: { color: '#e05252', fontWeight: '900', fontSize: 13, letterSpacing: 2 },
  waitingText: { fontSize: 11, color: '#444', fontStyle: 'italic', marginTop: 10, textAlign: 'center' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyTitle: { fontSize: 16, fontWeight: '900', color: '#333', letterSpacing: 2, marginBottom: 8 },
  emptySub: { fontSize: 12, color: '#444' },

  errorText: { color: '#555', fontSize: 14, marginBottom: 16 },
  retryBtn: { borderWidth: 1, borderColor: '#f5a623', paddingHorizontal: 24, paddingVertical: 10 },
  retryText: { color: '#f5a623', fontSize: 12, letterSpacing: 2, fontWeight: '700' },
});