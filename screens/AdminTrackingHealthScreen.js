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
import { colors, spacing, radius, typography } from '../lib/theme';
import useResponsive from '../lib/useResponsive';

export default function AdminTrackingHealthScreen() {
  const { isTablet } = useResponsive();
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
        contentContainerStyle={isTablet ? { alignSelf: 'center', maxWidth: 700, width: '100%' } : undefined}
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
          let statusColor = colors.textTertiary;
          let statusText = 'NO DATA';

          if (!location) {
            status = 'no_data';
            statusColor = colors.textTertiary;
            statusText = 'NO LOCATION DATA';
          } else if (age < 2 * 60 * 1000) {
            status = 'active';
            statusColor = colors.success;
            statusText = 'ACTIVE';
          } else if (age < 10 * 60 * 1000) {
            status = 'stale';
            statusColor = colors.primary;
            statusText = 'STALE';
          } else {
            status = 'dead';
            statusColor = colors.error;
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
                <View style={[s.recommendation, { backgroundColor: colors.errorDim, borderColor: colors.error }]}>
                  <Text style={s.recIcon}>🔴</Text>
                  <Text style={[s.recText, { color: colors.error }]}>
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
                    { backgroundColor: isActive ? colors.success : colors.primary },
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
      <Text style={[s.detailValue, alert && { color: colors.primary }]}>
        {value}
      </Text>
    </View>
  );
}

function Indicator({ label, status }) {
  const indicatorColors = {
    good: colors.success,
    warning: colors.primary,
    bad: colors.error,
    unknown: colors.textTertiary,
  };

  return (
    <View style={s.indicator}>
      <View style={[s.indicatorDot, { backgroundColor: indicatorColors[status] }]} />
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
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    ...typography.h3,
    color: colors.textPrimary,
    letterSpacing: 1,
  },
  refreshBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.sm,
  },
  refreshText: {
    ...typography.captionSm,
    fontWeight: '700',
    color: colors.primary,
    letterSpacing: 1,
  },
  scrollView: {
    flex: 1,
  },
  loading: {
    flex: 1,
    textAlign: 'center',
    marginTop: 100,
    color: colors.textTertiary,
  },
  emptyState: {
    padding: spacing.xxxxl,
    alignItems: 'center',
  },
  emptyText: {
    ...typography.bodySm,
    color: colors.textTertiary,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    margin: spacing.lg,
    marginBottom: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  cardLeft: {
    flex: 1,
  },
  driverName: {
    ...typography.h3,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  tripInfo: {
    ...typography.caption,
    color: colors.textTertiary,
  },
  statusBadge: {
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  statusText: {
    ...typography.labelSm,
    letterSpacing: 0.5,
  },
  details: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    marginBottom: spacing.md,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  detailLabel: {
    ...typography.captionSm,
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  detailValue: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  noDataBox: {
    backgroundColor: colors.surfaceElevated,
    padding: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  noDataText: {
    ...typography.caption,
    color: colors.textTertiary,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  noDataHint: {
    ...typography.captionSm,
    color: colors.textTertiary,
    fontStyle: 'italic',
  },
  indicators: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginTop: spacing.md,
  },
  indicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  indicatorDot: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
  },
  indicatorLabel: {
    fontSize: 10,
    color: colors.textTertiary,
  },
  recommendation: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.primaryDim,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.sm,
  },
  recIcon: {
    fontSize: 14,
  },
  recText: {
    flex: 1,
    ...typography.captionSm,
    color: colors.primary,
    lineHeight: 16,
  },
  allDriversSection: {
    margin: spacing.lg,
    marginTop: spacing.xxl,
  },
  sectionTitle: {
    ...typography.label,
    color: colors.textTertiary,
    marginBottom: spacing.md,
  },
  driverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
    marginRight: spacing.md,
  },
  driverRowName: {
    flex: 1,
    ...typography.bodySm,
    color: colors.textPrimary,
  },
  driverRowTime: {
    ...typography.captionSm,
    color: colors.textTertiary,
  },
});