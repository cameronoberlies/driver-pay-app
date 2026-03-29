import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, RefreshControl, ActivityIndicator, Modal, ScrollView,
  Platform, Alert,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
let FileSystem = null;
let Sharing = null;
try {
  FileSystem = require('expo-file-system');
  Sharing = require('expo-sharing');
} catch (e) {
  console.log('expo-file-system or expo-sharing not available');
}
import { supabase } from '../lib/supabase';
import { colors, spacing, radius, typography, components } from '../lib/theme';
import useResponsive from '../lib/useResponsive';

function fmtDate(d) { const [y,m,day] = d.split('-'); return `${m}/${day}/${y}`; }
function fmtMoney(n) { return '$' + Number(n||0).toLocaleString('en-US', { minimumFractionDigits: 2 }); }

const TIMEOUT_MS = 8000;
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

function toDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toDisplayDate(date) {
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

const QUICK_RANGES = [
  { id: 'all', label: 'ALL' },
  { id: '1w', label: '1W' },
  { id: '1m', label: '1M' },
  { id: '6m', label: '6M' },
];

function getQuickRange(rangeId) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  switch (rangeId) {
    case '1w': { const s = new Date(now); s.setDate(s.getDate() - 7); return { from: s, to: end }; }
    case '1m': { const s = new Date(now); s.setMonth(s.getMonth() - 1); return { from: s, to: end }; }
    case '6m': { const s = new Date(now); s.setMonth(s.getMonth() - 6); return { from: s, to: end }; }
    default: return null;
  }
}

