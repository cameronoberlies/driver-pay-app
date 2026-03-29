import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  Modal,
  Alert,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { colors, spacing, radius, typography, components } from '../lib/theme';
import { flightAPI } from '../lib/flightAPI';
import useResponsive from '../lib/useResponsive';

export default function HomeScreen({ onManageUsers }) {
  const { isTablet } = useResponsive();
  const scrollRef = useRef(null);
  const tripsSectionY = useRef(0);
  const flightsSectionY = useRef(0);

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
  const [driverLocations, setDriverLocations] = useState([]);

  // Interactive state
  const [flightsFilterInAir, setFlightsFilterInAir] = useState(false);
  const [showActiveDriversModal, setShowActiveDriversModal] = useState(false);
  const [activeDriversList, setActiveDriversList] = useState([]);
  const [showTripModal, setShowTripModal] = useState(false);
  const [selectedTrip, setSelectedTrip] = useState(null);
  const [assigningDriver, setAssigningDriver] = useState(false);

  async function loadData() {
    try {
      const localNow = new Date();
      const today = `${localNow.getFullYear()}-${String(localNow.getMonth() + 1).padStart(2, '0')}-${String(localNow.getDate()).padStart(2, '0')}`;
      const thisMonth = today.slice(0, 7);

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
      setDriverLocations(locations);
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
    setFlightsFilterInAir(false);
    await loadData();
  }

  function formatTime(timeString) {
    if (!timeString) return '';
    const date = new Date(timeString);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  function formatRelativeTime(timestamp) {
    const delta = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
    if (delta < 60) return `${delta}s ago`;
    if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
    return `${Math.floor(delta / 3600)}h ago`;
  }

  // ── STAT CARD HANDLERS ──

  function handleTripsCardPress() {
    scrollRef.current?.scrollTo({ y: tripsSectionY.current, animated: true });
  }

  function handleFlightsCardPress() {
    setFlightsFilterInAir(true);
    scrollRef.current?.scrollTo({ y: flightsSectionY.current, animated: true });
  }

  function handleActiveDriversPress() {
    const now = new Date();
    const TWO_MIN = 2 * 60 * 1000;
    const active = driverLocations
      .filter((l) => now - new Date(l.updated_at) < TWO_MIN)
      .map((l) => {
        const prof = profiles.find((p) => p.id === l.driver_id);
        return { name: prof?.name || 'Unknown', updatedAt: l.updated_at };
      });
    setActiveDriversList(active);
    setShowActiveDriversModal(true);
  }

  // ── TRIP ASSIGNMENT ──

  async function handleSaveDriverAssignment() {
    if (!selectedTrip) return;

    const originalTrip = todaysTrips.find((t) => t.id === selectedTrip.id);
    if (
      originalTrip.driver_id === selectedTrip.driver_id &&
      originalTrip.second_driver_id === selectedTrip.second_driver_id
    ) {
      setShowTripModal(false);
      setSelectedTrip(null);
      return;
    }

    setAssigningDriver(true);

    const { error } = await supabase
      .from('trips')
      .update({
        driver_id: selectedTrip.driver_id,
        second_driver_id: selectedTrip.second_driver_id || null,
      })
      .eq('id', selectedTrip.id);

    setAssigningDriver(false);

    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    await loadData();
    setShowTripModal(false);
    setSelectedTrip(null);
  }

  // ── RENDER ──

  if (loading) {
    return (
      <View style={s.loader}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const drivers = profiles.filter((p) => p.role === 'driver');
  const displayedFlights = flightsFilterInAir
    ? todaysFlights.filter((f) => f.status === 'IN_AIR')
    : todaysFlights;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        ref={scrollRef}
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
        {/* Manage Users */}
        {onManageUsers && (
          <TouchableOpacity style={s.manageUsersBtn} onPress={onManageUsers} activeOpacity={0.75}>
            <Text style={s.manageUsersBtnText}>MANAGE USERS</Text>
          </TouchableOpacity>
        )}

        {/* TODAY'S SNAPSHOT */}
        <Text style={s.sectionTitle}>TODAY'S SNAPSHOT</Text>
        <View style={s.statsRow}>
          <TouchableOpacity style={s.statCard} activeOpacity={0.7} onPress={handleTripsCardPress}>
            <Text style={s.statLabel}>TRIPS SCHEDULED</Text>
            <Text style={s.statValue}>{stats.tripsScheduled}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.statCard} activeOpacity={0.7} onPress={handleFlightsCardPress}>
            <Text style={s.statLabel}>FLIGHTS IN AIR</Text>
            <Text style={s.statValue}>{stats.flightsInAir}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.statCard} activeOpacity={0.7} onPress={handleActiveDriversPress}>
            <Text style={s.statLabel}>ACTIVE DRIVERS</Text>
            <Text style={s.statValue}>{stats.activeDrivers}</Text>
          </TouchableOpacity>
        </View>

        {/* SCHEDULED TRIPS TODAY */}
        <View onLayout={(e) => { tripsSectionY.current = e.nativeEvent.layout.y; }}>
          <Text style={[s.sectionTitle, { marginTop: spacing.xxl }]}>SCHEDULED TRIPS TODAY</Text>
        </View>
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
            <TouchableOpacity
              key={trip.id}
              style={s.tripCard}
              activeOpacity={0.7}
              onPress={() => { setSelectedTrip({ ...trip }); setShowTripModal(true); }}
            >
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
            </TouchableOpacity>
          );
        })}

        {/* FLIGHTS TODAY */}
        <View onLayout={(e) => { flightsSectionY.current = e.nativeEvent.layout.y; }}>
          <Text style={[s.sectionTitle, { marginTop: spacing.xxl }]}>FLIGHTS TODAY</Text>
        </View>
        {flightsFilterInAir && (
          <TouchableOpacity
            style={s.filterChip}
            onPress={() => setFlightsFilterInAir(false)}
          >
            <Text style={s.filterChipText}>Showing IN AIR only   ✕</Text>
          </TouchableOpacity>
        )}
        {displayedFlights.length === 0 && (
          <View style={s.emptyState}>
            <Text style={s.emptyText}>
              {flightsFilterInAir ? 'No flights currently in air' : 'No flights scheduled for today'}
            </Text>
          </View>
        )}
        {displayedFlights.map((flight, idx) => (
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
          <View style={s.statCardStatic}>
            <Text style={s.statLabel}>TOTAL TRIPS</Text>
            <Text style={s.statValue}>{stats.monthTrips}</Text>
          </View>
          <View style={s.statCardStatic}>
            <Text style={s.statLabel}>TOTAL MILES</Text>
            <Text style={s.statValue}>{stats.monthMiles.toFixed(0)}</Text>
          </View>
          <View style={s.statCardStatic}>
            <Text style={s.statLabel}>AVG MILES/TRIP</Text>
            <Text style={s.statValue}>
              {stats.monthTrips > 0 ? (stats.monthMiles / stats.monthTrips).toFixed(0) : '—'}
            </Text>
          </View>
        </View>

        <View style={{ height: spacing.xxxxl }} />
      </ScrollView>

      {/* ACTIVE DRIVERS MODAL */}
      <Modal
        visible={showActiveDriversModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowActiveDriversModal(false)}
      >
        <TouchableOpacity
          style={s.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowActiveDriversModal(false)}
        >
          <View style={s.modalSheet}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}>ACTIVE DRIVERS</Text>
            {activeDriversList.length === 0 ? (
              <View style={s.emptyState}>
                <Text style={s.emptyText}>No drivers currently active</Text>
              </View>
            ) : (
              activeDriversList.map((d, i) => (
                <View key={i} style={s.activeDriverRow}>
                  <Text style={s.activeDriverName}>{d.name}</Text>
                  <Text style={s.activeDriverTime}>{formatRelativeTime(d.updatedAt)}</Text>
                </View>
              ))
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* TRIP DETAIL / ASSIGNMENT MODAL */}
      <Modal
        visible={showTripModal}
        transparent
        animationType="slide"
        onRequestClose={() => { setShowTripModal(false); setSelectedTrip(null); }}
      >
        <View style={s.modalOverlay}>
          <View style={s.tripModalSheet} onStartShouldSetResponder={() => true}>
            <View style={s.modalHandle} />
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={s.modalTitle}>TRIP DETAILS</Text>

              {selectedTrip && (
                <>
                  <View style={s.tripDetailCard}>
                    <View style={s.tripDetailRow}>
                      <Text style={s.tripDetailLabel}>PICKUP</Text>
                      <Text style={s.tripDetailValue}>{formatTime(selectedTrip.scheduled_pickup)}</Text>
                    </View>
                    <View style={s.tripDetailRow}>
                      <Text style={s.tripDetailLabel}>CITY</Text>
                      <Text style={s.tripDetailValue}>{selectedTrip.city}</Text>
                    </View>
                    <View style={s.tripDetailRow}>
                      <Text style={s.tripDetailLabel}>TYPE</Text>
                      <Text style={s.tripDetailValue}>
                        {selectedTrip.trip_type === 'fly' ? 'Fly' : 'Drive'}
                      </Text>
                    </View>
                    <View style={s.tripDetailRow}>
                      <Text style={s.tripDetailLabel}>STATUS</Text>
                      <Text style={s.tripDetailValue}>{selectedTrip.status?.toUpperCase()}</Text>
                    </View>
                    {selectedTrip.notes && (
                      <View style={s.tripDetailRow}>
                        <Text style={s.tripDetailLabel}>NOTES</Text>
                        <Text style={[s.tripDetailValue, { flex: 1 }]}>{selectedTrip.notes}</Text>
                      </View>
                    )}
                  </View>

                  {/* Driver 1 */}
                  <Text style={s.assignLabel}>ASSIGN DRIVER</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.pillScroll}>
                    {drivers.map((d) => (
                      <TouchableOpacity
                        key={d.id}
                        style={[s.driverPill, selectedTrip.driver_id === d.id && s.driverPillActive]}
                        onPress={() => setSelectedTrip((t) => ({ ...t, driver_id: d.id }))}
                      >
                        <Text style={[s.driverPillText, selectedTrip.driver_id === d.id && s.driverPillTextActive]}>
                          {d.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  {/* Driver 2 */}
                  <Text style={s.assignLabel}>SECOND DRIVER (OPTIONAL)</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.pillScroll}>
                    <TouchableOpacity
                      style={[s.driverPill, !selectedTrip.second_driver_id && s.driverPillActive]}
                      onPress={() => setSelectedTrip((t) => ({ ...t, second_driver_id: null }))}
                    >
                      <Text style={[s.driverPillText, !selectedTrip.second_driver_id && s.driverPillTextActive]}>
                        None
                      </Text>
                    </TouchableOpacity>
                    {drivers.filter((d) => d.id !== selectedTrip.driver_id).map((d) => (
                      <TouchableOpacity
                        key={d.id}
                        style={[s.driverPill, selectedTrip.second_driver_id === d.id && s.driverPillActive]}
                        onPress={() => setSelectedTrip((t) => ({ ...t, second_driver_id: d.id }))}
                      >
                        <Text style={[s.driverPillText, selectedTrip.second_driver_id === d.id && s.driverPillTextActive]}>
                          {d.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  <TouchableOpacity
                    style={[s.saveBtn, assigningDriver && { opacity: 0.4 }]}
                    onPress={handleSaveDriverAssignment}
                    disabled={assigningDriver}
                  >
                    <Text style={s.saveBtnText}>
                      {assigningDriver ? 'SAVING...' : 'SAVE CHANGES'}
                    </Text>
                  </TouchableOpacity>
                </>
              )}

              <TouchableOpacity
                style={s.closeModalBtn}
                onPress={() => { setShowTripModal(false); setSelectedTrip(null); }}
              >
                <Text style={s.closeModalBtnText}>CLOSE</Text>
              </TouchableOpacity>

              <View style={{ height: spacing.xxl }} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
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
  manageUsersBtn: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  manageUsersBtnText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2,
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
  statCardStatic: {
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

  // Filter chip
  filterChip: {
    alignSelf: 'flex-start',
    backgroundColor: colors.infoDim,
    borderWidth: 1,
    borderColor: colors.infoBorder,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginBottom: spacing.md,
  },
  filterChipText: {
    ...typography.captionSm,
    color: colors.info,
    fontWeight: '600',
  },

  // Modals
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.xxxxl,
    maxHeight: '60%',
  },
  tripModalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.xxxxl,
    maxHeight: '85%',
  },
  modalHandle: {
    width: 36,
    height: 4,
    backgroundColor: colors.borderLight,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.xl,
  },
  modalTitle: {
    ...typography.label,
    letterSpacing: 2,
    color: colors.textMuted,
    marginBottom: spacing.xl,
  },

  // Active drivers modal
  activeDriverRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  activeDriverName: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  activeDriverTime: {
    ...typography.caption,
    color: colors.textTertiary,
  },

  // Trip detail modal
  tripDetailCard: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  tripDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tripDetailLabel: {
    ...typography.labelSm,
    color: colors.textTertiary,
    letterSpacing: 1.5,
  },
  tripDetailValue: {
    ...typography.body,
    color: colors.textPrimary,
    textAlign: 'right',
  },

  // Driver assignment
  assignLabel: {
    ...typography.label,
    letterSpacing: 2,
    color: colors.textMuted,
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  pillScroll: {
    marginBottom: spacing.sm,
  },
  driverPill: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    marginRight: spacing.sm,
    backgroundColor: colors.surface,
  },
  driverPillActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryDim,
  },
  driverPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textTertiary,
  },
  driverPillTextActive: {
    color: colors.primary,
  },
  saveBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.xxl,
  },
  saveBtnText: {
    color: colors.bg,
    fontWeight: '800',
    fontSize: 14,
    letterSpacing: 1.5,
  },
  closeModalBtn: {
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  closeModalBtnText: {
    ...typography.labelSm,
    color: colors.textTertiary,
    letterSpacing: 1.5,
  },
});
