import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  RefreshControl, ActivityIndicator,
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

export default function AdminOverview() {
  const [drivers, setDrivers] = useState([]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const { start: wkStart, end: wkEnd } = getWeekBounds();
  const thisMonth = new Date().toISOString().slice(0, 7);

  async function load() {
    const [{ data: p }, { data: e }] = await Promise.all([
      supabase.from('profiles').select('*').eq('role', 'driver'),
      supabase.from('entries').select('*'),
    ]);
    setDrivers(p ?? []);
    setEntries(e ?? []);
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => { load(); }, []);
  function onRefresh() { setRefreshing(true); load(); }

  if (loading) return <View style={s.center}><ActivityIndicator color="#f5a623" /></View>;

  const weekEntries = entries.filter(e => {
    const d = new Date(e.date + 'T12:00:00');
    return d >= wkStart && d <= wkEnd;
  });

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#f5a623" />}>

      <Text style={s.period}>
        {wkStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} –{' '}
        {wkEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
      </Text>

      {/* Summary row */}
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
          <View key={driver.id} style={s.card}>
            <View style={s.cardLeft}>
              <Text style={s.driverName}>{driver.name}</Text>
              <Text style={s.driverMeta}>
                {wk.length} trips · {weekMiles.toFixed(1)} mi · {monthTrips} this month
              </Text>
            </View>
            <Text style={s.driverPay}>{fmt(weekPay)}</Text>
          </View>
        );
      })}

      {drivers.length === 0 && <Text style={s.empty}>No drivers found.</Text>}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 20, paddingBottom: 40 },
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
  driverName: { fontSize: 16, fontWeight: '800', color: '#fff' },
  driverMeta: { fontSize: 11, color: '#555', marginTop: 3 },
  driverPay: { fontSize: 22, fontWeight: '900', color: '#f5a623' },
  empty: { color: '#444', textAlign: 'center', marginTop: 32 },
});