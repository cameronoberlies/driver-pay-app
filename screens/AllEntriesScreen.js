import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, RefreshControl, ActivityIndicator, Modal, ScrollView,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { colors, spacing, radius, typography, components } from '../lib/theme';

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
  container: { ...components.screen },
  center: { ...components.center },

  // Top bar
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.sm, gap: spacing.md },
  search: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, color: colors.textPrimary, paddingHorizontal: spacing.md, paddingVertical: spacing.md, ...typography.bodySm, borderRadius: radius.sm },
  filterBtn: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.sm },
  filterBtnActive: { borderColor: colors.primary, backgroundColor: colors.primaryDim },
  filterBtnText: { ...typography.label, color: colors.textTertiary },
  filterBtnTextActive: { color: colors.primary },

  // Active filter tags
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: spacing.xl, gap: spacing.sm, marginBottom: spacing.sm, alignItems: 'center' },
  tag: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primaryDim, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  tagDriver: { backgroundColor: colors.infoDim, borderColor: colors.info },
  tagText: { ...typography.captionSm, fontWeight: '600', color: colors.primary },
  tagDriverText: { color: colors.info },
  tagX: { ...typography.captionSm, fontWeight: '700', color: colors.primary },
  clearAll: { ...typography.captionSm, fontWeight: '700', color: colors.error, letterSpacing: 1 },

  // Result count
  resultCount: { ...typography.captionSm, color: colors.textTertiary, paddingHorizontal: spacing.xl, marginBottom: spacing.sm },

  // List
  list: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxxl },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderLeftWidth: 3, borderLeftColor: colors.borderLight, padding: spacing.lg, marginBottom: spacing.sm, borderRadius: radius.md },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs },
  driverName: { ...typography.body, fontWeight: '800', color: colors.textPrimary },
  flyBadge: { ...typography.caption, fontWeight: '700', color: colors.primary },
  pay: { ...typography.h2, fontSize: 16, color: colors.primary },
  cardMid: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.sm },
  city: { ...typography.captionSm, fontWeight: '600', color: colors.textSecondary },
  crm: { ...typography.captionSm, color: colors.textTertiary },
  cardBot: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  meta: { ...typography.captionSm, color: colors.textTertiary },
  badge: { backgroundColor: colors.successDim, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.sm },
  badgeMiss: { backgroundColor: colors.errorDim },
  badgeText: { ...typography.labelSm, color: colors.success, letterSpacing: 1 },
  badgeTextMiss: { color: colors.error },
  empty: { color: colors.textMuted, textAlign: 'center', marginTop: spacing.xxxl, ...typography.bodySm },

  // Error
  errorText: { ...components.errorText },
  retryBtn: { ...components.retryBtn },
  retryText: { ...components.retryText },

  // Modal
  modalOverlay: { ...components.modalOverlay },
  modalSheet: { ...components.modalSheet, maxHeight: '80%' },
  modalHandle: { ...components.modalHandle },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xxl },
  modalTitle: { ...typography.h3, fontWeight: '900', color: colors.textPrimary, letterSpacing: 2 },
  modalClear: { ...typography.captionSm, color: colors.error, fontWeight: '700', letterSpacing: 1 },

  // Section labels
  sectionLabel: { ...typography.labelSm, color: colors.textTertiary, letterSpacing: 3, marginBottom: spacing.md, marginTop: spacing.sm },

  // Pill grid (wrapping)
  pillGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.xl },
  modalPill: { ...components.pill, borderRadius: radius.sm, paddingVertical: spacing.md, backgroundColor: colors.bg },
  modalPillActive: { ...components.pillActive },
  modalPillDriver: {},
  modalPillDriverActive: { borderColor: colors.info, backgroundColor: colors.infoDim },
  modalPillText: { ...components.pillText },
  modalPillTextActive: { ...components.pillTextActive },
  modalPillDriverTextActive: { color: colors.info },

  // Custom date inputs
  customDateRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.lg, gap: spacing.sm },
  dateInputWrap: { flex: 1 },
  dateLabel: { ...typography.labelSm, color: colors.textTertiary, letterSpacing: 2, marginBottom: spacing.xs },
  dateInput: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, color: colors.textPrimary, paddingHorizontal: spacing.md, paddingVertical: spacing.md, ...typography.bodySm, borderRadius: radius.sm },
  dateDash: { color: colors.textTertiary, fontSize: 16, marginTop: spacing.lg },

  // Apply button
  applyBtn: { ...components.buttonPrimary, borderRadius: radius.sm, marginTop: spacing.md },
  applyBtnText: { ...components.buttonPrimaryText },
});
