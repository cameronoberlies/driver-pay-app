import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, ActivityIndicator, Alert, RefreshControl, AppState,
} from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { supabase } from '../lib/supabase';
import { getDistanceMiles, formatDuration } from '../lib/utils';
import { colors, spacing, radius, typography, components } from '../lib/theme';

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
    const { tripId, userId, lastLat, lastLon, miles, startTime } = JSON.parse(stored);

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
        process.env.EXPO_PUBLIC_SUPABASE_URL,
        process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
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
      process.env.EXPO_PUBLIC_SUPABASE_URL,
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${accessToken}` } } }
    );

    const loc = locations[locations.length - 1];
    const { latitude, longitude } = loc.coords;

    let newMiles = miles;
    if (lastLat && lastLon) {
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

function TripCard({ trip, currentUserId, onStart, onEnd, activeTrip, unreadCount, onChatPress }) {
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
        const { latitude, longitude } = loc.coords;

        // Push live location to DB for admin Live Drivers view
        await supabase.from('driver_locations').upsert({
          driver_id: session.user.id,
          latitude,
          longitude,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'driver_id' });

        // Accumulate miles in AsyncStorage (same logic as background task)
        try {
          const stored = await AsyncStorage.getItem('activeTrip');
          if (!stored) return;
          const tripData = JSON.parse(stored);
          let newMiles = tripData.miles || 0;

          if (tripData.lastLat && tripData.lastLon) {
            newMiles += getDistanceMiles(tripData.lastLat, tripData.lastLon, latitude, longitude);
          }

          await AsyncStorage.setItem('activeTrip', JSON.stringify({
            ...tripData,
            lastLat: latitude,
            lastLon: longitude,
            miles: newMiles,
          }));

          // Update UI with new miles
          setActiveTrip(prev => prev ? { ...prev, miles: newMiles } : prev);
        } catch {}
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
      contentContainerStyle={s.content}
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
  liveText: { ...typography.labelSm, fontSize: 10, color: colors.success, letterSpacing: 2 },
  liveMiles: { ...typography.caption, color: colors.textSecondary, marginLeft: spacing.xs },

  startBtn: { backgroundColor: colors.primary, borderRadius: radius.sm, padding: spacing.md, alignItems: 'center', marginTop: spacing.md },
  startBtnText: { color: colors.bg, fontWeight: '900', fontSize: 13, letterSpacing: 2 },
  endBtn: { borderWidth: 2, borderColor: colors.error, borderRadius: radius.sm, padding: spacing.md, alignItems: 'center', marginTop: spacing.md },
  endBtnText: { color: colors.error, fontWeight: '900', fontSize: 13, letterSpacing: 2 },
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