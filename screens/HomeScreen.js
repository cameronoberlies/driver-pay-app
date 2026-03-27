import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { colors, spacing, radius, typography, components } from '../lib/theme';
import { flightAPI } from '../lib/flightAPI';
import useResponsive from '../lib/useResponsive';

export default function HomeScreen() {
  const { isTablet } = useResponsive();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState({
    tripsScheduled: 0,
    flightsInAir: 0,
    activeDrivers: 0,
    monthTrips: 0,
    monthMiles: 0,
  });
  const [todaysTrips, setTodaysTrips] = useState([]);
  const [todaysFlights, setTodaysFlights] = useState([]);
  const [profiles, setProfiles] = useState([]);

  async function loadData() {
    try {
      const localNow = new Date();
      const today = `${localNow.getFullYear()}-${String(localNow.getMonth() + 1).padStart(2, '0')}-${String(localNow.getDate()).padStart(2, '0')}`;
      const thisMonth = today.slice(0, 7);

      // Parallel queries
      const [tripsRes, locationsRes, profilesRes, entriesRes, flightsData] = await Promise.all([
        supabase
          .from('trips')
          .select('*')
          .gte('scheduled_pickup', today + 'T00:00:00')
          .lte('scheduled_pickup', today + 'T23:59:59')
          .order('scheduled_pickup', { ascending: true }),
        supabase.from('driver_locations').select('*'),
        supabase.from('profiles').select('*'),
        supabase.from('entries').select('*').like('date', thisMonth + '%'),
        flightAPI.getTodaysFlights(),
      ]);

      const trips = tripsRes.data || [];
      const locations = locationsRes.data || [];
      const profs = profilesRes.data || [];
      const entries = entriesRes.data || [];
      const flights = flightsData || [];

      // Calculate stats
      const now = new Date();
      const TWO_MIN = 2 * 60 * 1000;
      const activeDriverCount = locations.filter(
        (l) => now - new Date(l.updated_at) < TWO_MIN
      ).length;

      const flightsInAir = flights.filter((f) => f.status === 'IN_AIR').length;

      const monthTripCount = entries.length;
      const monthMiles = entries.reduce((sum, e) => sum + Number(e.miles || 0), 0);

      setStats({
        tripsScheduled: trips.length,
        flightsInAir,
        activeDrivers: activeDriverCount,
        monthTrips: monthTripCount,
        monthMiles,
      });

      setTodaysTrips(trips);
      setTodaysFlights(flights);
      setProfiles(profs);
    } catch (error) {
      console.error('Error loading home data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    await loadData();
  }

  function getDriverName(id) {
    return profiles.find((p) => p.id === id)?.name || 'Unknown';
  }

  function formatTime(timeString) {
    if (!timeString) return '';
    const date = new Date(timeString);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  if (loading) {
    return (
      <View style={s.loader}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={s.container}
      contentContainerStyle={[s.content, isTablet && { alignSelf: 'center', maxWidth: 700, width: '100%' }]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor={colors.primary}
        />
      }
    >
      {/* TODAY'S SNAPSHOT */}
      <Text style={s.sectionTitle}>TODAY'S SNAPSHOT</Text>
      <View style={s.statsRow}>
        <View style={s.statCard}>
          <Text style={s.statLabel}>TRIPS SCHEDULED</Text>
          <Text style={s.statValue}>{stats.tripsScheduled}</Text>
        </View>
        <View style={s.statCard}>
          <Text style={s.statLabel}>FLIGHTS IN AIR</Text>
          <Text style={s.statValue}>{stats.flightsInAir}</Text>
        </View>
        <View style={s.statCard}>
          <Text style={s.statLabel}>ACTIVE DRIVERS</Text>
          <Text style={s.statValue}>{stats.activeDrivers}</Text>
        </View>
      </View>

      {/* SCHEDULED TRIPS TODAY */}
      <Text style={[s.sectionTitle, { marginTop: spacing.xxl }]}>SCHEDULED TRIPS TODAY</Text>
      {todaysTrips.length === 0 && (
        <View style={s.emptyState}>
          <Text style={s.emptyText}>No trips scheduled for today</Text>
        </View>
      )}
      {todaysTrips.map((trip) => {
        const driver1 = profiles.find((p) => p.id === trip.driver_id);
        const driver2 = trip.second_driver_id
          ? profiles.find((p) => p.id === trip.second_driver_id)
          : null;

        return (
          <View key={trip.id} style={s.tripCard}>
            <View style={s.tripTop}>
              <Text style={s.tripTime}>{formatTime(trip.scheduled_pickup)}</Text>
              <View style={s.tripTypeBadge}>
                <Text style={s.tripTypeText}>
                  {trip.trip_type === 'fly' ? '✈ FLY' : '🚗 DRIVE'}
                </Text>
              </View>
            </View>
            <Text style={s.tripCity}>{trip.city}</Text>
            <Text style={s.tripDriver}>
              {driver1?.name || 'Unknown'}
              {driver2 && ` + ${driver2.name}`}
            </Text>
          </View>
        );
      })}

      {/* FLIGHTS TODAY */}
      <Text style={[s.sectionTitle, { marginTop: spacing.xxl }]}>FLIGHTS TODAY</Text>
      {todaysFlights.length === 0 && (
        <View style={s.emptyState}>
          <Text style={s.emptyText}>No flights scheduled for today</Text>
        </View>
      )}
      {todaysFlights.map((flight, idx) => (
        <View key={flight.id || flight.flight_number || idx} style={s.flightCard}>
          <View style={s.flightTop}>
            <Text style={s.flightNumber}>{flight.flight_number}</Text>
            <View style={[
              s.flightStatusBadge,
              { 
                backgroundColor: flight.status === 'IN_AIR' 
                  ? colors.infoDim 
                  : flight.status === 'LANDED'
                  ? colors.successDim
                  : colors.surfaceElevated
              }
            ]}>
              <Text style={[
                s.flightStatusText,
                {
                  color: flight.status === 'IN_AIR'
                    ? colors.info
                    : flight.status === 'LANDED'
                    ? colors.success
                    : colors.textTertiary
                }
              ]}>
                {flight.status === 'IN_AIR' ? '🛫 IN AIR' : flight.status === 'LANDED' ? '✅ LANDED' : '📅 SCHEDULED'}
              </Text>
            </View>
          </View>
          <Text style={s.flightRoute}>
            {flight.departure_airport} → {flight.arrival_airport}
          </Text>
          <Text style={s.flightPassenger}>{flight.passenger_name}</Text>
          {flight.estimated_arrival && (
            <Text style={s.flightEta}>
              ETA: {formatTime(flight.estimated_arrival)}
            </Text>
          )}
        </View>
      ))}

      {/* THIS MONTH */}
      <Text style={[s.sectionTitle, { marginTop: spacing.xxl }]}>THIS MONTH</Text>
      <View style={s.statsRow}>
        <View style={s.statCard}>
          <Text style={s.statLabel}>TOTAL TRIPS</Text>
          <Text style={s.statValue}>{stats.monthTrips}</Text>
        </View>
        <View style={s.statCard}>
          <Text style={s.statLabel}>TOTAL MILES</Text>
          <Text style={s.statValue}>{stats.monthMiles.toFixed(0)}</Text>
        </View>
        <View style={s.statCard}>
          <Text style={s.statLabel}>AVG MILES/TRIP</Text>
          <Text style={s.statValue}>
            {stats.monthTrips > 0 ? (stats.monthMiles / stats.monthTrips).toFixed(0) : '—'}
          </Text>
        </View>
      </View>

      <View style={{ height: spacing.xxxxl }} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: {
    ...components.screen,
  },
  content: {
    padding: spacing.xl,
  },
  loader: {
    ...components.center,
  },
  sectionTitle: {
    ...typography.label,
    letterSpacing: 2,
    color: colors.textMuted,
    marginBottom: spacing.lg,
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  statLabel: {
    ...typography.labelSm,
    color: colors.textTertiary,
    letterSpacing: 1.5,
    marginBottom: spacing.xs,
  },
  statValue: {
    ...typography.h2,
    color: colors.primary,
  },
  tripCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  tripTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  tripTime: {
    ...typography.body,
    fontWeight: '700',
    color: colors.primary,
  },
  tripTypeBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryDim,
  },
  tripTypeText: {
    ...typography.captionSm,
    color: colors.primary,
    fontWeight: '600',
  },
  tripCity: {
    ...typography.h3,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  tripDriver: {
    ...typography.caption,
    color: colors.textTertiary,
  },
  flightCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 3,
    borderLeftColor: colors.info,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  flightTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  flightNumber: {
    ...typography.body,
    fontWeight: '700',
    color: colors.info,
  },
  flightStatusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  flightStatusText: {
    ...typography.captionSm,
    fontWeight: '600',
  },
  flightRoute: {
    ...typography.bodySm,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  flightPassenger: {
    ...typography.caption,
    color: colors.textTertiary,
    marginBottom: spacing.xs,
  },
  flightEta: {
    ...typography.caption,
    color: colors.textTertiary,
  },
  emptyState: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyText: {
    ...typography.bodySm,
    color: colors.textMuted,
  },
});