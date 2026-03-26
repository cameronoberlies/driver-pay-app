import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Switch,
  TouchableOpacity, ActivityIndicator, TextInput, Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { colors, spacing, radius, typography, components } from '../lib/theme';
import useResponsive from '../lib/useResponsive';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function getNextWeekStart() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 6=Sat
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

export default function DriverAvailabilityScreen({ session }) {
  const { isTablet } = useResponsive();
  const weekStart = getNextWeekStart().toISOString().slice(0, 10);

  const emptyAvail = {
    sun: false, mon: false, tue: false, wed: false,
    thu: false, fri: false, sat: false,
    sun_done_by: '', mon_done_by: '', tue_done_by: '',
    wed_done_by: '', thu_done_by: '', fri_done_by: '', sat_done_by: '',
  };

  const [avail, setAvail] = useState(emptyAvail);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [existingRecord, setExistingRecord] = useState(null);

  const today = new Date().getDay();
  const isAfterSat = today !== 6; // not Saturday
  const isAmend = existingRecord && isAfterSat;

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('availability')
      .select('*')
      .eq('driver_id', session.user.id)
      .eq('week_start', weekStart)
      .maybeSingle();

    if (data) {
      setExistingRecord(data);
      setAvail({
        sun: data.sun, mon: data.mon, tue: data.tue,
        wed: data.wed, thu: data.thu, fri: data.fri, sat: data.sat,
        sun_done_by: data.sun_done_by ?? '',
        mon_done_by: data.mon_done_by ?? '',
        tue_done_by: data.tue_done_by ?? '',
        wed_done_by: data.wed_done_by ?? '',
        thu_done_by: data.thu_done_by ?? '',
        fri_done_by: data.fri_done_by ?? '',
        sat_done_by: data.sat_done_by ?? '',
      });
    } else {
      setExistingRecord(null);
      setAvail(emptyAvail);
    }
    setLoading(false);
  }

  async function handleSave() {
    if (isAmend && !reason.trim()) return;
    setSaving(true);

    const payload = {
      driver_id: session.user.id,
      week_start: weekStart,
      ...avail,
      updated_after_saturday: isAfterSat
        ? true
        : (existingRecord?.updated_after_saturday ?? false),
      update_reason: isAfterSat
        ? reason.trim()
        : (existingRecord?.update_reason ?? null),
    };

    // Null out done_by for unchecked days
    DAYS.forEach(d => {
      if (!avail[d]) payload[`${d}_done_by`] = null;
    });

    await supabase
      .from('availability')
      .upsert(payload, { onConflict: 'driver_id,week_start' });

    setSaving(false);
    setSaved(true);
    setReason('');
    await load();
    setTimeout(() => setSaved(false), 3000);
  }

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={s.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
    <ScrollView contentContainerStyle={[s.content, { maxWidth: 500, alignSelf: 'center', width: '100%' }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      {/* Header */}
      <View style={{ marginBottom: spacing.xxxl, alignItems: 'center' }}>
        <Text style={s.heading}>AVAILABILITY</Text>
        <Text style={s.subheading}>Select the days you're available{'\n'}for trips this week</Text>
        <Text style={[s.subheading, { marginBottom: 0, fontSize: 11, color: colors.textTertiary }]}>{getNextWeekLabel()}</Text>
      </View>

      {/* Already submitted banner */}
      {existingRecord && (
        <View style={s.submittedBanner}>
          <Text style={s.submittedText}>
            ✓ Submitted on{' '}
            {new Date(existingRecord.submitted_at ?? existingRecord.updated_at).toLocaleDateString('en-US', {
              weekday: 'long', month: 'short', day: 'numeric',
            })}
          </Text>
          {existingRecord.updated_after_saturday && (
            <Text style={s.amendedText}>
              ⚠ Amended — Reason: "{existingRecord.update_reason}"
            </Text>
          )}
        </View>
      )}

      {/* Amendment warning */}
      {isAmend && (
        <View style={s.warningBanner}>
          <Text style={s.warningText}>
            ⚠ You are updating your availability after Saturday. Your manager will be notified and you must provide a reason below.
          </Text>
        </View>
      )}

      {/* Day rows */}
      <View style={s.daysContainer}>
        {DAYS.map((day, i) => (
          <View key={day} style={s.dayRow}>
            <View style={s.dayLeft}>
              <Switch
                value={avail[day]}
                onValueChange={val => setAvail(a => ({ ...a, [day]: val }))}
                trackColor={{ false: colors.surfaceBorder, true: colors.primaryBorder }}
                thumbColor={avail[day] ? colors.primary : colors.textMuted}
              />
              <Text style={[s.dayLabel, avail[day] && s.dayLabelActive]}>
                {DAY_LABELS[i]}
              </Text>
            </View>
            {avail[day] && (
              <View style={s.doneByRow}>
                <Text style={s.doneByLabel}>Done by</Text>
                <TextInput
                  style={s.timeInput}
                  value={avail[`${day}_done_by`]}
                  onChangeText={val => setAvail(a => ({ ...a, [`${day}_done_by`]: val }))}
                  placeholder="e.g. 3:00 PM"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="default"
                />
              </View>
            )}
          </View>
        ))}
      </View>

      {/* Amendment reason */}
      {isAmend && (
        <View style={s.field}>
          <Text style={s.fieldLabel}>REASON FOR CHANGE <Text style={s.required}>*</Text></Text>
          <TextInput
            style={s.input}
            value={reason}
            onChangeText={setReason}
            placeholder="e.g. Doctor appointment on Monday"
            placeholderTextColor={colors.textMuted}
          />
        </View>
      )}

      {/* Save button */}
      <TouchableOpacity
        style={[s.saveBtn, (saving || (isAmend && !reason.trim())) && s.saveBtnDisabled]}
        onPress={handleSave}
        disabled={saving || (isAmend && !reason.trim())}
      >
        <Text style={s.saveBtnText}>
          {saving
            ? 'SAVING...'
            : existingRecord
              ? 'UPDATE AVAILABILITY'
              : 'SUBMIT AVAILABILITY'}
        </Text>
      </TouchableOpacity>

      {saved && (
        <View style={s.successToast}>
          <Text style={s.successText}>
            ✓ Availability {isAmend ? 'updated' : 'submitted'}!
          </Text>
        </View>
      )}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { ...components.screen },
  content: { padding: spacing.xl, paddingTop: 80, paddingBottom: 100 },
  center: { ...components.center },

  heading: { ...typography.displaySm, color: colors.textPrimary, letterSpacing: 2, marginBottom: spacing.sm, textAlign: 'center' },
  subheading: { ...typography.bodySm, color: colors.textSecondary, marginBottom: spacing.xxxl, textAlign: 'center' },

  submittedBanner: {
    backgroundColor: colors.successDim,
    borderWidth: 1, borderColor: colors.successBorder,
    borderRadius: radius.sm,
    padding: spacing.md, marginBottom: spacing.lg,
  },
  submittedText: { ...typography.caption, color: colors.success, fontWeight: '600' },
  amendedText: { ...typography.captionSm, color: colors.primary, marginTop: spacing.xs },

  warningBanner: {
    backgroundColor: colors.primaryDim,
    borderWidth: 1, borderColor: colors.primaryBorder,
    borderRadius: radius.sm,
    padding: spacing.md, marginBottom: spacing.lg,
  },
  warningText: { ...typography.caption, color: colors.primary, lineHeight: 18 },

  daysContainer: {
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md,
    marginBottom: spacing.xl,
  },
  dayRow: {
    borderBottomWidth: 1, borderBottomColor: colors.surfaceBorder,
    padding: spacing.lg, minHeight: 56,
  },
  dayLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  dayLabel: { ...typography.h3, color: colors.textPrimary, fontWeight: '600', letterSpacing: 0.5 },
  dayLabelActive: { color: colors.textPrimary },

  doneByRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: spacing.md, marginTop: spacing.md, marginLeft: 52,
  },
  doneByLabel: { ...typography.captionSm, color: colors.textTertiary },
  timeInput: {
    flex: 1, backgroundColor: colors.bg,
    borderWidth: 1, borderColor: colors.borderLight,
    borderRadius: radius.sm,
    color: colors.textPrimary, padding: spacing.sm, fontSize: 13,
  },

  field: { marginBottom: spacing.lg },
  fieldLabel: { ...typography.label, fontSize: 10, color: colors.textTertiary, letterSpacing: 2, marginBottom: spacing.sm },
  required: { color: colors.error },
  input: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderLight,
    borderRadius: radius.sm,
    color: colors.textPrimary, padding: spacing.md, fontSize: 14,
  },

  saveBtn: {
    backgroundColor: colors.primary, padding: 18,
    alignItems: 'center', marginTop: spacing.xxxl, marginBottom: spacing.lg,
    borderRadius: radius.md,
  },
  saveBtnDisabled: { ...components.buttonDisabled },
  saveBtnText: { color: colors.bg, fontWeight: '900', fontSize: 16, letterSpacing: 2 },

  successToast: {
    backgroundColor: colors.successDim,
    borderWidth: 1, borderColor: colors.success,
    borderRadius: radius.sm,
    padding: spacing.md, alignItems: 'center',
  },
  successText: { ...typography.bodySm, color: colors.success, fontWeight: '600' },
});