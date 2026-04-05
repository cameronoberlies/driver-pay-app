import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Modal, TouchableOpacity,
  RefreshControl, ActivityIndicator, TextInput, KeyboardAvoidingView,
  Platform, Alert,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { colors, spacing, radius, typography } from '../lib/theme';
import useResponsive from '../lib/useResponsive';

// ─── Constants ───────────────────────────────────────────────────────────────

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const TIMEOUT_MS = 8000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

/** Returns array of 7 Date objects starting from today */
function getRollingWeek() {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return d;
  });
}

/** Format Date → 'YYYY-MM-DD' for Supabase */
function toDateStr(date) {
  return date.toISOString().slice(0, 10);
}

/** Format Date → 'EEE MMM D' display label */
function toDisplayLabel(date) {
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Is this date today? */
function isToday(date) {
  const today = new Date();
  return (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  );
}

// ─── CapacityModal ────────────────────────────────────────────────────────────

function CapacityModal({ visible, onClose, isAdmin }) {
  const [capacityData, setCapacityData] = useState({});   // keyed by 'YYYY-MM-DD'
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);             // dateStr currently saving
  const [error, setError] = useState(false);

  const week = getRollingWeek();

  // ── Load ──────────────────────────────────────────────────────────────────

  async function loadCapacity() {
    setError(false);
    setLoading(true);
    try {
      const dateStrs = week.map(toDateStr);
      const { data, error: err } = await withTimeout(
        supabase
          .from('daily_capacity')
          .select('*')
          .in('date', dateStrs),
        TIMEOUT_MS
      );
      if (err) throw err;

      const map = {};
      dateStrs.forEach(d => {
        const row = data?.find(r => r.date === d);
        map[d] = row ?? {
          date: d,
          flights_total: 0,
          flights_remaining: 0,
          drives_total: 0,
          drives_remaining: 0,
          notes: '',
          is_full: false,
        };
      });
      setCapacityData(map);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (visible) loadCapacity();
  }, [visible]);

  // ── Save (admin only) ─────────────────────────────────────────────────────

  async function saveDay(dateStr) {
    const row = capacityData[dateStr];
    if (!row) return;
    setSaving(dateStr);
    try {
      const flightsTotal = Number(row.flights_total) || 0;
      const drivesTotal = Number(row.drives_total) || 0;
      const flightsRemaining = Math.min(Math.max(Number(row.flights_remaining) || 0, 0), flightsTotal);
      const drivesRemaining = Math.min(Math.max(Number(row.drives_remaining) || 0, 0), drivesTotal);

      // If remaining is being set above 0, clear the full notification flag
      // so it can re-fire if the day fills up again
      const isReopening = (flightsRemaining > 0 || drivesRemaining > 0);

      const { error: err } = await supabase
        .from('daily_capacity')
        .upsert({
          date: dateStr,
          flights_total: flightsTotal,
          flights_remaining: flightsRemaining,
          drives_total: drivesTotal,
          drives_remaining: drivesRemaining,
          notes: row.notes || null,
          updated_at: new Date().toISOString(),
          ...(isReopening ? { full_notification_sent_at: null } : {}),
        }, { onConflict: 'date' });
      if (err) throw err;
      await loadCapacity();
    } catch {
      Alert.alert('Error', 'Failed to save. Please try again.');
    } finally {
      setSaving(null);
    }
  }

  // ── Field updater (local state only — saves on blur) ──────────────────────

  function updateField(dateStr, field, value) {
    setCapacityData(prev => ({
      ...prev,
      [dateStr]: { ...prev[dateStr], [field]: value },
    }));
  }

  // ── Status helpers ────────────────────────────────────────────────────────

  function getDayStatus(row) {
    if (!row) return 'empty';
    if (row.flights_total === 0 && row.drives_total === 0) return 'empty';
    if (row.is_full) return 'full';
    if (row.flights_remaining === 0 || row.drives_remaining === 0) return 'partial';
    return 'open';
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={m.wrapper}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={m.header}>
          <Text style={m.headerTitle}>CAPACITY CALENDAR</Text>
          <TouchableOpacity style={m.closeBtn} onPress={onClose}>
            <Text style={m.closeBtnText}>DONE</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={m.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : error ? (
          <View style={m.center}>
            <Text style={m.errorText}>Failed to load capacity</Text>
            <TouchableOpacity style={m.retryBtn} onPress={loadCapacity}>
              <Text style={m.retryText}>RETRY</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView
            style={m.scroll}
            contentContainerStyle={m.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {!isAdmin && (
              <View style={m.readOnlyBanner}>
                <Text style={m.readOnlyText}>READ ONLY — Contact admin to update capacity</Text>
              </View>
            )}

            {week.map(date => {
              const dateStr = toDateStr(date);
              const row = capacityData[dateStr];
              const status = getDayStatus(row);
              const isSaving = saving === dateStr;
              const today = isToday(date);

              return (
                <View
                  key={dateStr}
                  style={[
                    m.dayCard,
                    today && m.dayCardToday,
                    status === 'full' && m.dayCardFull,
                  ]}
                >
                  {/* Day header row */}
                  <View style={m.dayHeader}>
                    <View style={m.dayLabelRow}>
                      <Text style={[m.dayLabel, today && m.dayLabelToday]}>
                        {toDisplayLabel(date).toUpperCase()}
                      </Text>
                      {today && <Text style={m.todayBadge}>TODAY</Text>}
                    </View>
                    <StatusDot status={status} />
                  </View>

                  {/* Slots row */}
                  <View style={m.slotsRow}>
                    {/* Flights */}
                    <View style={m.slotBlock}>
                      <Text style={m.slotIcon}>✈️</Text>
                      {isAdmin ? (
                        <View style={m.inputRow}>
                          <TextInput
                            style={m.slotInput}
                            keyboardType="number-pad"
                            value={String(row?.flights_total ?? 0)}
                            onChangeText={v => updateField(dateStr, 'flights_total', v)}
                            onBlur={() => saveDay(dateStr)}
                            maxLength={2}
                            selectTextOnFocus
                          />
                          <Text style={m.slotSep}>/</Text>
                          <TextInput
                            style={m.slotInput}
                            keyboardType="number-pad"
                            value={String(row?.flights_remaining ?? 0)}
                            onChangeText={v => updateField(dateStr, 'flights_remaining', v)}
                            onBlur={() => saveDay(dateStr)}
                            maxLength={2}
                            selectTextOnFocus
                          />
                        </View>
                      ) : (
                        <Text style={m.slotReadOnly}>
                          {row?.flights_remaining ?? 0} of {row?.flights_total ?? 0}
                        </Text>
                      )}
                      <Text style={m.slotSubLabel}>
                        {isAdmin ? 'total / left' : 'remaining'}
                      </Text>
                    </View>

                    <View style={m.slotDivider} />

                    {/* Drives */}
                    <View style={m.slotBlock}>
                      <Text style={m.slotIcon}>🚗</Text>
                      {isAdmin ? (
                        <View style={m.inputRow}>
                          <TextInput
                            style={m.slotInput}
                            keyboardType="number-pad"
                            value={String(row?.drives_total ?? 0)}
                            onChangeText={v => updateField(dateStr, 'drives_total', v)}
                            onBlur={() => saveDay(dateStr)}
                            maxLength={2}
                            selectTextOnFocus
                          />
                          <Text style={m.slotSep}>/</Text>
                          <TextInput
                            style={m.slotInput}
                            keyboardType="number-pad"
                            value={String(row?.drives_remaining ?? 0)}
                            onChangeText={v => updateField(dateStr, 'drives_remaining', v)}
                            onBlur={() => saveDay(dateStr)}
                            maxLength={2}
                            selectTextOnFocus
                          />
                        </View>
                      ) : (
                        <Text style={m.slotReadOnly}>
                          {row?.drives_remaining ?? 0} of {row?.drives_total ?? 0}
                        </Text>
                      )}
                      <Text style={m.slotSubLabel}>
                        {isAdmin ? 'total / left' : 'remaining'}
                      </Text>
                    </View>
                  </View>

                  {/* Saving indicator */}
                  {isSaving && (
                    <View style={m.savingRow}>
                      <ActivityIndicator size="small" color={colors.primary} />
                      <Text style={m.savingText}>Saving...</Text>
                    </View>
                  )}

                  {/* Full banner */}
                  {status === 'full' && (
                    <View style={m.fullBanner}>
                      <Text style={m.fullBannerText}>🔴 DAY FULL</Text>
                    </View>
                  )}

                  {/* Notes (admin only) */}
                  {isAdmin && (
                    <TextInput
                      style={m.notesInput}
                      placeholder="Notes (optional)..."
                      placeholderTextColor={colors.textMuted}
                      value={row?.notes ?? ''}
                      onChangeText={v => updateField(dateStr, 'notes', v)}
                      onBlur={() => saveDay(dateStr)}
                      multiline
                    />
                  )}

                  {/* Notes display (caller) */}
                  {!isAdmin && row?.notes ? (
                    <Text style={m.notesDisplay}>{row.notes}</Text>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── StatusDot ────────────────────────────────────────────────────────────────

function StatusDot({ status }) {
  const color = {
    open: '#4ae885',
    partial: colors.primary,
    full: '#e85a4a',
    empty: '#333',
  }[status] ?? '#333';

  const label = {
    open: 'OPEN',
    partial: 'FILLING',
    full: 'FULL',
    empty: '—',
  }[status] ?? '';

  return (
    <View style={m.statusDotRow}>
      <View style={[m.dot, { backgroundColor: color }]} />
      <Text style={[m.statusLabel, { color }]}>{label}</Text>
    </View>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getNextWeekStart() {
  const now = new Date();
  const day = now.getDay();
  const daysUntilSunday = day === 0 ? 7 : 7 - day;
  const nextSunday = new Date(now);
  nextSunday.setDate(now.getDate() + daysUntilSunday);
  nextSunday.setHours(0, 0, 0, 0);
  return nextSunday;
}

function getNextWeekLabel() {
  const start = getNextWeekStart();
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const opts = { month: 'short', day: 'numeric' };
  return `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', { ...opts, year: 'numeric' })}`;
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_LABELS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function formatDoneBy(time) {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  if (isNaN(h)) return time;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

// ─── AvailabilityScreen ───────────────────────────────────────────────────────

export default function AvailabilityScreen() {
  const { isTablet } = useResponsive();
  const [records, setRecords] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [userRole, setUserRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [capacityModalVisible, setCapacityModalVisible] = useState(false);

  const weekStart = getNextWeekStart().toISOString().slice(0, 10);

  async function load() {
    setError(false);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const [{ data: p }, { data: a }, { data: profile }] = await withTimeout(
        Promise.all([
          supabase.from('profiles').select('*').eq('role', 'driver'),
          supabase.from('availability').select('*').eq('week_start', weekStart),
          supabase.from('profiles').select('role').eq('id', user.id).single(),
        ]),
        TIMEOUT_MS
      );
      setProfiles(p ?? []);
      setRecords(a ?? []);
      setUserRole(profile?.role ?? null);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { load(); }, []);
  function onRefresh() { setRefreshing(true); load(); }

  const isAdmin = userRole === 'admin';
  const submitted = new Set(records.map(r => r.driver_id));

  if (loading) return (
    <View style={s.center}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );

  if (error) return (
    <View style={s.center}>
      <Text style={s.errorText}>Failed to load data</Text>
      <TouchableOpacity style={s.retryBtn} onPress={() => { setLoading(true); load(); }}>
        <Text style={s.retryText}>RETRY</Text>
      </TouchableOpacity>
    </View>
  );

  if (profiles.length === 0) return (
    <View style={s.center}>
      <Text style={s.empty}>No drivers found.</Text>
    </View>
  );

  return (
    <>
      <ScrollView
        style={s.container}
        contentContainerStyle={[
          s.content,
          isTablet && { alignSelf: 'center', maxWidth: 700, width: '100%' },
        ]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        {/* ── Capacity button ── */}
        <TouchableOpacity
          style={s.capacityBtn}
          onPress={() => setCapacityModalVisible(true)}
          activeOpacity={0.75}
        >
          <Text style={s.capacityBtnText}>📋  MANAGE CAPACITY</Text>
        </TouchableOpacity>

        {/* ── Week label ── */}
        <Text style={s.weekLabel}>{getNextWeekLabel()}</Text>

        {/* ── Driver grid ── */}
        <Text style={s.sectionTitle}>DRIVER AVAILABILITY</Text>
        <View style={isTablet ? { flexDirection: 'row', flexWrap: 'wrap', gap: 10 } : undefined}>
          {profiles.map(driver => {
            const rec = records.find(r => r.driver_id === driver.id);
            const hasSubmitted = submitted.has(driver.id);

            return (
              <View key={driver.id} style={[s.card, isTablet && { width: '48.5%' }, !hasSubmitted && s.cardNotSubmitted]}>
                <View style={s.cardHeader}>
                  <Text style={s.driverName}>
                    {driver.name}
                    {driver.willing_to_fly && <Text style={s.flyBadge}> (F)</Text>}
                  </Text>
                  {!hasSubmitted && <Text style={s.notSubmitted}>NOT SUBMITTED</Text>}
                  {rec?.updated_after_saturday && <Text style={s.amended}>⚠ amended</Text>}
                </View>
                <View style={s.daysRow}>
                  {DAY_KEYS.map((key, i) => {
                    const available = rec ? rec[key] : null;
                    const doneBy = rec ? rec[`${key}_done_by`] : null;
                    return (
                      <View key={key} style={[
                        s.dayChip,
                        available === true && s.dayAvail,
                        available === false && s.dayUnavail,
                      ]}>
                        <Text style={[
                          s.dayLabel,
                          available === true && s.dayLabelAvail,
                          available === false && s.dayLabelUnavail,
                        ]}>
                          {DAY_LABELS[i]}
                        </Text>
                        {available && doneBy ? (
                          <Text style={s.doneByText}>{formatDoneBy(doneBy)}</Text>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              </View>
            );
          })}
        </View>

        {records.length === 0 && (
          <Text style={s.empty}>
            No availability submitted yet for the upcoming week.
          </Text>
        )}
      </ScrollView>

      {/* ── Capacity Modal ── */}
      <CapacityModal
        visible={capacityModalVisible}
        onClose={() => setCapacityModalVisible(false)}
        isAdmin={userRole === 'admin'}
      />
    </>
  );
}

// Note: CapacityModal receives isAdmin for display purposes.
// The actual write protection is enforced at the DB level via RLS.
// Re-wire the isAdmin prop passed to CapacityModal:
// isAdmin={userRole === 'admin'}  ← edit controls visible
// caller sees same modal, inputs replaced with read-only text

// ─── Modal Styles ─────────────────────────────────────────────────────────────

const m = StyleSheet.create({
  wrapper: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.lg,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: 12, fontWeight: '900', color: colors.textPrimary,
    letterSpacing: 2,
  },
  closeBtn: {
    borderWidth: 1, borderColor: colors.primary,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
  closeBtnText: { color: colors.primary, fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.xl, paddingBottom: spacing.xxxxl },

  readOnlyBanner: {
    backgroundColor: 'rgba(245,166,35,0.1)',
    borderWidth: 1, borderColor: colors.primary,
    borderRadius: radius.sm, padding: spacing.md,
    marginBottom: spacing.lg,
  },
  readOnlyText: {
    color: colors.primary, fontSize: 10, fontWeight: '800',
    letterSpacing: 1.5, textAlign: 'center',
  },

  dayCard: {
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
    borderLeftWidth: 3, borderLeftColor: colors.info,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  dayCardToday: { borderLeftColor: colors.primary },
  dayCardFull: { borderLeftColor: '#e85a4a', opacity: 0.85 },

  dayHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: spacing.md,
  },
  dayLabelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dayLabel: { fontSize: 11, fontWeight: '800', color: colors.textMuted, letterSpacing: 1.5 },
  dayLabelToday: { color: colors.textPrimary },
  todayBadge: {
    fontSize: 9, fontWeight: '900', color: colors.primary,
    backgroundColor: 'rgba(245,166,35,0.15)',
    paddingHorizontal: spacing.sm, paddingVertical: 2,
    borderRadius: radius.xs, letterSpacing: 1,
  },

  statusDotRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: { width: 7, height: 7, borderRadius: 4 },
  statusLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 1 },

  slotsRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: spacing.lg,
  },
  slotBlock: { flex: 1, alignItems: 'center', gap: 2 },
  slotIcon: { fontSize: 20, marginBottom: spacing.xs },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  slotInput: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.sm,
    color: colors.textPrimary,
    fontSize: 22, fontWeight: '800',
    textAlign: 'center',
    width: 48, height: 44,
  },
  slotSep: { fontSize: 18, color: colors.textMuted, fontWeight: '300' },
  slotRemaining: { fontSize: 22, fontWeight: '800', color: colors.primary, minWidth: 28, textAlign: 'center' },
  slotReadOnly: { fontSize: 22, fontWeight: '800', color: colors.textPrimary },
  slotSubLabel: { fontSize: 9, color: colors.textMuted, letterSpacing: 1, fontWeight: '700' },
  slotDivider: { width: 1, height: 48, backgroundColor: colors.border },

  savingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  savingText: { color: colors.textMuted, fontSize: 11 },

  fullBanner: {
    marginTop: spacing.sm,
    backgroundColor: 'rgba(232,90,74,0.12)',
    borderRadius: radius.sm, padding: spacing.sm,
    alignItems: 'center',
  },
  fullBannerText: { color: '#e85a4a', fontSize: 10, fontWeight: '900', letterSpacing: 2 },

  notesInput: {
    marginTop: spacing.md,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.sm,
    color: colors.textSecondary,
    fontSize: 12, padding: spacing.md,
    minHeight: 36,
  },
  notesDisplay: {
    marginTop: spacing.sm,
    fontSize: 12, color: colors.textMuted, fontStyle: 'italic',
  },

  errorText: { color: colors.textTertiary, fontSize: 14, marginBottom: spacing.lg },
  retryBtn: {
    borderWidth: 1, borderColor: colors.primary, borderRadius: radius.sm,
    paddingHorizontal: spacing.xxl, paddingVertical: spacing.md,
  },
  retryText: { color: colors.primary, fontSize: 12, letterSpacing: 2, fontWeight: '700' },
});

// ─── Screen Styles ────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.xxxxl },
  center: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  sectionTitle: { ...typography.label, color: colors.textMuted, marginBottom: spacing.lg },

  capacityBtn: {
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  capacityBtnText: {
    color: colors.primary, fontSize: 12,
    fontWeight: '800', letterSpacing: 2,
  },

  weekLabel: {
    ...typography.captionSm,
    color: colors.textTertiary,
    letterSpacing: 1,
    marginBottom: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
    borderLeftWidth: 3, borderLeftColor: colors.info,
    borderRadius: radius.md,
    padding: spacing.lg, marginBottom: spacing.md,
  },
  cardNotSubmitted: {
    borderLeftColor: colors.textMuted,
    opacity: 0.6,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  driverName: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
  flyBadge: { fontSize: 12, fontWeight: '700', color: colors.primary },
  notSubmitted: { ...typography.labelSm, color: colors.textMuted, letterSpacing: 1 },
  amended: { ...typography.labelSm, color: colors.warning, letterSpacing: 1 },
  daysRow: { flexDirection: 'row', gap: radius.sm },
  dayChip: {
    flex: 1, minHeight: 42, borderRadius: radius.sm,
    backgroundColor: colors.surfaceElevated,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: colors.borderLight,
    paddingVertical: spacing.xs,
  },
  dayAvail: { backgroundColor: colors.successDim, borderColor: colors.success },
  dayUnavail: { backgroundColor: colors.errorDim, borderColor: colors.borderLight },
  dayLabel: { fontSize: 10, fontWeight: '800', color: colors.textMuted, letterSpacing: 0.5 },
  dayLabelAvail: { color: colors.success },
  dayLabelUnavail: { color: colors.textMuted },
  doneByText: { fontSize: 8, color: colors.textTertiary, marginTop: 1 },

  empty: { ...typography.bodySm, color: colors.textTertiary, textAlign: 'center', marginTop: spacing.sm },
  errorText: { color: colors.textTertiary, fontSize: 14, marginBottom: spacing.lg },
  retryBtn: {
    borderWidth: 1, borderColor: colors.primary, borderRadius: radius.sm,
    paddingHorizontal: spacing.xxl, paddingVertical: spacing.md,
  },
  retryText: { color: colors.primary, fontSize: 12, letterSpacing: 2, fontWeight: '700' },
});