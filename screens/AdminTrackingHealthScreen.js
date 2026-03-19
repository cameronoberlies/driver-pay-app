// ADMIN TRACKING HEALTH MONITOR
// Shows real-time status of ALL drivers' location tracking
// File: AdminTrackingHealthScreen.js

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { supabase } from '../lib/supabase';

export default function AdminTrackingHealthScreen() {
  const [locations, setLocations] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    const [locsRes, profsRes, tripsRes] = await Promise.all([
      supabase.from('driver_locations').select('*'),
      supabase.from('profiles').select('*').eq('role', 'driver'),
      supabase.from('trips').select('*').eq('status', 'in_progress'),
    ]);

    setLocations(locsRes.data || []);
    setProfiles(profsRes.data || []);
    setTrips(tripsRes.data || []);
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    await load();
  }

  const now = Date.now();

  // Get drivers with active trips
  const driversWithActiveTrips = trips.map(t => ({
    trip: t,
    driver: profiles.find(p => p.id === t.designated_driver_id),
    location: locations.find(l => l.driver_id === t.designated_driver_id),
  }));

  if (loading) {
    return (
      <View style={s.container}>
        <Text style={s.loading}>Loading...</Text>
      </View>
    );
  }

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.title}>TRACKING HEALTH</Text>
        <TouchableOpacity onPress={handleRefresh} style={s.refreshBtn}>
          <Text style={s.refreshText}>REFRESH</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={s.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
      >
        {driversWithActiveTrips.length === 0 && (
          <View style={s.emptyState}>
            <Text style={s.emptyText}>No active trips with tracking</Text>
          </View>
        )}

        {driversWithActiveTrips.map(({ trip, driver, location }) => {
          const age = location
            ? now - new Date(location.updated_at).getTime()
            : Infinity;
          const ageMinutes = Math.floor(age / 60000);
          const ageSeconds = Math.floor((age % 60000) / 1000);

          // Status determination
          let status = 'unknown';
          let statusColor = '#666';
          let statusText = 'NO DATA';

          if (!location) {
            status = 'no_data';
            statusColor = '#666';
            statusText = 'NO LOCATION DATA';
          } else if (age < 2 * 60 * 1000) {
            status = 'active';
            statusColor = '#4ae885';
            statusText = 'ACTIVE';
          } else if (age < 10 * 60 * 1000) {
            status = 'stale';
            statusColor = '#f5a623';
            statusText = 'STALE';
          } else {
            status = 'dead';
            statusColor = '#e05252';
            statusText = 'DEAD';
          }

          return (
            <View key={trip.id} style={s.card}>
              <View style={s.cardHeader}>
                <View style={s.cardLeft}>
                  <Text style={s.driverName}>{driver?.name || 'Unknown'}</Text>
                  <Text style={s.tripInfo}>
                    {trip.city} · {trip.crm_id}
                  </Text>
                </View>
                <View
                  style={[
                    s.statusBadge,
                    { borderColor: statusColor, backgroundColor: `${statusColor}15` },
                  ]}
                >
                  <Text style={[s.statusText, { color: statusColor }]}>
                    {statusText}
                  </Text>
                </View>
              </View>

              {location && (
                <View style={s.details}>
                  <DetailRow
                    label="Last Update"
                    value={
                      ageMinutes > 0
                        ? `${ageMinutes}m ${ageSeconds}s ago`
                        : `${ageSeconds}s ago`
                    }
                    alert={age > 2 * 60 * 1000}
                  />
                  <DetailRow
                    label="Coordinates"
                    value={`${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`}
                  />
                  <DetailRow
                    label="Trip Started"
                    value={
                      trip.actual_start
                        ? new Date(trip.actual_start).toLocaleTimeString()
                        : '—'
                    }
                  />
                  <DetailRow
                    label="Duration"
                    value={
                      trip.actual_start
                        ? formatDuration(
                            (now - new Date(trip.actual_start).getTime()) / 1000
                          )
                        : '—'
                    }
                  />
                </View>
              )}

              {!location && (
                <View style={s.noDataBox}>
                  <Text style={s.noDataText}>
                    No location data in database
                  </Text>
                  <Text style={s.noDataHint}>
                    Driver may not have started tracking or background task failed
                  </Text>
                </View>
              )}

              {/* Health indicators */}
              <View style={s.indicators}>
                <Indicator
                  label="GPS Signal"
                  status={location ? 'good' : 'bad'}
                />
                <Indicator
                  label="Update Frequency"
                  status={age < 2 * 60 * 1000 ? 'good' : age < 10 * 60 * 1000 ? 'warning' : 'bad'}
                />
                <Indicator
                  label="Background Task"
                  status={location && age < 5 * 60 * 1000 ? 'good' : 'unknown'}
                />
              </View>

              {/* Recommendations */}
              {age > 2 * 60 * 1000 && age < 10 * 60 * 1000 && (
                <View style={s.recommendation}>
                  <Text style={s.recIcon}>⚠️</Text>
                  <Text style={s.recText}>
                    Tracking is stale. Contact driver to check if app is still running.
                  </Text>
                </View>
              )}

              {age >= 10 * 60 * 1000 && (
                <View style={[s.recommendation, { backgroundColor: 'rgba(224, 82, 82, 0.1)', borderColor: '#e05252' }]}>
                  <Text style={s.recIcon}>🔴</Text>
                  <Text style={[s.recText, { color: '#e05252' }]}>
                    Tracking appears dead. Driver needs to restart the app or trip.
                  </Text>
                </View>
              )}
            </View>
          );
        })}

        {/* All drivers overview */}
        <View style={s.allDriversSection}>
          <Text style={s.sectionTitle}>ALL DRIVERS (Last 2 Hours)</Text>
          {locations.map((loc) => {
            const driver = profiles.find((p) => p.id === loc.driver_id);
            const age = now - new Date(loc.updated_at).getTime();
            const ageMinutes = Math.floor(age / 60000);
            const isActive = age < 2 * 60 * 1000;

            if (age > 2 * 60 * 60 * 1000) return null; // Skip if > 2 hours old

            return (
              <View key={loc.driver_id} style={s.driverRow}>
                <View
                  style={[
                    s.dot,
                    { backgroundColor: isActive ? '#4ae885' : '#f5a623' },
                  ]}
                />
                <Text style={s.driverRowName}>{driver?.name || 'Unknown'}</Text>
                <Text style={s.driverRowTime}>
                  {ageMinutes < 1 ? 'now' : `${ageMinutes}m ago`}
                </Text>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

function DetailRow({ label, value, alert }) {
  return (
    <View style={s.detailRow}>
      <Text style={s.detailLabel}>{label}</Text>
      <Text style={[s.detailValue, alert && { color: '#f5a623' }]}>
        {value}
      </Text>
    </View>
  );
}

function Indicator({ label, status }) {
  const colors = {
    good: '#4ae885',
    warning: '#f5a623',
    bad: '#e05252',
    unknown: '#666',
  };

  return (
    <View style={s.indicator}>
      <View style={[s.indicatorDot, { backgroundColor: colors[status] }]} />
      <Text style={s.indicatorLabel}>{label}</Text>
    </View>
  );
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d0f12',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1d24',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#d4d8df',
    letterSpacing: 1,
  },
  refreshBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#f5a623',
    borderRadius: 4,
  },
  refreshText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#f5a623',
    letterSpacing: 1,
  },
  scrollView: {
    flex: 1,
  },
  loading: {
    flex: 1,
    textAlign: 'center',
    marginTop: 100,
    color: '#6b7585',
  },
  emptyState: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 13,
    color: '#6b7585',
  },
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderWidth: 1,
    borderColor: '#1a1d24',
    borderRadius: 8,
    padding: 16,
    margin: 16,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  cardLeft: {
    flex: 1,
  },
  driverName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#d4d8df',
    marginBottom: 4,
  },
  tripInfo: {
    fontSize: 12,
    color: '#6b7585',
  },
  statusBadge: {
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  details: {
    borderTopWidth: 1,
    borderTopColor: '#1a1d24',
    paddingTop: 12,
    marginBottom: 12,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  detailLabel: {
    fontSize: 11,
    color: '#6b7585',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  detailValue: {
    fontSize: 12,
    color: '#d4d8df',
    fontWeight: '600',
  },
  noDataBox: {
    backgroundColor: 'rgba(107, 117, 133, 0.1)',
    padding: 12,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#1a1d24',
  },
  noDataText: {
    fontSize: 12,
    color: '#6b7585',
    fontWeight: '600',
    marginBottom: 4,
  },
  noDataHint: {
    fontSize: 11,
    color: '#6b7585',
    fontStyle: 'italic',
  },
  indicators: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 12,
  },
  indicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  indicatorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  indicatorLabel: {
    fontSize: 10,
    color: '#6b7585',
  },
  recommendation: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 12,
    padding: 10,
    backgroundColor: 'rgba(245, 166, 35, 0.1)',
    borderWidth: 1,
    borderColor: '#f5a623',
    borderRadius: 4,
  },
  recIcon: {
    fontSize: 14,
  },
  recText: {
    flex: 1,
    fontSize: 11,
    color: '#f5a623',
    lineHeight: 16,
  },
  allDriversSection: {
    margin: 16,
    marginTop: 24,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6b7585',
    letterSpacing: 1,
    marginBottom: 12,
  },
  driverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1d24',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 10,
  },
  driverRowName: {
    flex: 1,
    fontSize: 13,
    color: '#d4d8df',
  },
  driverRowTime: {
    fontSize: 11,
    color: '#6b7585',
  },
});