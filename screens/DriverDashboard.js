import React, { useEffect, useState, useRef } from "react";

import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Platform,
  Modal,
} from "react-native";

import { supabase } from "../lib/supabase";
import { getWeekBounds, getMonthBounds, withTimeout } from "../lib/utils";
import { colors, spacing, radius, typography, components } from "../lib/theme";
import UpcomingFlightCard from "../components/UpcomingFlightCard";
import DriverPhoneBookModal from '../components/DriverPhoneBookModal';
import useResponsive from '../lib/useResponsive';

const TIMEOUT_MS = 8000;

export default function DriverDashboard({ session }) {
  const { isTablet } = useResponsive();
  const [profile, setProfile] = useState(null);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [phoneBookVisible, setPhoneBookVisible] = useState(false);
  const [weekExpanded, setWeekExpanded] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [nextTrip, setNextTrip] = useState(null);
  const [countdown, setCountdown] = useState('');
  const countdownRef = useRef(null);

  const fetchData = async () => {
    setError(false);
    const userId = session.user.id;
    try {
      const [{ data: prof }, { data: ents }, { data: trips }] = await withTimeout(
        Promise.all([
          supabase
            .from("profiles")
            .select("name, role")
            .eq("id", userId)
            .single(),
          supabase
            .from("entries")
            .select("*")
            .eq("driver_id", userId)
            .order("date", { ascending: false }),
          supabase
            .from("trips")
            .select("*")
            .or(`driver_id.eq.${userId},second_driver_id.eq.${userId}`)
            .eq("status", "pending")
            .gte("scheduled_pickup", new Date().toISOString())
            .order("scheduled_pickup", { ascending: true })
            .limit(1),
        ]),
        TIMEOUT_MS,
      );
      setProfile(prof);
      setEntries(ents || []);
      setNextTrip(trips?.[0] || null);
    } catch (err) {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Countdown timer
  useEffect(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (!nextTrip?.scheduled_pickup) {
      setCountdown('');
      return;
    }

    function updateCountdown() {
      const now = Date.now();
      const pickup = new Date(nextTrip.scheduled_pickup).getTime();
      const diff = pickup - now;

      if (diff <= 0) {
        setCountdown('NOW');
        return;
      }

      const hours = Math.floor(diff / 3600000);
      const minutes = Math.floor((diff % 3600000) / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);

      if (hours > 24) {
        const days = Math.floor(hours / 24);
        const remainHours = hours % 24;
        setCountdown(`${days}d ${remainHours}h`);
      } else if (hours > 0) {
        setCountdown(`${hours}h ${minutes}m`);
      } else {
        setCountdown(`${minutes}m ${seconds}s`);
      }
    }

    updateCountdown();
    countdownRef.current = setInterval(updateCountdown, 1000);
    return () => clearInterval(countdownRef.current);
  }, [nextTrip]);

  useEffect(() => {
    fetchData();
  }, []);
  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
  };
  const handleSignOut = () => supabase.auth.signOut();

  const { start: wStart, end: wEnd } = getWeekBounds();
  const { start: mStart, end: mEnd } = getMonthBounds();

  const weekEntries = entries.filter((e) => {
    const d = new Date(e.date);
    return d >= wStart && d <= wEnd;
  });
  const monthEntries = entries.filter((e) => {
    const d = new Date(e.date);
    return d >= mStart && d <= mEnd;
  });

  const weekPay = weekEntries.reduce((s, e) => s + Number(e.pay), 0);
  const weekHours = weekEntries.reduce((s, e) => s + Number(e.hours), 0);
  const weekMiles = weekEntries.reduce((s, e) => s + Number(e.miles || 0), 0);
  const monthTrips = monthEntries.length;

  const tripBonus = monthTrips >= 20;
  const sortedEntries = [...entries].sort(
    (a, b) => new Date(b.date) - new Date(a.date),
  );
  let reconStreak = 0;
  for (const e of sortedEntries) {
    if (e.recon_missed) break;
    reconStreak++;
  }
  const reconBonus = reconStreak >= 25;

  if (loading)
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );

  if (error)
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Failed to load data</Text>
        <TouchableOpacity
          style={styles.retryBtn}
          onPress={() => {
            setLoading(true);
            fetchData();
          }}
        >
          <Text style={styles.retryText}>RETRY</Text>
        </TouchableOpacity>
      </View>
    );

  return (
    <>
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { maxWidth: 700, alignSelf: 'center', width: '100%' }]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.primary}
        />
      }
    >
      <View style={styles.header}>
        <View style={{ flex: 1, marginRight: spacing.md }}>
          <Text style={styles.greeting} numberOfLines={1}>
            Hey, {profile?.name?.split(" ")[0]}.
          </Text>
          <Text style={styles.period}>
            PAY PERIOD:{" "}
            {wStart.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}{" "}
            –{" "}
            {wEnd.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </Text>
        </View>

        <View style={styles.headerRight}>
          <TouchableOpacity
            onPress={() => setPhoneBookVisible(true)}
            style={styles.phoneBtn}
          >
            <Text style={styles.phoneIcon}>📞</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={handleSignOut} style={styles.signOutBtn}>
            <Text style={styles.signOutText}>SIGN OUT</Text>
          </TouchableOpacity>
        </View>
      </View>

      {nextTrip && (
        <View style={styles.countdownCard}>
          <View style={styles.countdownTop}>
            <Text style={styles.countdownLabel}>NEXT TRIP</Text>
            <View style={styles.countdownTypeBadge}>
              <Text style={styles.countdownTypeText}>
                {nextTrip.trip_type === 'fly' ? '✈ FLY' : '🚗 DRIVE'}
              </Text>
            </View>
          </View>
          <Text style={styles.countdownCity}>{nextTrip.city}</Text>
          <Text style={styles.countdownTime}>
            {new Date(nextTrip.scheduled_pickup).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            {' at '}
            {new Date(nextTrip.scheduled_pickup).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          </Text>
          <View style={styles.countdownTimerRow}>
            <Text style={styles.countdownTimerValue}>{countdown}</Text>
            <Text style={styles.countdownTimerLabel}>{countdown === 'NOW' ? '— time to go!' : 'until pickup'}</Text>
          </View>
        </View>
      )}

      <TouchableOpacity
        style={styles.heroCard}
        activeOpacity={0.7}
        onPress={() => setWeekExpanded((v) => !v)}
      >
        <View style={styles.heroTop}>
          <Text style={styles.heroLabel}>THIS WEEK'S EARNINGS</Text>
          <Text style={styles.heroChevron}>{weekExpanded ? '▲' : '▼'}</Text>
        </View>
        <Text style={styles.heroValue}>${weekPay.toFixed(2)}</Text>
        <View style={styles.heroRow}>
          <Text style={styles.heroStat}>{weekEntries.length} trips</Text>
          <Text style={styles.heroDot}>·</Text>
          <Text style={styles.heroStat}>{weekHours}h worked</Text>
          <Text style={styles.heroDot}>·</Text>
          <Text style={styles.heroStat}>{weekMiles.toFixed(0)} mi</Text>
        </View>
      </TouchableOpacity>

      {weekExpanded && (
        <View style={styles.weekBreakdown}>
          {weekEntries.length === 0 ? (
            <Text style={styles.weekEmptyText}>No trips this week yet</Text>
          ) : (
            weekEntries
              .sort((a, b) => new Date(b.date) - new Date(a.date))
              .map((e) => (
                <View key={e.id} style={styles.weekRow}>
                  <View style={styles.weekRowLeft}>
                    <Text style={styles.weekCity}>{e.city}</Text>
                    <Text style={styles.weekMeta}>
                      {new Date(e.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                      {e.miles ? `  ·  ${e.miles} mi` : ''}
                    </Text>
                  </View>
                  <Text style={styles.weekPay}>${Number(e.pay).toFixed(2)}</Text>
                </View>
              ))
          )}
        </View>
      )}

      <UpcomingFlightCard driverName={profile?.name} />

      <Text style={styles.sectionLabel}>BONUS PROGRESS</Text>
      <View style={styles.bonusRow}>
        <View style={[styles.bonusCard, tripBonus && styles.bonusEarned]}>
          <Text style={styles.bonusTitle}>TRIP BONUS</Text>
          <Text style={styles.bonusAmount}>$50</Text>
          <Text style={styles.bonusDesc}>
            {monthTrips} / 20 trips this month
          </Text>
          {tripBonus && <Text style={styles.bonusTag}>✓ EARNED</Text>}
        </View>
        <View style={[styles.bonusCard, reconBonus && styles.bonusEarned]}>
          <Text style={styles.bonusTitle}>RECON STREAK</Text>
          <Text style={styles.bonusAmount}>$50</Text>
          <Text style={styles.bonusDesc}>{reconStreak} / 25 consecutive</Text>
          {reconBonus && <Text style={styles.bonusTag}>✓ EARNED</Text>}
        </View>
      </View>

      <Text style={styles.sectionLabel}>RECENT TRIPS</Text>
      {entries.slice(0, 10).map((entry) => (
        <TouchableOpacity
          key={entry.id}
          style={styles.tripRow}
          activeOpacity={0.7}
          onPress={() => setSelectedEntry(entry)}
        >
          <View style={styles.tripLeft}>
            <Text style={styles.tripCity}>{entry.city}</Text>
            <Text style={styles.tripMeta}>
              {new Date(entry.date).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
              {entry.miles ? `  ·  ${entry.miles} mi` : ""}
              {entry.hours ? `  ·  ${entry.hours}h` : ""}
            </Text>
          </View>
          <View style={styles.tripRight}>
            <Text style={styles.tripPay}>${Number(entry.pay).toFixed(2)}</Text>
            {entry.recon_missed && <Text style={styles.missedTag}>MISSED</Text>}
          </View>
        </TouchableOpacity>
      ))}
    </ScrollView>
    {/* Trip Detail Modal */}
    <Modal
      visible={!!selectedEntry}
      transparent
      animationType="slide"
      onRequestClose={() => setSelectedEntry(null)}
    >
      <TouchableOpacity
        style={styles.modalOverlay}
        activeOpacity={1}
        onPress={() => setSelectedEntry(null)}
      >
        <View style={styles.modalSheet} onStartShouldSetResponder={() => true}>
          <View style={styles.modalHandle} />
          {selectedEntry && (
            <>
              <View style={styles.detailHeader}>
                <Text style={styles.detailCity}>{selectedEntry.city}</Text>
                <Text style={styles.detailPay}>${Number(selectedEntry.pay).toFixed(2)}</Text>
              </View>
              <View style={styles.detailCard}>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>DATE</Text>
                  <Text style={styles.detailValue}>
                    {new Date(selectedEntry.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                  </Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>HOURS</Text>
                  <Text style={styles.detailValue}>{selectedEntry.hours ?? '—'}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>MILES</Text>
                  <Text style={styles.detailValue}>{selectedEntry.miles ?? '—'}</Text>
                </View>
                {selectedEntry.drive_time != null && (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>GPS DRIVE TIME</Text>
                    <Text style={styles.detailValue}>{selectedEntry.drive_time}h</Text>
                  </View>
                )}
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>CRM ID</Text>
                  <Text style={styles.detailValue}>{selectedEntry.crm_id || '—'}</Text>
                </View>
                <View style={[styles.detailRow, { borderBottomWidth: 0 }]}>
                  <Text style={styles.detailLabel}>RECON</Text>
                  <Text style={[styles.detailValue, selectedEntry.recon_missed && { color: colors.error }]}>
                    {selectedEntry.recon_missed ? 'MISSED' : 'OK'}
                  </Text>
                </View>
              </View>
            </>
          )}
        </View>
      </TouchableOpacity>
    </Modal>

    <DriverPhoneBookModal
      visible={phoneBookVisible}
      onClose={() => setPhoneBookVisible(false)}
    />
  </>
  );
}

const styles = StyleSheet.create({
  container: {
    ...components.screen,
  },
  content: {
    padding: spacing.xxl,
    paddingBottom: spacing.xxxxl,
  },
  center: {
    ...components.center,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: spacing.xxxl,
    paddingTop: 60,
    paddingHorizontal: Platform.isPad ? spacing.xxl : 0,
  },
  greeting: {
    ...typography.displaySm,
    fontSize: 26,
    color: colors.textPrimary,
    letterSpacing: 0.5,
  },
  period: {
    ...typography.labelSm,
    fontSize: 10,
    color: colors.textTertiary,
    letterSpacing: 2,
    marginTop: spacing.xs,
  },
  signOutBtn: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: radius.sm,
  },
  signOutText: {
    ...typography.labelSm,
    fontSize: 10,
    color: colors.textTertiary,
    letterSpacing: 1.5,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  phoneBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  phoneIcon: {
    fontSize: 18,
  },
  // Countdown
  countdownCard: {
    ...components.cardAccent(colors.info),
    padding: spacing.xxl,
    marginBottom: spacing.md,
  },
  countdownTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  countdownLabel: {
    ...typography.labelSm,
    fontSize: 10,
    color: colors.info,
    letterSpacing: 2.5,
  },
  countdownTypeBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.infoDim,
  },
  countdownTypeText: {
    ...typography.captionSm,
    color: colors.info,
    fontWeight: '600',
  },
  countdownCity: {
    ...typography.h1,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  countdownTime: {
    ...typography.bodySm,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  countdownTimerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  countdownTimerValue: {
    ...typography.displayMd,
    color: colors.info,
  },
  countdownTimerLabel: {
    ...typography.bodySm,
    color: colors.textTertiary,
  },

  heroCard: {
    ...components.cardAccent(colors.primary),
    padding: spacing.xxl,
    marginBottom: spacing.md,
  },
  heroTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  heroLabel: {
    ...typography.labelSm,
    fontSize: 10,
    color: colors.textSecondary,
    letterSpacing: 2.5,
    marginBottom: spacing.sm,
  },
  heroChevron: {
    fontSize: 12,
    color: colors.primary,
  },
  heroValue: {
    ...typography.displayLg,
    color: colors.primary,
  },
  heroRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  heroStat: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
  heroDot: {
    ...typography.bodySm,
    color: colors.textMuted,
  },
  sectionLabel: {
    ...typography.labelSm,
    fontSize: 10,
    color: colors.textTertiary,
    letterSpacing: 3,
    marginBottom: spacing.md,
  },
  bonusRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginBottom: spacing.xxxl,
  },
  bonusCard: {
    ...components.card,
    flex: 1,
    marginBottom: 0,
  },
  bonusEarned: {
    borderColor: colors.primary,
  },
  bonusTitle: {
    ...typography.labelSm,
    color: colors.textTertiary,
    letterSpacing: 2,
    marginBottom: spacing.sm,
  },
  bonusAmount: {
    ...typography.displaySm,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  bonusDesc: {
    ...typography.captionSm,
    color: colors.textTertiary,
  },
  bonusTag: {
    ...typography.caption,
    fontSize: 10,
    color: colors.primary,
    fontWeight: "700",
    marginTop: spacing.sm,
    letterSpacing: 1,
  },
  tripRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceElevated,
  },
  tripLeft: {
    flex: 1,
  },
  tripCity: {
    ...typography.h3,
    fontSize: 15,
    color: colors.textPrimary,
  },
  tripMeta: {
    ...typography.caption,
    color: colors.textTertiary,
    marginTop: spacing.xs,
  },
  tripRight: {
    alignItems: "flex-end",
  },
  tripPay: {
    ...typography.h2,
    fontSize: 16,
    color: colors.primary,
  },
  missedTag: {
    ...typography.labelSm,
    color: colors.error,
    letterSpacing: 1,
    marginTop: spacing.xs,
  },
  // Week breakdown
  weekBreakdown: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.xxxl,
  },
  weekEmptyText: {
    ...typography.bodySm,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
  weekRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  weekRowLeft: {
    flex: 1,
  },
  weekCity: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  weekMeta: {
    ...typography.captionSm,
    color: colors.textTertiary,
    marginTop: 2,
  },
  weekPay: {
    ...typography.h3,
    color: colors.primary,
  },

  // Trip detail modal
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
  detailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  detailCity: {
    ...typography.h1,
    color: colors.textPrimary,
  },
  detailPay: {
    ...typography.displaySm,
    color: colors.primary,
  },
  detailCard: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  detailLabel: {
    ...typography.labelSm,
    color: colors.textTertiary,
    letterSpacing: 1.5,
  },
  detailValue: {
    ...typography.body,
    color: colors.textPrimary,
  },

  errorText: {
    ...components.errorText,
  },
  retryBtn: {
    ...components.retryBtn,
  },
  retryText: {
    ...components.retryText,
  },
});