export default function AllEntriesScreen() {
  const { isTablet } = useResponsive();
  const [entries, setEntries] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');
  const [filterDriver, setFilterDriver] = useState('all');
  const [showFilters, setShowFilters] = useState(false);

  // Date range state
  const [quickRange, setQuickRange] = useState('all');
  const [dateFrom, setDateFrom] = useState(null); // Date object or null
  const [dateTo, setDateTo] = useState(null);
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);

  // CSV export
  const [exporting, setExporting] = useState(false);

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
    // Determine effective date range
    let effectiveFrom = dateFrom ? toDateString(dateFrom) : null;
    let effectiveTo = dateTo ? toDateString(dateTo) : null;

    if (quickRange !== 'all' && quickRange !== 'custom') {
      const range = getQuickRange(quickRange);
      if (range) {
        effectiveFrom = toDateString(range.from);
        effectiveTo = toDateString(range.to);
      }
    }

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
      if (effectiveFrom && entryDate < effectiveFrom) return false;
      if (effectiveTo && entryDate > effectiveTo) return false;

      return true;
    });
  }, [entries, profiles, filterDriver, search, quickRange, dateFrom, dateTo]);

  function handleQuickRange(id) {
    setQuickRange(id);
    if (id !== 'custom' && id !== 'all') {
      const range = getQuickRange(id);
      if (range) {
        setDateFrom(range.from);
        setDateTo(range.to);
      }
    } else if (id === 'all') {
      setDateFrom(null);
      setDateTo(null);
    }
  }

  function handleFromChange(event, selectedDate) {
    if (Platform.OS === 'android') setShowFromPicker(false);
    if (selectedDate) {
      setDateFrom(selectedDate);
      setQuickRange('custom');
    }
  }

  function handleToChange(event, selectedDate) {
    if (Platform.OS === 'android') setShowToPicker(false);
    if (selectedDate) {
      setDateTo(selectedDate);
      setQuickRange('custom');
    }
  }

  function clearFilters() {
    setFilterDriver('all');
    setQuickRange('all');
    setDateFrom(null);
    setDateTo(null);
    setSearch('');
  }

  const activeFilterCount =
    (filterDriver !== 'all' ? 1 : 0) +
    (quickRange !== 'all' ? 1 : 0) +
    (search.length > 0 ? 1 : 0);

  const selectedDriverName = filterDriver === 'all'
    ? null
    : drivers.find(d => d.id === filterDriver)?.name;

  // ── CSV EXPORT ──

  async function handleExportCSV() {
    if (!FileSystem || !Sharing) {
      Alert.alert('Not Available', 'CSV export requires an app update. Please update from the App Store.');
      return;
    }
    if (filtered.length === 0) {
      Alert.alert('No Data', 'No entries to export with the current filters.');
      return;
    }

    setExporting(true);
    try {
      const headers = ['Date', 'Driver', 'City', 'CRM ID', 'Hours', 'Miles', 'Drive Time (GPS)', 'Pay', 'Recon'];
      const rows = filtered.map(e => {
        const driver = profiles.find(p => p.id === e.driver_id);
        return [
          e.date,
          driver?.name ?? 'Unknown',
          e.city ?? '',
          e.crm_id ?? '',
          e.hours ?? '',
          e.miles ?? 0,
          e.drive_time ?? '',
          Number(e.pay || 0).toFixed(2),
          e.recon_missed ? 'MISSED' : 'OK',
        ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
      });

      const csv = [headers.join(','), ...rows].join('\n');

      // Build filename with date range
      let fileLabel = 'all';
      if (dateFrom && dateTo) {
        fileLabel = `${toDateString(dateFrom)}_to_${toDateString(dateTo)}`;
      } else if (dateFrom) {
        fileLabel = `from_${toDateString(dateFrom)}`;
      } else if (dateTo) {
        fileLabel = `to_${toDateString(dateTo)}`;
      }
      if (selectedDriverName) {
        fileLabel += `_${selectedDriverName.replace(/\s+/g, '-')}`;
      }

      const fileName = `entries_${fileLabel}.csv`;
      const filePath = `${FileSystem.cacheDirectory}${fileName}`;

      await FileSystem.writeAsStringAsync(filePath, csv, { encoding: FileSystem.EncodingType.UTF8 });
      await Sharing.shareAsync(filePath, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' });
    } catch (e) {
      if (e.message !== 'User did not share') {
        Alert.alert('Export Failed', e.message || 'Something went wrong');
      }
    } finally {
      setExporting(false);
    }
  }

  // ── RENDER ──

  if (loading) return <View style={s.center}><ActivityIndicator color={colors.primary} /></View>;

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
      <View style={isTablet ? { alignSelf: 'center', maxWidth: 700, width: '100%', flex: 1 } : { flex: 1 }}>
      {/* Top bar: search + filter + export */}
      <View style={s.topBar}>
        <TextInput
          style={s.search}
          value={search}
          onChangeText={setSearch}
          placeholder="Search city, CRM ID, driver..."
          placeholderTextColor={colors.textMuted}
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
          {quickRange !== 'all' && (
            <View style={s.tag}>
              <Text style={s.tagText}>
                {dateFrom && dateTo
                  ? `${toDisplayDate(dateFrom)} – ${toDisplayDate(dateTo)}`
                  : dateFrom
                  ? `From ${toDisplayDate(dateFrom)}`
                  : dateTo
                  ? `To ${toDisplayDate(dateTo)}`
                  : quickRange.toUpperCase()}
              </Text>
              <TouchableOpacity onPress={() => { setQuickRange('all'); setDateFrom(null); setDateTo(null); }}>
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

      {/* Result count + Export */}
      <View style={s.resultRow}>
        <Text style={s.resultCount}>{filtered.length} of {entries.length} entries</Text>
        <TouchableOpacity
          style={[s.exportBtn, exporting && { opacity: 0.5 }]}
          onPress={handleExportCSV}
          disabled={exporting}
        >
          <Text style={s.exportBtnText}>{exporting ? 'EXPORTING...' : 'EXPORT CSV'}</Text>
        </TouchableOpacity>
      </View>

      {/* Entry list */}
      <FlatList
        data={filtered}
        keyExtractor={e => e.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        contentContainerStyle={s.list}
        ListEmptyComponent={<Text style={s.empty}>No entries match your filters.</Text>}
        numColumns={isTablet ? 2 : 1}
        key={isTablet ? 'tablet' : 'phone'}
        columnWrapperStyle={isTablet ? { gap: 10 } : undefined}
        renderItem={({ item: e }) => {
          const driver = profiles.find(p => p.id === e.driver_id);
          return (
            <View style={[s.card, isTablet && { width: '48.5%' }]}>
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

      </View>

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

              {/* Quick presets */}
              <View style={s.pillGrid}>
                {QUICK_RANGES.map(r => (
                  <TouchableOpacity
                    key={r.id}
                    style={[s.modalPill, quickRange === r.id && s.modalPillActive]}
                    onPress={() => handleQuickRange(r.id)}
                  >
                    <Text style={[s.modalPillText, quickRange === r.id && s.modalPillTextActive]}>
                      {r.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* From / To date pickers */}
              <View style={s.datePickerRow}>
                <View style={s.datePickerCol}>
                  <Text style={s.dateLabel}>FROM</Text>
                  <TouchableOpacity
                    style={[s.dateBtn, dateFrom && s.dateBtnActive]}
                    onPress={() => setShowFromPicker(true)}
                  >
                    <Text style={[s.dateBtnText, dateFrom && s.dateBtnTextActive]}>
                      {dateFrom ? toDisplayDate(dateFrom) : 'Select date'}
                    </Text>
                  </TouchableOpacity>
                </View>
                <Text style={s.dateDash}>–</Text>
                <View style={s.datePickerCol}>
                  <Text style={s.dateLabel}>TO</Text>
                  <TouchableOpacity
                    style={[s.dateBtn, dateTo && s.dateBtnActive]}
                    onPress={() => setShowToPicker(true)}
                  >
                    <Text style={[s.dateBtnText, dateTo && s.dateBtnTextActive]}>
                      {dateTo ? toDisplayDate(dateTo) : 'Select date'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* iOS inline pickers */}
              {showFromPicker && (
                <View style={s.pickerWrap}>
                  <DateTimePicker
                    value={dateFrom || new Date()}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    themeVariant="dark"
                    textColor="#fff"
                    onChange={handleFromChange}
                    maximumDate={dateTo || undefined}
                  />
                  {Platform.OS === 'ios' && (
                    <TouchableOpacity style={s.pickerDone} onPress={() => setShowFromPicker(false)}>
                      <Text style={s.pickerDoneText}>DONE</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {showToPicker && (
                <View style={s.pickerWrap}>
                  <DateTimePicker
                    value={dateTo || new Date()}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    themeVariant="dark"
                    textColor="#fff"
                    onChange={handleToChange}
                    minimumDate={dateFrom || undefined}
                  />
                  {Platform.OS === 'ios' && (
                    <TouchableOpacity style={s.pickerDone} onPress={() => setShowToPicker(false)}>
                      <Text style={s.pickerDoneText}>DONE</Text>
                    </TouchableOpacity>
                  )}
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

  // Result count + export
  resultRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.xl, marginBottom: spacing.sm },
  resultCount: { ...typography.captionSm, color: colors.textTertiary },
  exportBtn: { borderWidth: 1, borderColor: colors.successBorder, backgroundColor: colors.successDim, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  exportBtnText: { ...typography.labelSm, color: colors.success, letterSpacing: 1 },

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
  modalSheet: { ...components.modalSheet, maxHeight: '85%' },
  modalHandle: { ...components.modalHandle },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xxl },
  modalTitle: { ...typography.h3, fontWeight: '900', color: colors.textPrimary, letterSpacing: 2 },
  modalClear: { ...typography.captionSm, color: colors.error, fontWeight: '700', letterSpacing: 1 },

  // Section labels
  sectionLabel: { ...typography.labelSm, color: colors.textTertiary, letterSpacing: 3, marginBottom: spacing.md, marginTop: spacing.sm },

  // Pill grid
  pillGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.xl },
  modalPill: { ...components.pill, borderRadius: radius.sm, paddingVertical: spacing.md, backgroundColor: colors.bg },
  modalPillActive: { ...components.pillActive },
  modalPillDriver: {},
  modalPillDriverActive: { borderColor: colors.info, backgroundColor: colors.infoDim },
  modalPillText: { ...components.pillText },
  modalPillTextActive: { ...components.pillTextActive },
  modalPillDriverTextActive: { color: colors.info },

  // Date picker
  datePickerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.lg, gap: spacing.sm },
  datePickerCol: { flex: 1 },
  dateLabel: { ...typography.labelSm, color: colors.textTertiary, letterSpacing: 2, marginBottom: spacing.xs },
  dateBtn: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  dateBtnActive: { borderColor: colors.primary },
  dateBtnText: { ...typography.bodySm, color: colors.textMuted },
  dateBtnTextActive: { color: colors.textPrimary },
  dateDash: { color: colors.textTertiary, fontSize: 16, marginTop: spacing.lg },
  pickerWrap: { backgroundColor: colors.surfaceElevated, borderRadius: radius.md, marginBottom: spacing.md, overflow: 'hidden' },
  pickerDone: { alignItems: 'center', paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  pickerDoneText: { ...typography.label, color: colors.primary },

  // Apply button
  applyBtn: { ...components.buttonPrimary, borderRadius: radius.sm, marginTop: spacing.md },
  applyBtnText: { ...components.buttonPrimaryText },
});
