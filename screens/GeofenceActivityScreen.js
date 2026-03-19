// GEOFENCE ACTIVITY SCREEN
// Add to /screens/GeofenceActivityScreen.js

import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { supabase } from '../lib/supabase';

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
        <ActivityIndicator color="#f5a623" />
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
          tintColor="#f5a623" 
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
  const color = isExit ? '#f5a623' : '#4ae885';
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
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 20, paddingTop: 60, paddingBottom: 48 },
  center: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center' },

  statsBar: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  statBox: {
    flex: 1,
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#1e1e1e',
    padding: 16,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 28,
    fontWeight: '900',
    color: '#f5a623',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 9,
    color: '#555',
    letterSpacing: 1.5,
    fontWeight: '700',
  },

  sectionTitle: {
    fontSize: 10,
    color: '#444',
    letterSpacing: 2,
    fontWeight: '700',
    marginBottom: 10,
    marginTop: 4,
  },

  card: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#1e1e1e',
    borderLeftWidth: 3,
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  cardIcon: {
    fontSize: 24,
  },
  cardDriver: {
    fontSize: 16,
    fontWeight: '900',
    color: '#fff',
    marginBottom: 2,
  },
  cardAction: {
    fontSize: 10,
    letterSpacing: 1.5,
    fontWeight: '700',
  },
  cardTime: {
    fontSize: 11,
    color: '#666',
  },
  cardTrip: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
  },
  tripLabel: {
    fontSize: 10,
    color: '#666',
  },
  tripCity: {
    fontSize: 12,
    color: '#888',
    fontWeight: '600',
  },
  tripCrm: {
    fontSize: 11,
    color: '#555',
    fontFamily: 'Courier',
  },

  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#333',
    letterSpacing: 2,
    marginBottom: 8,
  },
  emptySub: {
    fontSize: 12,
    color: '#444',
  },
});