import React, { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, Modal, Platform, Alert, Keyboard, KeyboardAvoidingView,
  Pressable,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { colors, spacing, radius, typography, components } from '../lib/theme';

let FileSystem = null;
let Sharing = null;
try {
  FileSystem = require('expo-file-system');
  Sharing = require('expo-sharing');
} catch (e) {
  // Not available until next native build
}

function fmtDate(d) {
  const [y, m, day] = d.split('-');
  return `${m}/${day}/${y}`;
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
  { id: '1y', label: '1Y' },
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
    case '1y': { const s = new Date(now); s.setFullYear(s.getFullYear() - 1); return { from: s, to: end }; }
    default: return null;
  }
}

export default function DriverEntriesModal({ visible, onClose, entries }) {
  const [filterCity, setFilterCity] = useState('all');
  const [cityQuery, setCityQuery] = useState('');
  const [quickRange, setQuickRange] = useState('all');
  const [dateFrom, setDateFrom] = useState(null);
  const [dateTo, setDateTo] = useState(null);
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [exporting, setExporting] = useState(false);

  const uniqueCities = useMemo(() => {
    const cities = [...new Set(entries.map(e => e.city).filter(Boolean))];
    cities.sort((a, b) => a.localeCompare(b));
    return cities;
  }, [entries]);

  const citySuggestions = useMemo(() => {
    if (!cityQuery || cityQuery.length < 1) return [];
    const q = cityQuery.toLowerCase();
    return uniqueCities.filter(c => c.toLowerCase().includes(q));
  }, [cityQuery, uniqueCities]);

  const filtered = useMemo(() => {
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
      if (filterCity !== 'all' && e.city !== filterCity) return false;
      if (effectiveFrom && e.date < effectiveFrom) return false;
      if (effectiveTo && e.date > effectiveTo) return false;
      return true;
    });
  }, [entries, filterCity, quickRange, dateFrom, dateTo]);

  const totals = useMemo(() => ({
    pay: filtered.reduce((s, e) => s + Number(e.pay || 0), 0),
    trips: filtered.length,
    miles: filtered.reduce((s, e) => s + Number(e.miles || 0), 0),
    hours: filtered.reduce((s, e) => s + Number(e.hours || 0), 0),
  }), [filtered]);

  function handleQuickRange(id) {
    setQuickRange(id);
    setShowFilters(false);
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
    setFilterCity('all');
    setQuickRange('all');
    setDateFrom(null);
    setDateTo(null);
  }

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
      const headers = ['Date', 'City', 'CRM ID', 'Hours', 'Miles', 'Drive Time (GPS)', 'Pay', 'Recon'];
      const rows = filtered.map(e => [
        e.date,
        e.city ?? '',
        e.crm_id ?? '',
        e.hours ?? '',
        e.miles ?? 0,
        e.drive_time ?? '',
        Number(e.pay || 0).toFixed(2),
        e.recon_missed ? 'MISSED' : 'OK',
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));

      const csv = [headers.join(','), ...rows].join('\n');

      let fileLabel = 'all';
      if (dateFrom && dateTo) {
        fileLabel = `${toDateString(dateFrom)}_to_${toDateString(dateTo)}`;
      } else if (dateFrom) {
        fileLabel = `from_${toDateString(dateFrom)}`;
      } else if (dateTo) {
        fileLabel = `to_${toDateString(dateTo)}`;
      }

      const fileName = `my_entries_${fileLabel}.csv`;
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

  const activeFilterCount =
    (quickRange !== 'all' ? 1 : 0) +
    (filterCity !== 'all' ? 1 : 0);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={onClose}>
        <Pressable style={s.sheet} onPress={Keyboard.dismiss}>
          <View style={s.handle} />

          {/* Header */}
          <View style={s.header}>
            <Text style={s.title}>ALL ENTRIES</Text>
            <TouchableOpacity style={s.closeBtn} onPress={onClose}>
              <Text style={s.closeBtnText}>CLOSE</Text>
            </TouchableOpacity>
          </View>

          {/* Summary Card */}
          <View style={s.summaryCard}>
            <View style={s.summaryMain}>
              <Text style={s.summaryPay}>${totals.pay.toFixed(2)}</Text>
              <Text style={s.summaryLabel}>
                {quickRange === 'all' ? 'ALL TIME' : quickRange === 'custom' ? 'CUSTOM RANGE' : quickRange.toUpperCase()}
              </Text>
            </View>
            <View style={s.summaryStats}>
              <View style={s.summaryStat}>
                <Text style={s.summaryStatValue}>{totals.trips}</Text>
                <Text style={s.summaryStatLabel}>trips</Text>
              </View>
              <View style={s.summaryStat}>
                <Text style={s.summaryStatValue}>{totals.miles.toFixed(0)}</Text>
                <Text style={s.summaryStatLabel}>miles</Text>
              </View>
              <View style={s.summaryStat}>
                <Text style={s.summaryStatValue}>{totals.hours.toFixed(1)}</Text>
                <Text style={s.summaryStatLabel}>hours</Text>
              </View>
            </View>
          </View>

          {/* Quick Range Pills */}
          <View style={s.pillRow}>
            {QUICK_RANGES.map(r => (
              <TouchableOpacity
                key={r.id}
                style={[s.pill, quickRange === r.id && s.pillActive]}
                onPress={() => handleQuickRange(r.id)}
              >
                <Text style={[s.pillText, quickRange === r.id && s.pillTextActive]}>
                  {r.label}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[s.pill, quickRange === 'custom' && s.pillActive]}
              onPress={() => {
                setQuickRange('custom');
                setShowFilters(v => !v);
              }}
            >
              <Text style={[s.pillText, quickRange === 'custom' && s.pillTextActive]}>
                CUSTOM
              </Text>
            </TouchableOpacity>
          </View>

          {/* Custom Date Pickers (collapsible) */}
          {showFilters && (
            <View style={s.filterSection}>
              <View style={s.datePickerRow}>
                <View style={s.datePickerCol}>
                  <Text style={s.dateLabel}>FROM</Text>
                  <TouchableOpacity
                    style={[s.dateBtn, dateFrom && s.dateBtnActive]}
                    onPress={() => setShowFromPicker(true)}
                  >
                    <Text style={[s.dateBtnText, dateFrom && s.dateBtnTextActive]}>
                      {dateFrom ? toDisplayDate(dateFrom) : 'Select'}
                    </Text>
                  </TouchableOpacity>
                </View>
                <Text style={s.dateDash}>-</Text>
                <View style={s.datePickerCol}>
                  <Text style={s.dateLabel}>TO</Text>
                  <TouchableOpacity
                    style={[s.dateBtn, dateTo && s.dateBtnActive]}
                    onPress={() => setShowToPicker(true)}
                  >
                    <Text style={[s.dateBtnText, dateTo && s.dateBtnTextActive]}>
                      {dateTo ? toDisplayDate(dateTo) : 'Select'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

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
            </View>
          )}

          {/* City Search */}
          <View style={s.citySearchWrapper}>
            <TextInput
              style={s.citySearch}
              value={cityQuery}
              onChangeText={(text) => {
                setCityQuery(text);
                if (!text) setFilterCity('all');
              }}
              placeholder={filterCity === 'all' ? 'Filter by city...' : filterCity}
              placeholderTextColor={filterCity === 'all' ? colors.textMuted : colors.textPrimary}
              autoCapitalize="words"
            />
            {filterCity !== 'all' && (
              <TouchableOpacity
                style={s.cityClear}
                onPress={() => { setFilterCity('all'); setCityQuery(''); }}
              >
                <Text style={s.cityClearText}>x</Text>
              </TouchableOpacity>
            )}
            {citySuggestions.length > 0 && cityQuery.length > 0 && filterCity === 'all' && (
              <View style={s.cityDropdown}>
                {citySuggestions.map(city => (
                  <Pressable
                    key={city}
                    style={({ pressed }) => [s.citySuggestion, pressed && s.citySuggestionPressed]}
                    onPress={() => {
                      setFilterCity(city);
                      setCityQuery('');
                      Keyboard.dismiss();
                    }}
                  >
                    <Text style={s.citySuggestionText}>{city}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          {/* Active filter tags + Export */}
          <View style={s.filterRow}>
            <View style={s.tagRow}>
              {activeFilterCount > 0 && (
                <>
                  {quickRange !== 'all' && (
                    <View style={s.tag}>
                      <Text style={s.tagText}>
                        {dateFrom && dateTo
                          ? `${toDisplayDate(dateFrom)} - ${toDisplayDate(dateTo)}`
                          : quickRange.toUpperCase()}
                      </Text>
                      <TouchableOpacity onPress={() => { setQuickRange('all'); setDateFrom(null); setDateTo(null); }}>
                        <Text style={s.tagX}> x</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  {filterCity !== 'all' && (
                    <View style={[s.tag, s.tagCity]}>
                      <Text style={[s.tagText, s.tagCityText]}>{filterCity}</Text>
                      <TouchableOpacity onPress={() => setFilterCity('all')}>
                        <Text style={[s.tagX, s.tagCityText]}> x</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  <TouchableOpacity onPress={clearFilters}>
                    <Text style={s.clearAll}>CLEAR</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
            <TouchableOpacity
              style={[s.exportBtn, exporting && { opacity: 0.5 }]}
              onPress={handleExportCSV}
              disabled={exporting}
            >
              <Text style={s.exportBtnText}>{exporting ? '...' : 'CSV'}</Text>
            </TouchableOpacity>
          </View>

          {/* Result count */}
          <Text style={s.resultCount}>{filtered.length} of {entries.length} entries</Text>

          {/* Entry List */}
          <FlatList
            data={filtered}
            keyExtractor={e => e.id}
            style={s.list}
            contentContainerStyle={s.listContent}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={<Text style={s.empty}>No entries match your filters.</Text>}
            renderItem={({ item: e }) => (
              <View style={s.card}>
                <View style={s.cardTop}>
                  <Text style={s.cardCity}>{e.city}</Text>
                  <Text style={s.cardPay}>${Number(e.pay || 0).toFixed(2)}</Text>
                </View>
                <View style={s.cardBot}>
                  <Text style={s.cardMeta}>{fmtDate(e.date)}</Text>
                  {e.miles != null && <Text style={s.cardMeta}>{e.miles} mi</Text>}
                  {e.hours != null && <Text style={s.cardMeta}>{e.hours}h</Text>}
                  {e.drive_time != null && <Text style={s.cardMeta}>{e.drive_time}h GPS</Text>}
                  <View style={[s.badge, e.recon_missed && s.badgeMiss]}>
                    <Text style={[s.badgeText, e.recon_missed && s.badgeTextMiss]}>
                      {e.recon_missed ? 'MISSED' : 'OK'}
                    </Text>
                  </View>
                </View>
              </View>
            )}
          />
        </Pressable>
      </TouchableOpacity>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.xxxxl,
    flex: 1,
    maxWidth: 700,
    width: '100%',
    alignSelf: 'center',
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: colors.borderLight,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 60,
    marginBottom: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    ...typography.h3,
    fontWeight: '900',
    color: colors.textPrimary,
    letterSpacing: 2,
  },
  closeBtn: {
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  closeBtnText: {
    ...typography.labelSm,
    color: colors.textTertiary,
    letterSpacing: 1.5,
  },

  // Summary
  summaryCard: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  summaryMain: {
    marginBottom: spacing.md,
  },
  summaryPay: {
    ...typography.displayMd,
    color: colors.primary,
  },
  summaryLabel: {
    ...typography.labelSm,
    fontSize: 9,
    color: colors.textTertiary,
    letterSpacing: 2.5,
    marginTop: spacing.xs,
  },
  summaryStats: {
    flexDirection: 'row',
    gap: spacing.xxl,
  },
  summaryStat: {
    alignItems: 'center',
  },
  summaryStatValue: {
    ...typography.h2,
    color: colors.textPrimary,
  },
  summaryStatLabel: {
    ...typography.captionSm,
    color: colors.textTertiary,
  },

  // Pills
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  pill: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.bg,
  },
  pillActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryDim,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textTertiary,
    letterSpacing: 1,
  },
  pillTextActive: {
    color: colors.primary,
  },

  // Filter section
  filterSection: {
    marginBottom: spacing.md,
  },
  datePickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  datePickerCol: { flex: 1 },
  dateLabel: {
    ...typography.labelSm,
    color: colors.textTertiary,
    letterSpacing: 2,
    marginBottom: spacing.xs,
  },
  dateBtn: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  dateBtnActive: { borderColor: colors.primary },
  dateBtnText: { ...typography.bodySm, color: colors.textMuted },
  dateBtnTextActive: { color: colors.textPrimary },
  dateDash: { color: colors.textTertiary, fontSize: 16, marginTop: spacing.lg },
  pickerWrap: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.md,
    marginTop: spacing.md,
    overflow: 'hidden',
  },
  pickerDone: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  pickerDoneText: { ...typography.label, color: colors.primary },

  // City search
  citySearchWrapper: {
    position: 'relative',
    zIndex: 10,
    marginBottom: spacing.sm,
  },
  citySearch: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.textPrimary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    paddingRight: 40,
    ...typography.bodySm,
    borderRadius: radius.sm,
  },
  cityClear: {
    position: 'absolute',
    right: spacing.md,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  cityClearText: {
    color: colors.textTertiary,
    fontSize: 16,
    fontWeight: '700',
  },
  cityDropdown: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: radius.sm,
    marginTop: 2,
    overflow: 'hidden',
    zIndex: 20,
  },
  citySuggestion: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  citySuggestionPressed: {
    backgroundColor: colors.primaryDim,
  },
  citySuggestionText: {
    fontSize: 14,
    color: colors.textPrimary,
    fontWeight: '600',
  },

  // Filter row (tags + export)
  filterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  exportBtn: {
    borderWidth: 1,
    borderColor: colors.successBorder,
    backgroundColor: colors.successDim,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    justifyContent: 'center',
  },
  exportBtnText: {
    ...typography.labelSm,
    color: colors.success,
    letterSpacing: 1,
  },

  // Tags
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    alignItems: 'center',
    flex: 1,
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primaryDim,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  tagText: { ...typography.captionSm, fontWeight: '600', color: colors.primary },
  tagCity: { backgroundColor: colors.infoDim, borderColor: colors.info },
  tagCityText: { color: colors.info },
  tagX: { ...typography.captionSm, fontWeight: '700', color: colors.primary },
  clearAll: { ...typography.captionSm, fontWeight: '700', color: colors.error, letterSpacing: 1 },

  // Result count
  resultCount: {
    ...typography.captionSm,
    color: colors.textTertiary,
    marginBottom: spacing.sm,
  },

  // List
  list: { flex: 1 },
  listContent: { paddingBottom: spacing.xxl },
  card: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  cardCity: {
    ...typography.h3,
    fontSize: 15,
    color: colors.textPrimary,
  },
  cardPay: {
    ...typography.h2,
    fontSize: 16,
    color: colors.primary,
  },
  cardBot: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'center',
  },
  cardMeta: { ...typography.captionSm, color: colors.textTertiary },
  badge: {
    backgroundColor: colors.successDim,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  badgeMiss: { backgroundColor: colors.errorDim },
  badgeText: { ...typography.labelSm, color: colors.success, letterSpacing: 1 },
  badgeTextMiss: { color: colors.error },
  empty: {
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xxxl,
    ...typography.bodySm,
  },
});
