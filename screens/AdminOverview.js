import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  RefreshControl, ActivityIndicator, TouchableOpacity, Modal,
} from 'react-native';
import { supabase } from '../lib/supabase';

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

          <Text style={s.modalName}>{driver.name}</Text>
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
                  item.label === 'TRIP BONUS' && monthTrips >= 20 && { color: '#4caf50' }
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

  if (loading) return <View style={s.center}><ActivityIndicator color="#f5a623" /></View>;

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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#f5a623" />}>

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
                <Text style={s.driverName}>{driver.name}</Text>
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
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 20, paddingTop: 20, paddingBottom: 40 },
  center: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center' },
  period: { fontSize: 11, color: '#555', letterSpacing: 1, marginBottom: 20 },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 28 },
  statCard: { flex: 1, backgroundColor: '#111', borderWidth: 1, borderColor: '#1e1e1e', padding: 12 },
  statLabel: { fontSize: 9, color: '#555', letterSpacing: 2, fontWeight: '700', marginBottom: 4 },
  statValue: { fontSize: 18, fontWeight: '900', color: '#f5a623' },
  sectionTitle: { fontSize: 10, color: '#444', letterSpacing: 2, fontWeight: '700', marginBottom: 10 },
  card: {
    backgroundColor: '#111', borderWidth: 1, borderColor: '#1e1e1e',
    borderLeftWidth: 3, borderLeftColor: '#3b8cf7',
    padding: 16, marginBottom: 10,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  cardLeft: { flex: 1 },
  cardRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  driverName: { fontSize: 16, fontWeight: '800', color: '#fff' },
  driverMeta: { fontSize: 11, color: '#555', marginTop: 3 },
  driverPay: { fontSize: 22, fontWeight: '900', color: '#f5a623' },
  chevron: { fontSize: 22, color: '#333', fontWeight: '300' },
  empty: { color: '#444', textAlign: 'center', marginTop: 32 },
  errorText: { color: '#555', fontSize: 14, marginBottom: 16 },
  retryBtn: { borderWidth: 1, borderColor: '#f5a623', paddingHorizontal: 24, paddingVertical: 10 },
  retryText: { color: '#f5a623', fontSize: 12, letterSpacing: 2, fontWeight: '700' },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: '#111', borderTopWidth: 1, borderTopColor: '#222',
    paddingHorizontal: 24, paddingTop: 16, paddingBottom: 48,
    maxHeight: '90%',
  },
  modalHandle: { width: 36, height: 4, backgroundColor: '#333', borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  modalName: { fontSize: 24, fontWeight: '900', color: '#fff', marginBottom: 4 },
  modalPeriod: { fontSize: 11, color: '#555', letterSpacing: 1, marginBottom: 20 },
  modalSection: { fontSize: 10, color: '#444', letterSpacing: 2, fontWeight: '700', marginBottom: 10, marginTop: 4 },
  modalStatsRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  modalStat: { flex: 1, backgroundColor: '#0a0a0a', borderWidth: 1, borderColor: '#1e1e1e', padding: 10 },
  modalStatLabel: { fontSize: 9, color: '#555', letterSpacing: 1.5, fontWeight: '700', marginBottom: 3 },
  modalStatValue: { fontSize: 16, fontWeight: '900', color: '#f5a623' },
  tripRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  tripLeft: {},
  tripRight: { alignItems: 'flex-end' },
  tripCity: { fontSize: 14, fontWeight: '700', color: '#fff' },
  tripDate: { fontSize: 11, color: '#555', marginTop: 2 },
  tripPay: { fontSize: 14, fontWeight: '800', color: '#f5a623' },
  tripMiles: { fontSize: 11, color: '#555', marginTop: 2 },
  closeBtn: {
    marginTop: 24, borderWidth: 1, borderColor: '#2a2a2a',
    paddingVertical: 14, alignItems: 'center',
  },
  closeBtnText: { color: '#555', fontSize: 11, letterSpacing: 2, fontWeight: '700' },
});