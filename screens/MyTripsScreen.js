import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, ActivityIndicator, Alert, RefreshControl,
} from 'react-native';
import * as Location from 'expo-location';
import { supabase } from '../lib/supabase';
import { getDistanceMiles, formatDuration } from '../lib/utils';

const LIVE_LOCATION_INTERVAL = 30000;
const TIMEOUT_MS = 8000;

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

      {/* Live tracking indicator */}
      {isActive && (
        <View style={s.liveRow}>
          <View style={s.liveDot} />
          <Text style={s.liveText}>TRACKING</Text>
          <Text style={s.liveMiles}>{(activeTrip.miles ?? 0).toFixed(1)} mi  ·  {formatDuration(activeTrip.elapsed ?? 0)}</Text>
        </View>
      )}

      {/* Action buttons */}
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
  const [activeTrip, setActiveTrip] = useState(null); // { id, miles, elapsed }

  const waypointsRef = useRef([]);
  const startTimeRef = useRef(null);
  const locationSubRef = useRef(null);
  const timerRef = useRef(null);
  const liveLocationTimerRef = useRef(null);
  const lastKnownLocationRef = useRef(null);
  const milesRef = useRef(0);

  useEffect(() => {
    return () => {
      if (locationSubRef.current) locationSubRef.current.remove();
      if (timerRef.current) clearInterval(timerRef.current);
      if (liveLocationTimerRef.current) clearInterval(liveLocationTimerRef.current);
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
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { load(); }, []);
  function onRefresh() { setRefreshing(true); load(); }

  // ── GPS helpers ──────────────────────────────────────────────────────────────

  const pushLiveLocation = async () => {
    if (!lastKnownLocationRef.current || !session?.user?.id) return;
    const { latitude, longitude } = lastKnownLocationRef.current;
    await supabase.from('driver_locations').upsert({
      driver_id: session.user.id,
      latitude,
      longitude,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'driver_id' });
  };

  const clearLiveLocation = async () => {
    if (!session?.user?.id) return;
    await supabase.from('driver_locations').delete().eq('driver_id', session.user.id);
  };

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

  // ── Start trip ───────────────────────────────────────────────────────────────

  async function handleStart(trip) {
    const permitted = await requestPermissions();
    if (!permitted) return;

    // Update trip status in Supabase
    const { error: err } = await supabase
      .from('trips')
      .update({ status: 'in_progress', actual_start: new Date().toISOString() })
      .eq('id', trip.id);

    if (err) { Alert.alert('Failed to start trip', err.message); return; }

    // Start GPS
    waypointsRef.current = [];
    milesRef.current = 0;
    startTimeRef.current = Date.now();

    const sub = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 10000, distanceInterval: 50 },
      (loc) => {
        const { latitude, longitude } = loc.coords;
        lastKnownLocationRef.current = { latitude, longitude };
        if (waypointsRef.current.length === 0) pushLiveLocation();
        const waypoints = waypointsRef.current;
        if (waypoints.length > 0) {
          const last = waypoints[waypoints.length - 1];
          const added = getDistanceMiles(last.lat, last.lon, latitude, longitude);
          milesRef.current += added;
          setActiveTrip(prev => prev ? { ...prev, miles: milesRef.current } : prev);
        }
        waypointsRef.current.push({ lat: latitude, lon: longitude });
      }
    );

    locationSubRef.current = sub;
    timerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setActiveTrip(prev => prev ? { ...prev, elapsed } : prev);
    }, 1000);
    liveLocationTimerRef.current = setInterval(pushLiveLocation, LIVE_LOCATION_INTERVAL);
    pushLiveLocation();

    setActiveTrip({ id: trip.id, miles: 0, elapsed: 0 });
    setTrips(prev => prev.map(t => t.id === trip.id ? { ...t, status: 'in_progress' } : t));
  }

  // ── End trip ─────────────────────────────────────────────────────────────────

  async function handleEnd(trip) {
    Alert.alert(
      'End Trip?',
      'This will stop GPS tracking and mark the trip as complete.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End Trip', style: 'destructive', onPress: async () => {
            // Stop GPS
            if (locationSubRef.current) { locationSubRef.current.remove(); locationSubRef.current = null; }
            if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
            if (liveLocationTimerRef.current) { clearInterval(liveLocationTimerRef.current); liveLocationTimerRef.current = null; }
            clearLiveLocation();

            const finalMiles = parseFloat(milesRef.current.toFixed(1));
            const finalDriveTime = parseFloat(((Date.now() - startTimeRef.current) / 3600000).toFixed(2));

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
            milesRef.current = 0;
            waypointsRef.current = [];
            lastKnownLocationRef.current = null;

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

  // ── Render ───────────────────────────────────────────────────────────────────

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
  content: { padding: 20, paddingTop: 20, paddingBottom: 48 },
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