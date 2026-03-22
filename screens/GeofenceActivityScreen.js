// GEOFENCE ACTIVITY SCREEN
// Add to /screens/GeofenceActivityScreen.js

import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { colors, spacing, radius, typography } from '../lib/theme';

export default function GeofenceActivityScreen() {
  const [events, setEvents] = useState([]);
  const [profiles, setProfiles] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    try {
      // Get events from last 24 hours
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      
      const [{ data: eventsData }, { data: profilesData }] = await Promise.all([
        supabase
          .from('geofence_events')
          .select('*, trips(city, carpage_id, crm_id, trip_type)')
          .gte('created_at', yesterday)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('profiles')
          .select('id, name')
          .eq('role', 'driver'),
      ]);

      setEvents(eventsData ?? []);
      
      // Create profiles lookup map
      const profileMap = {};
      (profilesData ?? []).forEach(p => {
        profileMap[p.id] = p.name;
      });
      setProfiles(profileMap);
      
      setLoading(false);
      setRefreshing(false);
    } catch (err) {
      console.error('Geofence activity load error:', err);
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  function onRefresh() {
    setRefreshing(true);
    load();
  }

  function timeAgo(timestamp) {
    const now = Date.now();
    const then = new Date(timestamp).getTime();
    const diff = now - then;
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(mins / 60);
    
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  // Group events by today/earlier
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  const todayEvents = events.filter(e => new Date(e.created_at) >= todayStart);
  const earlierEvents = events.filter(e => new Date(e.created_at) < todayStart);

  return (
    <ScrollView 
      style={s.container}
      contentContainerStyle={s.content}
      refreshControl={
        <RefreshControl 
          refreshing={refreshing} 
          onRefresh={onRefresh} 
          tintColor={colors.primary}
        />
      }
    >
      {/* Stats bar */}
      <View style={s.statsBar}>
        <View style={s.statBox}>
          <Text style={s.statValue}>{todayEvents.length}</Text>
          <Text style={s.statLabel}>TODAY</Text>
        </View>
        <View style={s.statBox}>
          <Text style={s.statValue}>
            {todayEvents.filter(e => e.event_type === 'exit').length}
          </Text>
          <Text style={s.statLabel}>DEPARTURES</Text>
        </View>
        <View style={s.statBox}>
          <Text style={s.statValue}>
            {todayEvents.filter(e => e.event_type === 'enter').length}
          </Text>
          <Text style={s.statLabel}>ARRIVALS</Text>
        </View>
      </View>

      {/* Today's events */}
      {todayEvents.length > 0 && (
        <>
          <Text style={s.sectionTitle}>TODAY</Text>
          {todayEvents.map(event => (
            <EventCard 
              key={event.id} 
              event={event} 
              driverName={profiles[event.driver_id] || 'Unknown'}
              timeAgo={timeAgo}
            />
          ))}
        </>
      )}

      {/* Earlier events */}
      {earlierEvents.length > 0 && (
        <>
          <Text style={s.sectionTitle}>EARLIER</Text>
          {earlierEvents.map(event => (
            <EventCard 
              key={event.id} 
              event={event} 
              driverName={profiles[event.driver_id] || 'Unknown'}
              timeAgo={timeAgo}
            />
          ))}
        </>
      )}

      {events.length === 0 && (
        <View style={s.empty}>
          <Text style={s.emptyTitle}>NO GEOFENCE ACTIVITY</Text>
          <Text style={s.emptySub}>Driver entries/exits will appear here</Text>
        </View>
      )}
    </ScrollView>
  );
}

function EventCard({ event, driverName, timeAgo }) {
  const isExit = event.event_type === 'exit';
  const icon = isExit ? '🚗' : '🏁';
  const color = isExit ? colors.primary : colors.success;
  const action = isExit ? 'LEFT DEALERSHIP' : 'ARRIVED AT DEALERSHIP';

  return (
    <View style={[s.card, { borderLeftColor: color }]}>
      <View style={s.cardHeader}>
        <View style={s.cardLeft}>
          <Text style={s.cardIcon}>{icon}</Text>
          <View>
            <Text style={s.cardDriver}>{driverName}</Text>
            <Text style={[s.cardAction, { color }]}>{action}</Text>
          </View>
        </View>
        <Text style={s.cardTime}>{timeAgo(event.created_at)}</Text>
      </View>

      {event.trips && (
        <View style={s.cardTrip}>
          <Text style={s.tripLabel}>
            {event.trips.trip_type === 'fly' ? '✈ FLY' : '🚗 DRIVE'}
          </Text>
          <Text style={s.tripCity}>{event.trips.city}</Text>
          <Text style={s.tripCrm}>{event.trips.carpage_id || event.trips.crm_id || '—'}</Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.xxxxl },
  center: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' },

  statsBar: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.xxl,
  },
  statBox: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    alignItems: 'center',
  },
  statValue: {
    ...typography.displayMd,
    fontSize: 28,
    color: colors.primary,
    marginBottom: spacing.xs,
  },
  statLabel: {
    ...typography.labelSm,
    color: colors.textMuted,
  },

  sectionTitle: {
    ...typography.label,
    color: colors.textMuted,
    marginBottom: spacing.md,
    marginTop: spacing.xs,
  },

  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 3,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flex: 1,
  },
  cardIcon: {
    fontSize: 24,
  },
  cardDriver: {
    ...typography.h3,
    fontWeight: '900',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  cardAction: {
    ...typography.labelSm,
    fontSize: 10,
    letterSpacing: 1.5,
  },
  cardTime: {
    ...typography.captionSm,
    color: colors.textTertiary,
  },
  cardTrip: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  tripLabel: {
    fontSize: 10,
    color: colors.textTertiary,
  },
  tripCity: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  tripCrm: {
    ...typography.captionSm,
    color: colors.textMuted,
    fontFamily: 'Courier',
  },

  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  emptyTitle: {
    ...typography.h3,
    fontWeight: '900',
    color: colors.textMuted,
    letterSpacing: 2,
    marginBottom: spacing.sm,
  },
  emptySub: {
    ...typography.caption,
    color: colors.textMuted,
  },
});