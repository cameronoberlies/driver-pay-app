import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, RefreshControl, ActivityIndicator, Modal, ScrollView,
} from 'react-native';
import { supabase } from '../lib/supabase';

function fmtDate(d) { const [y,m,day] = d.split('-'); return `${m}/${day}/${y}`; }
function fmtMoney(n) { return '$' + Number(n||0).toLocaleString('en-US', { minimumFractionDigits: 2 }); }

const TIMEOUT_MS = 8000;
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

const DATE_RANGES = [
  { id: 'all', label: 'ALL TIME' },
  { id: '1d', label: 'TODAY' },
  { id: '1w', label: '1 WEEK' },
  { id: '1m', label: '1 MONTH' },
  { id: '6m', label: '6 MONTHS' },
  { id: '1y', label: '1 YEAR' },
  { id: 'custom', label: 'CUSTOM' },
];

function getDateRangeStart(rangeId) {
  if (rangeId === 'all') return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  switch (rangeId) {
    case '1d': return now;
    case '1w': now.setDate(now.getDate() - 7); return now;
    case '1m': now.setMonth(now.getMonth() - 1); return now;
    case '6m': now.setMonth(now.getMonth() - 6); return now;
    case '1y': now.setFullYear(now.getFullYear() - 1); return now;
    default: return null;
  }
}

function formatInputDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getDateRangeLabel(rangeId) {
  return DATE_RANGES.find(r => r.id === rangeId)?.label ?? 'ALL TIME';
}

