import React, { useEffect, useState } from "react";

import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Platform,
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

  const fetchData = async () => {
    setError(false);
    const userId = session.user.id;
    try {
      const [{ data: prof }, { data: ents }] = await withTimeout(
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
        ]),
        TIMEOUT_MS,
      );
      setProfile(prof);
      setEntries(ents || []);
    } catch (err) {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

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
            onPress={() => {
              /* We'll handle this next */
            }}
            style={styles.phoneBtn}
          >
            <Text style={styles.phoneIcon}>📞</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={handleSignOut} style={styles.signOutBtn}>
            <Text style={styles.signOutText}>SIGN OUT</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.heroCard}>
        <Text style={styles.heroLabel}>THIS WEEK'S EARNINGS</Text>
        <Text style={styles.heroValue}>${weekPay.toFixed(2)}</Text>
        <View style={styles.heroRow}>
          <Text style={styles.heroStat}>{weekEntries.length} trips</Text>
          <Text style={styles.heroDot}>·</Text>
          <Text style={styles.heroStat}>{weekHours}h worked</Text>
          <Text style={styles.heroDot}>·</Text>
          <Text style={styles.heroStat}>{weekMiles.toFixed(0)} mi</Text>
        </View>
      </View>

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
        <View key={entry.id} style={styles.tripRow}>
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
        </View>
      ))}
    </ScrollView>
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
  heroCard: {
    ...components.cardAccent(colors.primary),
    padding: spacing.xxl,
    marginBottom: spacing.xxxl,
  },
  heroLabel: {
    ...typography.labelSm,
    fontSize: 10,
    color: colors.textSecondary,
    letterSpacing: 2.5,
    marginBottom: spacing.sm,
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
