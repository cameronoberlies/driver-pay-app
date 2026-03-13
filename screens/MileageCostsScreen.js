import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  RefreshControl, ActivityIndicator, TouchableOpacity,
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

function fmtMoney(n) { return '$' + Number(n||0).toLocaleString('en-US', { minimumFractionDigits: 2 }); }

const TIMEOUT_MS = 8000;
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

export default function MileageCostsScreen() {
  const [entries, setEntries] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);

  async function load() {
    setError(false);
    try {
      const [{ data: e }, { data: p }] = await withTimeout(
        Promise.all([
          supabase.from('entries').select('*').order('date', { ascending: false }),
          supabase.from('profiles').select('*'),
        ]),
        TIMEOUT_MS
      );
      setEntries(e ?? []);
      setProfiles(p ?? []);
    } catch (err) {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { load(); }, []);
  function onRefresh() { setRefreshing(true); load(); }

  const { start: wkStart, end: wkEnd } = getWeekBounds();
  const drivers = profiles.filter(p => p.role === 'driver');

  const weekEntries = entries.filter(e => {
    const d = new Date(e.date + 'T12:00:00');
    return d >= wkStart && d <= wkEnd;
  });

  const totalActual = weekEntries.reduce((t, e) => t + Number(e.actual_cost ?? 0), 0);
  const totalEstimated = weekEntries.reduce((t, e) => t + Number(e.estimated_cost ?? 0), 0);
  const totalMiles = weekEntries.reduce((t, e) => t + Number(e.miles ?? 0), 0);
  const variance = totalActual - totalEstimated;

  if (loading) return <View style={s.center}><ActivityIndicator color="#f5a623" /></View>;

  if (error) return (
    <View style={s.center}>
      <Text style={s.errorText}>Failed to load data</Text>
      <TouchableOpacity style={s.retryBtn} onPress={() => { setLoading(true); load(); }}>
        <Text style={s.retryText}>RETRY</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#f5a623" />}>

      <Text style={s.period}>
        {wkStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} –{' '}
        {wkEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
      </Text>

      <View style={s.row}>
        <View style={s.statCard}>
          <Text style={s.statLabel}>TOTAL MILES</Text>
          <Text style={s.statValue}>{totalMiles.toFixed(1)}</Text>
        </View>
        <View style={s.statCard}>
          <Text style={s.statLabel}>ACTUAL COST</Text>
          <Text style={s.statValue}>{fmtMoney(totalActual)}</Text>
        </View>
      </View>
      <View style={s.row}>
        <View style={s.statCard}>
          <Text style={s.statLabel}>ESTIMATED</Text>
          <Text style={s.statValue}>{fmtMoney(totalEstimated)}</Text>
        </View>
        <View style={[s.statCard, { borderColor: variance > 0 ? '#e85a4a' : '#4ae885' }]}>
          <Text style={s.statLabel}>VARIANCE</Text>
          <Text style={[s.statValue, { color: variance > 0 ? '#e85a4a' : '#4ae885' }]}>
            {variance >= 0 ? '+' : ''}{fmtMoney(variance)}
          </Text>
        </View>
      </View>

      <Text style={s.sectionTitle}>BY DRIVER THIS WEEK</Text>

      {drivers.map(driver => {
        const de = weekEntries.filter(e => e.driver_id === driver.id);
        const actual = de.reduce((t, e) => t + Number(e.actual_cost ?? 0), 0);
        const estimated = de.reduce((t, e) => t + Number(e.estimated_cost ?? 0), 0);
        const miles = de.reduce((t, e) => t + Number(e.miles ?? 0), 0);
        const v = actual - estimated;

        return (
          <View key={driver.id} style={s.card}>
            <Text style={s.cardName}>{driver.name}</Text>
            <View style={s.cardRow}>
              <View style={s.cardStat}>
                <Text style={s.cardStatLabel}>MILES</Text>
                <Text style={s.cardStatValue}>{miles.toFixed(1)}</Text>
              </View>
              <View style={s.cardStat}>
                <Text style={s.cardStatLabel}>ACTUAL</Text>
                <Text style={s.cardStatValue}>{fmtMoney(actual)}</Text>
              </View>
              <View style={s.cardStat}>
                <Text style={s.cardStatLabel}>EST</Text>
                <Text style={s.cardStatValue}>{fmtMoney(estimated)}</Text>
              </View>
              <View style={s.cardStat}>
                <Text style={s.cardStatLabel}>VAR</Text>
                <Text style={[s.cardStatValue, { color: v > 0 ? '#e85a4a' : '#4ae885' }]}>
                  {v >= 0 ? '+' : ''}{fmtMoney(v)}
                </Text>
              </View>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 20, paddingTop: 20, paddingBottom: 40 },
  center: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center' },
  period: { fontSize: 11, color: '#555', letterSpacing: 1, marginBottom: 20 },
  row: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  statCard: { flex: 1, backgroundColor: '#111', borderWidth: 1, borderColor: '#1e1e1e', padding: 14 },
  statLabel: { fontSize: 9, color: '#555', letterSpacing: 2, fontWeight: '700', marginBottom: 4 },
  statValue: { fontSize: 20, fontWeight: '900', color: '#f5a623' },
  sectionTitle: { fontSize: 10, color: '#444', letterSpacing: 2, fontWeight: '700', marginTop: 20, marginBottom: 12 },
  card: { backgroundColor: '#111', borderWidth: 1, borderColor: '#1e1e1e', borderLeftWidth: 3, borderLeftColor: '#3b8cf7', padding: 16, marginBottom: 10 },
  cardName: { fontSize: 14, fontWeight: '800', color: '#fff', marginBottom: 12 },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between' },
  cardStat: {},
  cardStatLabel: { fontSize: 9, color: '#555', letterSpacing: 1.5, fontWeight: '700', marginBottom: 2 },
  cardStatValue: { fontSize: 14, fontWeight: '800', color: '#ccc' },
  errorText: { color: '#555', fontSize: 14, marginBottom: 16 },
  retryBtn: { borderWidth: 1, borderColor: '#f5a623', paddingHorizontal: 24, paddingVertical: 10 },
  retryText: { color: '#f5a623', fontSize: 12, letterSpacing: 2, fontWeight: '700' },
});