export default function AllEntriesScreen() {
  const [entries, setEntries] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');
  const [filterDriver, setFilterDriver] = useState('all');
  const [dateRange, setDateRange] = useState('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);

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

  const drivers = profiles.filter(p => p.role === 'driver');

  const filtered = useMemo(() => {
    const rangeStart = dateRange === 'custom' ? null : getDateRangeStart(dateRange);

    return entries.filter(e => {
      if (filterDriver !== 'all' && e.driver_id !== filterDriver) return false;

      if (search) {
        const q = search.toLowerCase();
        const driver = profiles.find(p => p.id === e.driver_id);
        const matchSearch =
          e.city?.toLowerCase().includes(q) ||
          e.crm_id?.toLowerCase().includes(q) ||
          driver?.name?.toLowerCase().includes(q);
        if (!matchSearch) return false;
      }

      const entryDate = e.date;
      if (dateRange === 'custom') {
        if (customFrom && entryDate < customFrom) return false;
        if (customTo && entryDate > customTo) return false;
      } else if (rangeStart) {
        if (entryDate < formatInputDate(rangeStart)) return false;
      }

      return true;
    });
  }, [entries, profiles, filterDriver, search, dateRange, customFrom, customTo]);

  function handleDateRange(id) {
    setDateRange(id);
    if (id !== 'custom') {
      setCustomFrom('');
      setCustomTo('');
    }
  }

  function clearFilters() {
    setFilterDriver('all');
    setDateRange('all');
    setSearch('');
    setCustomFrom('');
    setCustomTo('');
  }

  const activeFilterCount =
    (filterDriver !== 'all' ? 1 : 0) +
    (dateRange !== 'all' ? 1 : 0) +
    (search.length > 0 ? 1 : 0);

  const selectedDriverName = filterDriver === 'all'
    ? null
    : drivers.find(d => d.id === filterDriver)?.name;

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
    <View style={s.container}>
      {/* Top bar: search + filter button */}
      <View style={s.topBar}>
        <TextInput
          style={s.search}
          value={search}
          onChangeText={setSearch}
          placeholder="Search city, CRM ID, driver..."
          placeholderTextColor="#555"
        />
        <TouchableOpacity
          style={[s.filterBtn, activeFilterCount > 0 && s.filterBtnActive]}
          onPress={() => setShowFilters(true)}
        >
          <Text style={[s.filterBtnText, activeFilterCount > 0 && s.filterBtnTextActive]}>
            {activeFilterCount > 0 ? `FILTERS (${activeFilterCount})` : 'FILTERS'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Active filter tags */}
      {activeFilterCount > 0 && (
        <View style={s.tagRow}>
          {dateRange !== 'all' && (
            <View style={s.tag}>
              <Text style={s.tagText}>
                {dateRange === 'custom' ? `${customFrom || '...'} – ${customTo || '...'}` : getDateRangeLabel(dateRange)}
              </Text>
              <TouchableOpacity onPress={() => { setDateRange('all'); setCustomFrom(''); setCustomTo(''); }}>
                <Text style={s.tagX}> ✕</Text>
              </TouchableOpacity>
            </View>
          )}
          {selectedDriverName && (
            <View style={[s.tag, s.tagDriver]}>
              <Text style={[s.tagText, s.tagDriverText]}>{selectedDriverName}</Text>
              <TouchableOpacity onPress={() => setFilterDriver('all')}>
                <Text style={[s.tagX, s.tagDriverText]}> ✕</Text>
              </TouchableOpacity>
            </View>
          )}
          {search.length > 0 && (
            <View style={s.tag}>
              <Text style={s.tagText}>"{search}"</Text>
              <TouchableOpacity onPress={() => setSearch('')}>
                <Text style={s.tagX}> ✕</Text>
              </TouchableOpacity>
            </View>
          )}
          <TouchableOpacity onPress={clearFilters}>
            <Text style={s.clearAll}>CLEAR ALL</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Result count */}
      <Text style={s.resultCount}>{filtered.length} of {entries.length} entries</Text>

      {/* Entry list */}
      <FlatList
        data={filtered}
        keyExtractor={e => e.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#f5a623" />}
        contentContainerStyle={s.list}
        ListEmptyComponent={<Text style={s.empty}>No entries match your filters.</Text>}
        renderItem={({ item: e }) => {
          const driver = profiles.find(p => p.id === e.driver_id);
          return (
            <View style={s.card}>
              <View style={s.cardTop}>
                <Text style={s.driverName}>
                  {driver?.name ?? '—'}
                  {driver?.willing_to_fly && <Text style={s.flyBadge}> (F)</Text>}
                </Text>
                <Text style={s.pay}>{fmtMoney(e.pay)}</Text>
              </View>
              <View style={s.cardMid}>
                <Text style={s.meta}>{fmtDate(e.date)}</Text>
                <Text style={s.city}>{e.city}</Text>
                <Text style={s.crm}>{e.crm_id}</Text>
              </View>
              <View style={s.cardBot}>
                <Text style={s.meta}>{e.hours ?? '—'}h</Text>
                <Text style={s.meta}>{e.miles ?? 0}mi</Text>
                {e.drive_time != null && <Text style={s.meta}>{e.drive_time}h GPS</Text>}
                <View style={[s.badge, e.recon_missed && s.badgeMiss]}>
                  <Text style={[s.badgeText, e.recon_missed && s.badgeTextMiss]}>
                    {e.recon_missed ? 'MISSED' : 'OK'}
                  </Text>
                </View>
              </View>
            </View>
          );
        }}
      />

      {/* Filter Modal */}
      <Modal visible={showFilters} transparent animationType="slide" onRequestClose={() => setShowFilters(false)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setShowFilters(false)}>
          <TouchableOpacity activeOpacity={1} style={s.modalSheet}>
            <View style={s.modalHandle} />

            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>FILTERS</Text>
              {activeFilterCount > 0 && (
                <TouchableOpacity onPress={clearFilters}>
                  <Text style={s.modalClear}>RESET ALL</Text>
                </TouchableOpacity>
              )}
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Date Range */}
              <Text style={s.sectionLabel}>DATE RANGE</Text>
              <View style={s.pillGrid}>
                {DATE_RANGES.map(r => (
                  <TouchableOpacity
                    key={r.id}
                    style={[s.modalPill, dateRange === r.id && s.modalPillActive]}
                    onPress={() => handleDateRange(r.id)}
                  >
                    <Text style={[s.modalPillText, dateRange === r.id && s.modalPillTextActive]}>
                      {r.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {dateRange === 'custom' && (
                <View style={s.customDateRow}>
                  <View style={s.dateInputWrap}>
                    <Text style={s.dateLabel}>FROM</Text>
                    <TextInput
                      style={s.dateInput}
                      value={customFrom}
                      onChangeText={setCustomFrom}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor="#333"
                      maxLength={10}
                    />
                  </View>
                  <Text style={s.dateDash}>–</Text>
                  <View style={s.dateInputWrap}>
                    <Text style={s.dateLabel}>TO</Text>
                    <TextInput
                      style={s.dateInput}
                      value={customTo}
                      onChangeText={setCustomTo}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor="#333"
                      maxLength={10}
                    />
                  </View>
                </View>
              )}

              {/* Driver */}
              <Text style={s.sectionLabel}>DRIVER</Text>
              <View style={s.pillGrid}>
                <TouchableOpacity
                  style={[s.modalPill, s.modalPillDriver, filterDriver === 'all' && s.modalPillDriverActive]}
                  onPress={() => setFilterDriver('all')}
                >
                  <Text style={[s.modalPillText, filterDriver === 'all' && s.modalPillDriverTextActive]}>
                    All Drivers
                  </Text>
                </TouchableOpacity>
                {drivers.map(d => (
                  <TouchableOpacity
                    key={d.id}
                    style={[s.modalPill, s.modalPillDriver, filterDriver === d.id && s.modalPillDriverActive]}
                    onPress={() => setFilterDriver(d.id)}
                  >
                    <Text style={[s.modalPillText, filterDriver === d.id && s.modalPillDriverTextActive]}>
                      {d.name}
                      {d.willing_to_fly ? ' (F)' : ''}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            {/* Apply button */}
            <TouchableOpacity style={s.applyBtn} onPress={() => setShowFilters(false)}>
              <Text style={s.applyBtnText}>SHOW {filtered.length} ENTRIES</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center' },

  // Top bar
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8, gap: 10 },
  search: { flex: 1, backgroundColor: '#111', borderWidth: 1, borderColor: '#1e1e1e', color: '#fff', paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, borderRadius: 6 },
  filterBtn: { borderWidth: 1, borderColor: '#1e1e1e', backgroundColor: '#111', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 6 },
  filterBtnActive: { borderColor: '#f5a623', backgroundColor: 'rgba(245,166,35,0.1)' },
  filterBtnText: { fontSize: 11, color: '#555', fontWeight: '700', letterSpacing: 1 },
  filterBtnTextActive: { color: '#f5a623' },

  // Active filter tags
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 20, gap: 8, marginBottom: 8, alignItems: 'center' },
  tag: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(245,166,35,0.1)', borderWidth: 1, borderColor: '#f5a623', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 4 },
  tagDriver: { backgroundColor: 'rgba(59,140,247,0.1)', borderColor: '#3b8cf7' },
  tagText: { fontSize: 10, color: '#f5a623', fontWeight: '600' },
  tagDriverText: { color: '#3b8cf7' },
  tagX: { fontSize: 10, color: '#f5a623', fontWeight: '700' },
  clearAll: { fontSize: 10, color: '#e85a4a', fontWeight: '700', letterSpacing: 1 },

  // Result count
  resultCount: { fontSize: 11, color: '#555', paddingHorizontal: 20, marginBottom: 8 },

  // List
  list: { paddingHorizontal: 20, paddingBottom: 40 },
  card: { backgroundColor: '#111', borderWidth: 1, borderColor: '#1e1e1e', borderLeftWidth: 3, borderLeftColor: '#2a2a2a', padding: 14, marginBottom: 8, borderRadius: 4 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  driverName: { fontSize: 14, fontWeight: '800', color: '#fff' },
  flyBadge: { fontSize: 12, fontWeight: '700', color: '#f5a623' },
  pay: { fontSize: 16, fontWeight: '900', color: '#f5a623' },
  cardMid: { flexDirection: 'row', gap: 12, marginBottom: 6 },
  city: { fontSize: 11, color: '#888', fontWeight: '600' },
  crm: { fontSize: 11, color: '#555' },
  cardBot: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  meta: { fontSize: 11, color: '#555' },
  badge: { backgroundColor: 'rgba(74,232,133,0.15)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 2 },
  badgeMiss: { backgroundColor: 'rgba(232,90,74,0.15)' },
  badgeText: { fontSize: 9, fontWeight: '700', color: '#4ae885', letterSpacing: 1 },
  badgeTextMiss: { color: '#e85a4a' },
  empty: { color: '#444', textAlign: 'center', marginTop: 32, fontSize: 13 },

  // Error
  errorText: { color: '#555', fontSize: 14, marginBottom: 16 },
  retryBtn: { borderWidth: 1, borderColor: '#f5a623', paddingHorizontal: 24, paddingVertical: 10 },
  retryText: { color: '#f5a623', fontSize: 12, letterSpacing: 2, fontWeight: '700' },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#111', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 24, paddingBottom: 40, maxHeight: '80%' },
  modalHandle: { width: 36, height: 4, backgroundColor: '#333', borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  modalTitle: { fontSize: 16, fontWeight: '900', color: '#fff', letterSpacing: 2 },
  modalClear: { fontSize: 11, color: '#e85a4a', fontWeight: '700', letterSpacing: 1 },

  // Section labels
  sectionLabel: { fontSize: 10, color: '#555', letterSpacing: 3, fontWeight: '700', marginBottom: 12, marginTop: 8 },

  // Pill grid (wrapping)
  pillGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  modalPill: { borderWidth: 1, borderColor: '#1e1e1e', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#0a0a0a', borderRadius: 6 },
  modalPillActive: { borderColor: '#f5a623', backgroundColor: 'rgba(245,166,35,0.1)' },
  modalPillDriver: {},
  modalPillDriverActive: { borderColor: '#3b8cf7', backgroundColor: 'rgba(59,140,247,0.1)' },
  modalPillText: { fontSize: 13, color: '#555', fontWeight: '600' },
  modalPillTextActive: { color: '#f5a623' },
  modalPillDriverTextActive: { color: '#3b8cf7' },

  // Custom date inputs
  customDateRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 8 },
  dateInputWrap: { flex: 1 },
  dateLabel: { fontSize: 9, color: '#555', letterSpacing: 2, marginBottom: 4 },
  dateInput: { backgroundColor: '#0a0a0a', borderWidth: 1, borderColor: '#1e1e1e', color: '#fff', paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, borderRadius: 6 },
  dateDash: { color: '#555', fontSize: 16, marginTop: 14 },

  // Apply button
  applyBtn: { backgroundColor: '#f5a623', paddingVertical: 14, borderRadius: 8, alignItems: 'center', marginTop: 12 },
  applyBtnText: { fontSize: 14, fontWeight: '800', color: '#0a0a0a', letterSpacing: 1 },
});
