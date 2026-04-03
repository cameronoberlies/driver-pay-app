import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  RefreshControl, ActivityIndicator, TouchableOpacity,
} from 'react-native';
import { LineChart, PieChart } from 'react-native-chart-kit';
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
  const chartWidth = Math.min(width - 72, 620);
  const [entries, setEntries] = useState([]);
  const [trips, setTrips] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [activeChart, setActiveChart] = useState(0); // 0=variance, 1=miles, 2=efficiency, 3=trip types, 4=speed
  const [speedDriver, setSpeedDriver] = useState('all');

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

  // ── Chart 2: Weekly Mileage Trend (8 weeks) ────────────────────────────
  const milesTrendData = (() => {
    const weeks = [];
    for (let i = 7; i >= 0; i--) {
      const { start, end } = getWeekBounds(i);
      const wkEntries = entries.filter(e => {
        const d = new Date(e.date + 'T12:00:00');
        return d >= start && d <= end;
      });
      const miles = wkEntries.reduce((t, e) => t + Number(e.miles ?? 0), 0);
      weeks.push({
        label: start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        miles,
      });
    }
    return {
      labels: weeks.map(w => w.label),
      datasets: [{
        data: weeks.map(w => w.miles),
        color: (opacity = 1) => `rgba(59, 140, 247, ${opacity})`,
        strokeWidth: 2,
      }],
    };
  })();

  // ── Chart 3: Cost per Mile Efficiency (total) ───────────────────────────
  const totalCostPerMile = totalMiles > 0 ? totalActual / totalMiles : 0;
  const efficiencyTrend = (() => {
    const weeks = [];
    for (let i = 7; i >= 0; i--) {
      const { start, end } = getWeekBounds(i);
      const wkEntries = entries.filter(e => {
        const d = new Date(e.date + 'T12:00:00');
        return d >= start && d <= end;
      });
      const miles = wkEntries.reduce((t, e) => t + Number(e.miles ?? 0), 0);
      const actual = wkEntries.reduce((t, e) => t + Number(e.actual_cost ?? 0), 0);
      weeks.push({
        label: start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        cpm: miles > 0 ? actual / miles : 0,
      });
    }
    return {
      labels: weeks.map(w => w.label),
      datasets: [{
        data: weeks.map(w => parseFloat(w.cpm.toFixed(2))),
        color: (opacity = 1) => `rgba(74, 232, 133, ${opacity})`,
        strokeWidth: 2,
      }],
    };
  })();

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

  // ── Chart 5: Speed by Driver Over Time ───────────────────────────────────
  const speedChartData = (() => {
    const tripsWithSpeed = trips
      .filter(t => t.speed_data && t.actual_start)
      .filter(t => speedDriver === 'all' || t.driver_id === speedDriver || t.designated_driver_id === speedDriver)
      .sort((a, b) => new Date(a.actual_start) - new Date(b.actual_start))
      .slice(-15); // Last 15 trips

    if (tripsWithSpeed.length === 0) {
      return null;
    }

    return {
      labels: tripsWithSpeed.map(t =>
        new Date(t.actual_start).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
      ),
      datasets: [
        {
          data: tripsWithSpeed.map(t => t.speed_data.top_speed || 0),
          color: (opacity = 1) => `rgba(232, 90, 74, ${opacity})`,
          strokeWidth: 2,
        },
        {
          data: tripsWithSpeed.map(t => t.speed_data.avg_speed || 0),
          color: (opacity = 1) => `rgba(245, 166, 35, ${opacity})`,
          strokeWidth: 2,
        },
        // Invisible datasets for threshold reference lines
        { data: tripsWithSpeed.map(() => 80), color: () => 'transparent', strokeWidth: 0, withDots: false },
      ],
      legend: ['Top Speed', 'Avg Speed'],
    };
  })();

  const speedDriverName = speedDriver === 'all' ? 'All Drivers' : (drivers.find(d => d.id === speedDriver)?.name || 'Unknown');

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
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chartTabs} contentContainerStyle={s.chartTabsContent}>
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
        <TouchableOpacity
          style={[s.chartTab, activeChart === 4 && s.chartTabActive]}
          onPress={() => setActiveChart(4)}
        >
          <Text style={[s.chartTabText, activeChart === 4 && s.chartTabTextActive]}>SPEED</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Chart Container */}
      <View style={s.chartContainer}>
        {activeChart === 0 && (
          <View>
            <Text style={s.chartTitle}>Cost Variance Trend (8 Weeks)</Text>
            <LineChart
              data={varianceTrendData}
              width={chartWidth}
              height={220}
              yAxisLabel="$"
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
            <Text style={s.chartTitle}>Weekly Mileage Trend (8 Weeks)</Text>
            <LineChart
              data={milesTrendData}
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

        {activeChart === 2 && (
          <View>
            <Text style={s.chartTitle}>Cost per Mile (8 Weeks)</Text>
            <View style={s.effSummary}>
              <Text style={s.effSummaryLabel}>THIS WEEK</Text>
              <Text style={s.effSummaryValue}>{fmtMoney(totalCostPerMile)}/mi</Text>
              <Text style={s.effSummaryDetail}>{totalMiles.toFixed(0)} mi · {fmtMoney(totalActual)} actual</Text>
            </View>
            <LineChart
              data={efficiencyTrend}
              width={chartWidth}
              height={220}
              yAxisLabel="$"
              chartConfig={{
                ...chartConfig,
                color: (opacity = 1) => `rgba(74, 232, 133, ${opacity})`,
              }}
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

        {activeChart === 4 && (
          <View>
            <Text style={s.chartTitle}>Speed Tracking — {speedDriverName}</Text>

            {/* Driver Selector */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.speedDriverScroll}>
              <TouchableOpacity
                style={[s.speedDriverPill, speedDriver === 'all' && s.speedDriverPillActive]}
                onPress={() => setSpeedDriver('all')}
              >
                <Text style={[s.speedDriverText, speedDriver === 'all' && s.speedDriverTextActive]}>All</Text>
              </TouchableOpacity>
              {drivers.map(d => (
                <TouchableOpacity
                  key={d.id}
                  style={[s.speedDriverPill, speedDriver === d.id && s.speedDriverPillActive]}
                  onPress={() => setSpeedDriver(d.id)}
                >
                  <Text style={[s.speedDriverText, speedDriver === d.id && s.speedDriverTextActive]}>
                    {d.name.split(' ')[0]}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {speedChartData ? (
              <>
                <LineChart
                  data={speedChartData}
                  width={chartWidth}
                  height={220}
                  yAxisSuffix=" mph"
                  chartConfig={{
                    ...chartConfig,
                    color: (opacity = 1) => `rgba(232, 90, 74, ${opacity})`,
                  }}
                  bezier
                  style={s.chart}
                  withInnerLines
                  withOuterLines
                  withVerticalLines={false}
                  withHorizontalLines
                  decorator={() => (
                    // 80 mph threshold line
                    <View />
                  )}
                />
                <View style={s.speedLegend}>
                  <View style={s.speedLegendItem}>
                    <View style={[s.speedLegendDot, { backgroundColor: '#e85a4a' }]} />
                    <Text style={s.speedLegendText}>Top Speed</Text>
                  </View>
                  <View style={s.speedLegendItem}>
                    <View style={[s.speedLegendDot, { backgroundColor: '#f5a623' }]} />
                    <Text style={s.speedLegendText}>Avg Speed</Text>
                  </View>
                  <Text style={[s.speedLegendText, { color: '#666' }]}>80 mph limit ┈</Text>
                </View>
              </>
            ) : (
              <Text style={s.emptyText}>No speed data available yet</Text>
            )}
          </View>
        )}
      </View>

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
  chartTabs: { marginTop: 24, marginBottom: 16 },
  chartTabsContent: { flexDirection: 'row', gap: 8 },
  chartTab: { paddingVertical: 10, paddingHorizontal: 16, backgroundColor: '#111', borderWidth: 1, borderColor: '#1e1e1e', alignItems: 'center' },
  chartTabActive: { backgroundColor: 'rgba(245, 166, 35, 0.15)', borderColor: '#f5a623' },
  chartTabText: { fontSize: 9, fontWeight: '700', letterSpacing: 1.5, color: '#555' },
  chartTabTextActive: { color: '#f5a623' },
  
  // Chart container
  chartContainer: { backgroundColor: '#111', borderWidth: 1, borderColor: '#1e1e1e', padding: 16, marginBottom: 24 },
  chartTitle: { fontSize: 10, color: '#f5a623', letterSpacing: 2, fontWeight: '700', marginBottom: 16, textAlign: 'center' },
  chart: { marginVertical: 8, borderRadius: 0 },
  
  // Efficiency summary
  effSummary: {
    alignItems: 'center',
    marginBottom: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1e1e1e',
  },
  effSummaryLabel: { fontSize: 9, color: '#555', letterSpacing: 2, fontWeight: '700', marginBottom: 4 },
  effSummaryValue: { fontSize: 28, fontWeight: '900', color: '#4ae885' },
  effSummaryDetail: { fontSize: 11, color: '#666', marginTop: 4 },
  emptyText: { fontSize: 12, color: '#555', textAlign: 'center', paddingVertical: 40 },

  // Speed chart
  speedDriverScroll: { marginBottom: 16 },
  speedDriverPill: {
    paddingHorizontal: 14, paddingVertical: 6, marginRight: 8,
    backgroundColor: '#0a0a0a', borderWidth: 1, borderColor: '#1e1e1e', borderRadius: 4,
  },
  speedDriverPillActive: {
    backgroundColor: 'rgba(245, 166, 35, 0.15)', borderColor: '#f5a623',
  },
  speedDriverText: { fontSize: 11, fontWeight: '700', color: '#555', letterSpacing: 0.5 },
  speedDriverTextActive: { color: '#f5a623' },
  speedLegend: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    gap: 16, marginTop: 8,
  },
  speedLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  speedLegendDot: { width: 8, height: 8, borderRadius: 4 },
  speedLegendText: { fontSize: 10, color: '#999', fontWeight: '600' },
  
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