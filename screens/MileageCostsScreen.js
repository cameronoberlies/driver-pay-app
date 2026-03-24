import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  RefreshControl, ActivityIndicator, TouchableOpacity,
} from 'react-native';
import { LineChart, BarChart, PieChart } from 'react-native-chart-kit';
import { supabase } from '../lib/supabase';
import useResponsive from '../lib/useResponsive';

function getWeekBounds(weeksAgo = 0) {
  const d = new Date();
  d.setDate(d.getDate() - (weeksAgo * 7));
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

// Chart color scheme
const chartConfig = {
  backgroundColor: '#0a0a0a',
  backgroundGradientFrom: '#111',
  backgroundGradientTo: '#111',
  decimalPlaces: 0,
  color: (opacity = 1) => `rgba(245, 166, 35, ${opacity})`,
  labelColor: (opacity = 1) => `rgba(85, 85, 85, ${opacity})`,
  style: { borderRadius: 0 },
  propsForBackgroundLines: { strokeDasharray: '', stroke: '#1e1e1e', strokeWidth: 1 },
  propsForLabels: { fontSize: 10, fontWeight: '700' },
};

export default function MileageCostsScreen() {
  const { width } = useResponsive();
  const chartWidth = Math.min(width - 40, 660);
  const [entries, setEntries] = useState([]);
  const [trips, setTrips] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [activeChart, setActiveChart] = useState(0); // 0=variance, 1=miles, 2=efficiency, 3=trip types

  async function load() {
    setError(false);
    try {
      const [{ data: e }, { data: t }, { data: p }] = await withTimeout(
        Promise.all([
          supabase.from('entries').select('*').order('date', { ascending: false }),
          supabase.from('trips').select('*'),
          supabase.from('profiles').select('*'),
        ]),
        TIMEOUT_MS
      );
      setEntries(e ?? []);
      setTrips(t ?? []);
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

  // ── Chart 1: Cost Variance Trend (8 weeks) ──────────────────────────────
  const varianceTrendData = (() => {
    const weeks = [];
    for (let i = 7; i >= 0; i--) {
      const { start, end } = getWeekBounds(i);
      const wkEntries = entries.filter(e => {
        const d = new Date(e.date + 'T12:00:00');
        return d >= start && d <= end;
      });
      const actual = wkEntries.reduce((t, e) => t + Number(e.actual_cost ?? 0), 0);
      const estimated = wkEntries.reduce((t, e) => t + Number(e.estimated_cost ?? 0), 0);
      weeks.push({
        label: start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        actual,
        estimated,
      });
    }
    return {
      labels: weeks.map(w => w.label),
      datasets: [
        {
          data: weeks.map(w => w.actual),
          color: (opacity = 1) => `rgba(232, 90, 74, ${opacity})`, // red
          strokeWidth: 2,
        },
        {
          data: weeks.map(w => w.estimated),
          color: (opacity = 1) => `rgba(245, 166, 35, ${opacity})`, // gold
          strokeWidth: 2,
        },
      ],
      legend: ['Actual', 'Estimated'],
    };
  })();

  // ── Chart 2: Miles per Driver (this week) ───────────────────────────────
  const milesPerDriverData = (() => {
    const driverMiles = drivers.map(d => {
      const de = weekEntries.filter(e => e.driver_id === d.id);
      return {
        name: d.name.split(' ')[0], // First name only
        miles: de.reduce((t, e) => t + Number(e.miles ?? 0), 0),
      };
    }).filter(d => d.miles > 0).sort((a, b) => b.miles - a.miles);

    if (driverMiles.length === 0) {
      return { labels: ['No data'], datasets: [{ data: [0] }] };
    }

    return {
      labels: driverMiles.map(d => d.name),
      datasets: [{ data: driverMiles.map(d => d.miles) }],
    };
  })();

  // ── Chart 3: Cost per Mile Efficiency ───────────────────────────────────
  const efficiencyData = drivers.map(d => {
    const de = weekEntries.filter(e => e.driver_id === d.id);
    const miles = de.reduce((t, e) => t + Number(e.miles ?? 0), 0);
    const actual = de.reduce((t, e) => t + Number(e.actual_cost ?? 0), 0);
    const costPerMile = miles > 0 ? actual / miles : 0;
    return { name: d.name, miles, actual, costPerMile };
  }).filter(d => d.miles > 0).sort((a, b) => a.costPerMile - b.costPerMile);

  // ── Chart 4: Trip Type Breakdown (pie) ──────────────────────────────────
  const tripTypeData = (() => {
    const weekTrips = trips.filter(t => {
      if (!t.actual_start) return false;
      const d = new Date(t.actual_start);
      return d >= wkStart && d <= wkEnd;
    });
    const flyCount = weekTrips.filter(t => t.trip_type === 'fly').length;
    const driveCount = weekTrips.filter(t => t.trip_type === 'drive').length;

    if (flyCount === 0 && driveCount === 0) {
      return [{ name: 'No trips', population: 1, color: '#1e1e1e', legendFontColor: '#555' }];
    }

    return [
      { name: `Fly (${flyCount})`, population: flyCount, color: '#3b8cf7', legendFontColor: '#3b8cf7', legendFontSize: 12 },
      { name: `Drive (${driveCount})`, population: driveCount, color: '#f5a623', legendFontColor: '#f5a623', legendFontSize: 12 },
    ].filter(d => d.population > 0);
  })();

  // ── Render ───────────────────────────────────────────────────────────────
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
    <ScrollView style={s.container} contentContainerStyle={[s.content, { maxWidth: 700, alignSelf: 'center', width: '100%' }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#f5a623" />}>

      {/* Header */}
      <Text style={s.period}>
        {wkStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} –{' '}
        {wkEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
      </Text>

      {/* Summary Stats */}
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

      {/* Chart Tabs */}
      <View style={s.chartTabs}>
        <TouchableOpacity
          style={[s.chartTab, activeChart === 0 && s.chartTabActive]}
          onPress={() => setActiveChart(0)}
        >
          <Text style={[s.chartTabText, activeChart === 0 && s.chartTabTextActive]}>TREND</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.chartTab, activeChart === 1 && s.chartTabActive]}
          onPress={() => setActiveChart(1)}
        >
          <Text style={[s.chartTabText, activeChart === 1 && s.chartTabTextActive]}>MILES</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.chartTab, activeChart === 2 && s.chartTabActive]}
          onPress={() => setActiveChart(2)}
        >
          <Text style={[s.chartTabText, activeChart === 2 && s.chartTabTextActive]}>EFFICIENCY</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.chartTab, activeChart === 3 && s.chartTabActive]}
          onPress={() => setActiveChart(3)}
        >
          <Text style={[s.chartTabText, activeChart === 3 && s.chartTabTextActive]}>TYPES</Text>
        </TouchableOpacity>
      </View>

      {/* Chart Container */}
      <View style={s.chartContainer}>
        {activeChart === 0 && (
          <View>
            <Text style={s.chartTitle}>Cost Variance Trend (8 Weeks)</Text>
            <LineChart
              data={varianceTrendData}
              width={chartWidth}
              height={220}
              chartConfig={chartConfig}
              bezier
              style={s.chart}
              withInnerLines
              withOuterLines
              withVerticalLines={false}
              withHorizontalLines
              fromZero
            />
          </View>
        )}

        {activeChart === 1 && (
          <View>
            <Text style={s.chartTitle}>Miles per Driver (This Week)</Text>
            <BarChart
              data={milesPerDriverData}
              width={chartWidth}
              height={220}
              chartConfig={chartConfig}
              style={s.chart}
              showValuesOnTopOfBars
              fromZero
              withInnerLines={false}
            />
          </View>
        )}

        {activeChart === 2 && (
          <View>
            <Text style={s.chartTitle}>Cost per Mile Efficiency</Text>
            <View style={s.efficiencyCards}>
              {efficiencyData.length === 0 ? (
                <Text style={s.emptyText}>No data this week</Text>
              ) : (
                efficiencyData.map((d, i) => {
                  const avgCostPerMile = efficiencyData.reduce((t, e) => t + e.costPerMile, 0) / efficiencyData.length;
                  const isEfficient = d.costPerMile <= avgCostPerMile;
                  return (
                    <View key={d.name} style={[s.effCard, { borderLeftColor: isEfficient ? '#4ae885' : '#e85a4a' }]}>
                      <View style={s.effHeader}>
                        <Text style={s.effName}>{d.name}</Text>
                        <Text style={[s.effCost, { color: isEfficient ? '#4ae885' : '#e85a4a' }]}>
                          {fmtMoney(d.costPerMile)}/mi
                        </Text>
                      </View>
                      <View style={s.effStats}>
                        <Text style={s.effStat}>{d.miles.toFixed(1)} mi</Text>
                        <Text style={s.effStat}>{fmtMoney(d.actual)} total</Text>
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          </View>
        )}

        {activeChart === 3 && (
          <View>
            <Text style={s.chartTitle}>Trip Type Breakdown (This Week)</Text>
            <PieChart
              data={tripTypeData}
              width={chartWidth}
              height={220}
              chartConfig={chartConfig}
              accessor="population"
              backgroundColor="transparent"
              paddingLeft="15"
              absolute
              style={s.chart}
            />
          </View>
        )}
      </View>

      {/* Driver Breakdown (kept from original) */}
      <Text style={s.sectionTitle}>BY DRIVER THIS WEEK</Text>
      {drivers.map(driver => {
        const de = weekEntries.filter(e => e.driver_id === driver.id);
        const actual = de.reduce((t, e) => t + Number(e.actual_cost ?? 0), 0);
        const estimated = de.reduce((t, e) => t + Number(e.estimated_cost ?? 0), 0);
        const miles = de.reduce((t, e) => t + Number(e.miles ?? 0), 0);
        const v = actual - estimated;

        return (
          <View key={driver.id} style={s.card}>
            <Text style={s.cardName}>
              {driver.name}
              {driver.willing_to_fly && <Text style={s.flyBadge}> (F)</Text>}
            </Text>
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
  
  // Chart tabs
  chartTabs: { flexDirection: 'row', gap: 8, marginTop: 24, marginBottom: 16 },
  chartTab: { flex: 1, paddingVertical: 10, backgroundColor: '#111', borderWidth: 1, borderColor: '#1e1e1e', alignItems: 'center' },
  chartTabActive: { backgroundColor: 'rgba(245, 166, 35, 0.15)', borderColor: '#f5a623' },
  chartTabText: { fontSize: 9, fontWeight: '700', letterSpacing: 1.5, color: '#555' },
  chartTabTextActive: { color: '#f5a623' },
  
  // Chart container
  chartContainer: { backgroundColor: '#111', borderWidth: 1, borderColor: '#1e1e1e', padding: 16, marginBottom: 24 },
  chartTitle: { fontSize: 10, color: '#f5a623', letterSpacing: 2, fontWeight: '700', marginBottom: 16, textAlign: 'center' },
  chart: { marginVertical: 8, borderRadius: 0 },
  
  // Efficiency cards
  efficiencyCards: { gap: 12 },
  effCard: { backgroundColor: '#0a0a0a', borderWidth: 1, borderColor: '#1e1e1e', borderLeftWidth: 3, padding: 14 },
  effHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  effName: { fontSize: 14, fontWeight: '800', color: '#fff' },
  effCost: { fontSize: 16, fontWeight: '900' },
  effStats: { flexDirection: 'row', gap: 16 },
  effStat: { fontSize: 11, color: '#666' },
  emptyText: { fontSize: 12, color: '#555', textAlign: 'center', paddingVertical: 40 },
  
  // Driver breakdown (original)
  sectionTitle: { fontSize: 10, color: '#444', letterSpacing: 2, fontWeight: '700', marginTop: 20, marginBottom: 12 },
  card: { backgroundColor: '#111', borderWidth: 1, borderColor: '#1e1e1e', borderLeftWidth: 3, borderLeftColor: '#3b8cf7', padding: 16, marginBottom: 10 },
  cardName: { fontSize: 14, fontWeight: '800', color: '#fff', marginBottom: 12 },
  flyBadge: { fontSize: 12, fontWeight: '700', color: '#f5a623' },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between' },
  cardStat: {},
  cardStatLabel: { fontSize: 9, color: '#555', letterSpacing: 1.5, fontWeight: '700', marginBottom: 2 },
  cardStatValue: { fontSize: 14, fontWeight: '800', color: '#ccc' },
  
  // Error
  errorText: { color: '#555', fontSize: 14, marginBottom: 16 },
  retryBtn: { borderWidth: 1, borderColor: '#f5a623', paddingHorizontal: 24, paddingVertical: 10 },
  retryText: { color: '#f5a623', fontSize: 12, letterSpacing: 2, fontWeight: '700' },
});