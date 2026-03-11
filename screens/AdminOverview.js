import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, RefreshControl, ActivityIndicator,
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

function formatCurrency(n) {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2 });
}

export default function AdminOverview({ session }) {
  const [drivers, setDrivers] = useState([]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const { start: wkStart, end: wkEnd } = getWeekBounds();
  const thisMonth = new Date().toISOString().slice(0, 7);

  async function loadData() {
    const [{ data: profiles }, { data: entryData }] = await Promise.all([
      supabase.from('profiles').select('*').eq('role', 'driver'),
      supabase.from('entries').select('*'),
    ]);
    setDrivers(profiles ?? []);
    setEntries(entryData ?? []);
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => { loadData(); }, []);

  function onRefresh() { setRefreshing(true); loadData(); }

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#f5a623" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#f5a623" />}
    >
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>ADMIN</Text>
          <Text style={styles.sub}>
            {wkStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} –{' '}
            {wkEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </Text>
        </View>
        <TouchableOpacity onPress={handleSignOut} style={styles.signOutBtn}>
          <Text style={styles.signOutText}>SIGN OUT</Text>
        </TouchableOpacity>
      </View>

      {/* Summary stats */}
      <View style={styles.statsRow}>
        {[
          { label: 'DRIVERS', value: drivers.length },
          {
            label: 'WEEK TRIPS',
            value: entries.filter(e => {
              const d = new Date(e.date + 'T12:00:00');
              return d >= wkStart && d <= wkEnd;
            }).length,
          },
          {
            label: 'WEEK PAY',
            value: formatCurrency(
              entries
                .filter(e => { const d = new Date(e.date + 'T12:00:00'); return d >= wkStart && d <= wkEnd; })
                .reduce((s, e) => s + Number(e.pay), 0)
            ),
          },
        ].map((s, i) => (
          <View key={i} style={styles.statCard}>
            <Text style={styles.statLabel}>{s.label}</Text>
            <Text style={styles.statValue}>{s.value}</Text>
          </View>
        ))}
      </View>

      {/* Driver cards */}
      <Text style={styles.sectionTitle}>THIS WEEK</Text>
      {drivers.map(driver => {
        const driverEntries = entries.filter(e => e.driver_id === driver.id);
        const weekEntries = driverEntries.filter(e => {
          const d = new Date(e.date + 'T12:00:00');
          return d >= wkStart && d <= wkEnd;
        });
        const weekPay = weekEntries.reduce((s, e) => s + Number(e.pay), 0);
        const weekMiles = weekEntries.reduce((s, e) => s + Number(e.miles ?? 0), 0);
        const monthTrips = driverEntries.filter(e => e.date.slice(0, 7) === thisMonth).length;

        return (
          <View key={driver.id} style={styles.driverCard}>
            <View style={styles.driverCardLeft}>
              <Text style={styles.driverName}>{driver.name}</Text>
              <Text style={styles.driverMeta}>
                {weekEntries.length} trips · {weekMiles.toFixed(1)} mi · {monthTrips} this month
              </Text>
            </View>
            <Text style={styles.driverPay}>{formatCurrency(weekPay)}</Text>
          </View>
        );
      })}

      {drivers.length === 0 && (
        <Text style={styles.empty}>No drivers in the system yet.</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, paddingTop: 50 },
  title: { fontSize: 28, fontWeight: '900', color: '#fff', letterSpacing: 2 },
  sub: { fontSize: 11, color: '#555', letterSpacing: 1, marginTop: 2 },
  signOutBtn: { borderWidth: 1, borderColor: '#2a2a2a', paddingHorizontal: 12, paddingVertical: 6 },
  signOutText: { fontSize: 10, color: '#555', letterSpacing: 1.5, fontWeight: '700' },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 28 },
  statCard: { flex: 1, backgroundColor: '#111', borderWidth: 1, borderColor: '#1e1e1e', padding: 14 },
  statLabel: { fontSize: 9, color: '#555', letterSpacing: 2, fontWeight: '700', marginBottom: 4 },
  statValue: { fontSize: 20, fontWeight: '900', color: '#f5a623' },
  sectionTitle: { fontSize: 10, color: '#444', letterSpacing: 2, fontWeight: '700', marginBottom: 12 },
  driverCard: {
    backgroundColor: '#111', borderWidth: 1, borderColor: '#1e1e1e',
    borderLeftWidth: 3, borderLeftColor: '#3b8cf7',
    padding: 16, marginBottom: 10,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  driverCardLeft: { flex: 1 },
  driverName: { fontSize: 16, fontWeight: '800', color: '#fff', letterSpacing: 0.5 },
  driverMeta: { fontSize: 11, color: '#555', marginTop: 3 },
  driverPay: { fontSize: 22, fontWeight: '900', color: '#f5a623' },
  empty: { color: '#444', fontSize: 13, textAlign: 'center', marginTop: 32 },
});