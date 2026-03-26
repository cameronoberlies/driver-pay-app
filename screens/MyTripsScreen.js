import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, ActivityIndicator, Alert, RefreshControl,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { getDistanceMiles, formatDuration } from '../lib/utils';
import { colors, spacing, radius, typography, components } from '../lib/theme';
import useResponsive from '../lib/useResponsive';
import GoogleMapsService from '../lib/GoogleMapsService';

const TIMEOUT_MS = 8000;

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
  const { isTablet } = useResponsive();
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [activeTrip, setActiveTrip] = useState(null);
  const [unreadCounts, setUnreadCounts] = useState({});

  const startTimeRef = useRef(null);
  const timerRef = useRef(null);

  // ── Cleanup on unmount ───────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
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
        const miles = inProgress.miles ?? 0;
        const startTime = inProgress.actual_start ? new Date(inProgress.actual_start).getTime() : Date.now();
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

  // ── Start trip ───────────────────────────────────────────────────────────
  async function handleStart(trip) {
    // Start GPS tracking
    const result = await GoogleMapsService.startTripTracking(trip.id);

    if (!result.success) {
      Alert.alert('Tracking Warning', result.error || 'GPS tracking may not work');
      // Continue anyway - manual time tracking is fallback
    }

    // Update trip status in database
    const { error: err } = await supabase
      .from('trips')
      .update({
        status: 'in_progress',
        actual_start: new Date().toISOString(),
        radar_external_id: trip.id,
      })
      .eq('id', trip.id);

    if (err) { Alert.alert('Failed to start trip', err.message); return; }

    const startTime = Date.now();
    startTimeRef.current = startTime;

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
  }

  // ── End trip ─────────────────────────────────────────────────────────────
  async function handleEnd(trip) {
    Alert.alert(
      'End Trip?',
      'This will stop tracking and mark the trip as complete.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End Trip', style: 'destructive', onPress: async () => {
            if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

            // Stop GPS tracking and get route data
            const result = await GoogleMapsService.stopTripTracking(trip.id, session.user.id);

            // Calculate hours from timestamps (fallback if GPS fails)
            const startTime = new Date(trip.actual_start);
            const endTime = new Date();
            const manualHours = ((endTime - startTime) / (1000 * 60 * 60)).toFixed(2);

            // Update trip with GPS data (or fallback to manual)
            const finalMiles = result.success && result.tripData.actual_distance_miles
              ? parseFloat(result.tripData.actual_distance_miles)
              : trip.miles || 0;
            const finalHours = result.success
              ? parseFloat(result.tripData.hours)
              : parseFloat(manualHours);

            const { error: err } = await supabase
              .from('trips')
              .update({
                status: 'completed',
                actual_end: endTime.toISOString(),
                hours: finalHours,
                miles: finalMiles,
                actual_distance_miles: result.tripData?.actual_distance_miles,
                actual_duration_minutes: result.tripData?.actual_duration_minutes,
                route_geojson: result.tripData?.route_geojson,
              })
              .eq('id', trip.id);

            if (err) { Alert.alert('Failed to end trip', err.message); return; }

            // If drive trip with second driver, copy data
            if (trip.trip_type === 'drive' && trip.second_driver_id) {
              await copyToSecondDriver(trip, result.tripData);
            }

            setActiveTrip(null);
            setTrips(prev => prev.map(t =>
              t.id === trip.id
                ? { ...t, status: 'completed', miles: finalMiles, hours: finalHours }
                : t
            ));
          }
        },
      ]
    );
  }

  async function copyToSecondDriver(trip, tripData) {
    try {
      await supabase
        .from('trips')
        .update({
          actual_distance_miles: tripData?.actual_distance_miles,
          actual_duration_minutes: tripData?.actual_duration_minutes,
          route_geojson: tripData?.route_geojson,
        })
        .eq('id', trip.id)
        .eq('second_driver_id', trip.second_driver_id);
    } catch (e) {
      console.warn('Failed to copy trip data to second driver:', e.message);
    }
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