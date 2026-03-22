import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  RefreshControl, ActivityIndicator, TouchableOpacity, Modal,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { colors, spacing, radius, typography, components } from '../lib/theme';

function getWeekBounds() {
  const d = new Date();
  const day = d.getDay();
  const diffToWed = day >= 3 ? day - 3 : day + 4;
  const wed = new Date(d);
  wed.setDate(d.getDate() - diffToWed);
  wed.setHours(0, 0, 0, 0);
  const tue = new Date(wed);
  tue.setDate(wed.getDate() + 6);
  tue.setHours(23, 59, 59, 999);
  return { start: wed, end: tue };
}

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2 });
}

const TIMEOUT_MS = 8000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

function DriverModal({ driver, entries, visible, onClose }) {
  if (!driver) return null;

  const { start: wkStart, end: wkEnd } = getWeekBounds();
  const thisMonth = new Date().toISOString().slice(0, 7);

  const driverEntries = entries.filter(e => e.driver_id === driver.id);
  const wk = driverEntries.filter(e => {
    const d = new Date(e.date + 'T12:00:00');
    return d >= wkStart && d <= wkEnd;
  });

  const weekPay = wk.reduce((t, e) => t + Number(e.pay || 0), 0);
  const weekMiles = wk.reduce((t, e) => t + Number(e.miles ?? 0), 0);
  const weekHours = wk.reduce((t, e) => t + Number(e.hours ?? 0), 0);
  const weekDriveTime = wk.reduce((t, e) => t + Number(e.drive_time ?? 0), 0);

  const monthEntries = driverEntries.filter(e => e.date.slice(0, 7) === thisMonth);
  const monthTrips = monthEntries.length;
  const monthPay = monthEntries.reduce((t, e) => t + Number(e.pay || 0), 0);

  // Recon streak
  const sorted = [...driverEntries].sort((a, b) => new Date(b.date) - new Date(a.date));
  let streak = 0;
  for (const e of sorted) {
    if (e.recon_missed) break;
    streak++;
  }

  const recentTrips = [...driverEntries]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 5);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={s.modalSheet}>
          <View style={s.modalHandle} />

          <Text style={s.modalName}>
            {driver.name}
            {driver.willing_to_fly && <Text style={s.flyBadge}> (F)</Text>}
          </Text>
          <Text style={s.modalPeriod}>
            {wkStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} –{' '}
            {wkEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </Text>

          {/* Week stats */}
          <Text style={s.modalSection}>THIS WEEK</Text>
          <View style={s.modalStatsRow}>
            {[
              { label: 'PAY', value: fmt(weekPay) },
              { label: 'TRIPS', value: wk.length },
              { label: 'MILES', value: weekMiles.toFixed(1) },
            ].map((item, i) => (
              <View key={i} style={s.modalStat}>
                <Text style={s.modalStatLabel}>{item.label}</Text>
                <Text style={s.modalStatValue}>{item.value}</Text>
              </View>
            ))}
          </View>
          <View style={s.modalStatsRow}>
            {[
              { label: 'HOURS', value: weekHours.toFixed(1) + 'h' },
              { label: 'DRIVE TIME', value: weekDriveTime.toFixed(1) + 'h' },
              { label: 'RECON STREAK', value: streak },
            ].map((item, i) => (
              <View key={i} style={s.modalStat}>
                <Text style={s.modalStatLabel}>{item.label}</Text>
                <Text style={s.modalStatValue}>{item.value}</Text>
              </View>
            ))}
          </View>

          {/* Month stats */}
          <Text style={s.modalSection}>THIS MONTH</Text>
          <View style={s.modalStatsRow}>
            {[
              { label: 'PAY', value: fmt(monthPay) },
              { label: 'TRIPS', value: monthTrips },
              { label: 'TRIP BONUS', value: monthTrips >= 20 ? '✓ $50' : `${monthTrips}/20` },
            ].map((item, i) => (
              <View key={i} style={s.modalStat}>
                <Text style={s.modalStatLabel}>{item.label}</Text>
                <Text style={[
                  s.modalStatValue,
                  item.label === 'TRIP BONUS' && monthTrips >= 20 && { color: colors.success }
                ]}>{item.value}</Text>
              </View>
            ))}
          </View>

          {/* Recent trips */}
          <Text style={s.modalSection}>RECENT TRIPS</Text>
          {recentTrips.length === 0 && <Text style={s.empty}>No trips yet.</Text>}
          {recentTrips.map((e, i) => (
            <View key={i} style={s.tripRow}>
              <View style={s.tripLeft}>
                <Text style={s.tripCity}>{e.city || '—'}</Text>
                <Text style={s.tripDate}>{e.date}</Text>
              </View>
              <View style={s.tripRight}>
                <Text style={s.tripPay}>{fmt(e.pay)}</Text>
                <Text style={s.tripMiles}>{Number(e.miles ?? 0).toFixed(1)} mi</Text>
              </View>
            </View>
          ))}

          <TouchableOpacity style={s.closeBtn} onPress={onClose}>
            <Text style={s.closeBtnText}>CLOSE</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

export default function AdminOverview() {
  const [drivers, setDrivers] = useState([]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState(null);

  const { start: wkStart, end: wkEnd } = getWeekBounds();
  const thisMonth = new Date().toISOString().slice(0, 7);

  async function load() {
    setError(false);
    try {
      const [{ data: p }, { data: e }] = await withTimeout(
        Promise.all([
          supabase.from('profiles').select('*').eq('role', 'driver'),
          supabase.from('entries').select('*'),
        ]),
        TIMEOUT_MS
      );
      setDrivers(p ?? []);
      setEntries(e ?? []);
    } catch (err) {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { load(); }, []);
  function onRefresh() { setRefreshing(true); load(); }

  if (loading) return <View style={s.center}><ActivityIndicator color={colors.primary} /></View>;

  if (error) return (
    <View style={s.center}>
      <Text style={s.errorText}>Failed to load data</Text>
      <TouchableOpacity style={s.retryBtn} onPress={() => { setLoading(true); load(); }}>
        <Text style={s.retryText}>RETRY</Text>
      </TouchableOpacity>
    </View>
  );

  const weekEntries = entries.filter(e => {
    const d = new Date(e.date + 'T12:00:00');
    return d >= wkStart && d <= wkEnd;
  });

  return (
    <>
      <ScrollView style={s.container} contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}>

        <Text style={s.period}>
          {wkStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} –{' '}
          {wkEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </Text>

        <View style={s.statsRow}>
          {[
            { label: 'DRIVERS', value: drivers.length },
            { label: 'TRIPS', value: weekEntries.length },
            { label: 'WEEK PAY', value: fmt(weekEntries.reduce((t, e) => t + Number(e.pay), 0)) },
          ].map((item, i) => (
            <View key={i} style={s.statCard}>
              <Text style={s.statLabel}>{item.label}</Text>
              <Text style={s.statValue}>{item.value}</Text>
            </View>
          ))}
        </View>

        <Text style={s.sectionTitle}>THIS WEEK</Text>

        {drivers.map(driver => {
          const driverEntries = entries.filter(e => e.driver_id === driver.id);
          const wk = driverEntries.filter(e => {
            const d = new Date(e.date + 'T12:00:00');
            return d >= wkStart && d <= wkEnd;
          });
          const weekPay = wk.reduce((t, e) => t + Number(e.pay), 0);
          const weekMiles = wk.reduce((t, e) => t + Number(e.miles ?? 0), 0);
          const monthTrips = driverEntries.filter(e => e.date.slice(0, 7) === thisMonth).length;

          return (
            <TouchableOpacity key={driver.id} style={s.card} onPress={() => setSelectedDriver(driver)}>
              <View style={s.cardLeft}>
                <Text style={s.driverName}>
                  {driver.name}
                  {driver.willing_to_fly && <Text style={s.flyBadge}> (F)</Text>}
                </Text>
                <Text style={s.driverMeta}>
                  {wk.length} trips · {weekMiles.toFixed(1)} mi · {monthTrips} this month
                </Text>
              </View>
              <View style={s.cardRight}>
                <Text style={s.driverPay}>{fmt(weekPay)}</Text>
                <Text style={s.chevron}>›</Text>
              </View>
            </TouchableOpacity>
          );
        })}

        {drivers.length === 0 && <Text style={s.empty}>No drivers found.</Text>}
      </ScrollView>

      <DriverModal
        driver={selectedDriver}
        entries={entries}
        visible={!!selectedDriver}
        onClose={() => setSelectedDriver(null)}
      />
    </>
  );
}

const s = StyleSheet.create({
  container: { ...components.screen },
  content: { padding: spacing.xl, paddingBottom: spacing.xxxxl },
  center: { ...components.center },
  period: { ...typography.captionSm, color: colors.textTertiary, letterSpacing: 1, marginBottom: spacing.xl },
  statsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xxxl },
  statCard: {
    flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, padding: spacing.md,
  },
  statLabel: { ...typography.labelSm, color: colors.textTertiary, letterSpacing: 2, marginBottom: spacing.xs },
  statValue: { ...typography.h2, color: colors.primary },
  sectionTitle: { ...components.sectionTitle },
  card: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderLeftWidth: 3, borderLeftColor: colors.info,
    borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.md,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  cardLeft: { flex: 1 },
  cardRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  driverName: { ...typography.h3, color: colors.textPrimary },
  flyBadge: { ...typography.caption, color: colors.primary },
  driverMeta: { ...typography.captionSm, color: colors.textTertiary, marginTop: spacing.xs },
  driverPay: { ...typography.displaySm, fontSize: 22, color: colors.primary },
  chevron: { fontSize: 22, color: colors.textMuted, fontWeight: '300' },
  empty: { ...typography.body, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xxxl },
  errorText: { ...components.errorText },
  retryBtn: { ...components.retryBtn, borderRadius: radius.sm },
  retryText: { ...components.retryText },

  // Modal
  modalOverlay: { ...components.modalOverlay },
  modalSheet: { ...components.modalSheet, maxHeight: '90%' },
  modalHandle: { ...components.modalHandle },
  modalName: { ...typography.displaySm, color: colors.textPrimary, marginBottom: spacing.xs },
  modalPeriod: { ...typography.captionSm, color: colors.textTertiary, letterSpacing: 1, marginBottom: spacing.xl },
  modalSection: { ...typography.labelSm, color: colors.textMuted, letterSpacing: 2, marginBottom: spacing.md, marginTop: spacing.xs },
  modalStatsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  modalStat: {
    flex: 1, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, padding: spacing.md,
  },
  modalStatLabel: { ...typography.labelSm, color: colors.textTertiary, letterSpacing: 1.5, marginBottom: spacing.xs },
  modalStatValue: { ...typography.h3, color: colors.primary },
  tripRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  tripLeft: {},
  tripRight: { alignItems: 'flex-end' },
  tripCity: { ...typography.body, fontWeight: '700', color: colors.textPrimary },
  tripDate: { ...typography.captionSm, color: colors.textTertiary, marginTop: 2 },
  tripPay: { ...typography.body, fontWeight: '800', color: colors.primary },
  tripMiles: { ...typography.captionSm, color: colors.textTertiary, marginTop: 2 },
  closeBtn: {
    marginTop: spacing.xxl, borderWidth: 1, borderColor: colors.borderLight,
    borderRadius: radius.sm, paddingVertical: spacing.lg, alignItems: 'center',
  },
  closeBtnText: { ...typography.label, color: colors.textTertiary },
});