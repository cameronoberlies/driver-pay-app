import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Switch, ActivityIndicator, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { colors, spacing, radius, typography, components } from '../lib/theme';
import CityAutocomplete from '../components/CityAutocomplete';
import useResponsive from '../lib/useResponsive';
import DateTimePicker from '@react-native-community/datetimepicker';

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${m}/${d}/${y}`;
}

const TIMEOUT_MS = 8000;
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

function PendingRow({ entry, driverName, driverWillingToFly, onComplete, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    pay: '',
    hours: '',
    actual_cost: String(entry.actual_cost ?? ''),
    estimated_cost: String(entry.estimated_cost ?? ''),
    crm_id: '',
    recon_missed: entry.recon_missed ?? false,
  });

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function handleComplete() {
    if (!form.pay || !form.crm_id) {
      Alert.alert('Missing Fields', 'Pay and Carpage ID are required.');
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.from('entries').update({
      pay: Number(form.pay),
      hours: form.hours ? Number(form.hours) : null,
      actual_cost: form.actual_cost ? Number(form.actual_cost) : 0,
      estimated_cost: form.estimated_cost ? Number(form.estimated_cost) : 0,
      crm_id: form.crm_id.trim(),
      recon_missed: form.recon_missed,
    }).eq('id', entry.id).select().single();
    setSaving(false);
    if (error) { Alert.alert('Failed', error.message); return; }
    onComplete(data);
  }

  return (
    <View style={p.card}>
      <TouchableOpacity style={p.cardHeader} onPress={() => setExpanded(x => !x)}>
        <View style={p.cardLeft}>
          <Text style={p.cardName}>
            {driverName}
            {driverWillingToFly && <Text style={p.flyBadge}> (F)</Text>}
          </Text>
          <Text style={p.cardMeta}>
            {formatDate(entry.date)}
            {entry.city ? `  ·  ${entry.city}` : ''}
            {entry.miles > 0 ? `  ·  ${entry.miles} mi` : ''}
            {entry.drive_time > 0 ? `  ·  ${entry.drive_time}h GPS` : ''}
          </Text>
        </View>
        <Text style={p.chevron}>{expanded ? '▲' : '▼'}</Text>
      </TouchableOpacity>

      {expanded && (
        <View style={p.form}>
          <View style={p.row}>
            <View style={p.half}>
              <Text style={p.label}>PAY ($) *</Text>
              <TextInput style={p.input} value={form.pay} onChangeText={v => set('pay', v)} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={colors.textMuted} />
            </View>
            <View style={p.half}>
              <Text style={p.label}>HOURS WORKED</Text>
              <TextInput style={p.input} value={form.hours} onChangeText={v => set('hours', v)} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.textMuted} />
            </View>
          </View>
          <View style={p.row}>
            <View style={p.half}>
              <Text style={p.label}>ACTUAL COST ($)</Text>
              <TextInput style={p.input} value={form.actual_cost} onChangeText={v => set('actual_cost', v)} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={colors.textMuted} />
            </View>
            <View style={p.half}>
              <Text style={p.label}>ESTIMATED COST ($)</Text>
              <TextInput style={p.input} value={form.estimated_cost} onChangeText={v => set('estimated_cost', v)} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={colors.textMuted} />
            </View>
          </View>
          <Text style={p.label}>CARPAGE ID *</Text>
          <TextInput style={p.input} value={form.crm_id} onChangeText={v => set('crm_id', v.toUpperCase())} placeholder="CP-XXXX" placeholderTextColor={colors.textMuted} autoCapitalize="characters" />

          <View style={p.switchRow}>
            <Text style={[p.switchLabel, form.recon_missed && { color: colors.error }]}>RECON MISSED</Text>
            <Switch
              value={form.recon_missed}
              onValueChange={v => set('recon_missed', v)}
              trackColor={{ false: colors.surfaceBorder, true: colors.errorDim }}
              thumbColor={form.recon_missed ? colors.error : colors.textMuted}
            />
          </View>

          <TouchableOpacity
            style={[p.completeBtn, (saving || !form.pay || !form.crm_id) && p.completeBtnDim]}
            onPress={handleComplete}
            disabled={saving || !form.pay || !form.crm_id}
          >
            {saving ? <ActivityIndicator color={colors.textPrimary} /> : <Text style={p.completeBtnText}>COMPLETE ENTRY →</Text>}
          </TouchableOpacity>

          <TouchableOpacity
            style={p.deleteBtn}
            onPress={() => {
              Alert.alert(
                'Delete Entry',
                `Delete this pending entry for ${driverName}? This cannot be undone.`,
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: () => onDelete(entry.id) },
                ]
              );
            }}
          >
            <Text style={p.deleteBtnText}>DELETE ENTRY</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

export default function LogEntryScreen() {
  const { isTablet } = useResponsive();
  const [drivers, setDrivers] = useState([]);
  const [pending, setPending] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    driver_id: '',
    date: today,
    pay: '',
    hours: '',
    miles: '',
    actual_cost: '',
    estimated_cost: '',
    city: '',
    crm_id: '',
    recon_missed: false,
  });

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); }

  async function load() {
    setError(false);
    try {
      const [{ data: profs }, { data: entries }] = await withTimeout(
        Promise.all([
          supabase.from('profiles').select('*').eq('role', 'driver'),
          supabase.from('entries').select('*').or('crm_id.is.null,crm_id.eq.').gt('miles', 0),
        ]),
        TIMEOUT_MS
      );
      const list = profs ?? [];
      setDrivers(list);
      setProfiles(list);
      setPending(entries ?? []);
      if (list.length > 0) set('driver_id', list[0].id);
    } catch (err) {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function handlePendingComplete(updated) {
    setPending(prev => prev.filter(e => e.id !== updated.id));
  }

  async function handlePendingDelete(entryId) {
    const { error } = await supabase.from('entries').delete().eq('id', entryId);
    if (error) {
      Alert.alert('Failed', error.message);
      return;
    }
    setPending(prev => prev.filter(e => e.id !== entryId));
  }

  async function handleSave() {
    if (!form.driver_id || !form.pay || !form.city || !form.crm_id) {
      Alert.alert('Missing Fields', 'Driver, pay, city, and CRM ID are required.');
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('entries').insert({
      driver_id: form.driver_id,
      date: form.date,
      pay: Number(form.pay),
      hours: form.hours ? Number(form.hours) : null,
      miles: form.miles ? Number(form.miles) : 0,
      actual_cost: form.actual_cost ? Number(form.actual_cost) : 0,
      estimated_cost: form.estimated_cost ? Number(form.estimated_cost) : 0,
      city: form.city.trim(),
      crm_id: form.crm_id.trim(),
      recon_missed: form.recon_missed,
    });
    setSaving(false);
    if (error) { Alert.alert('Save Failed', error.message); return; }
    setSaved(true);
    setForm(f => ({ ...f, pay: '', hours: '', miles: '', actual_cost: '', estimated_cost: '', city: '', crm_id: '', recon_missed: false }));
    setTimeout(() => setSaved(false), 3000);
  }

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
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={100}>
    <ScrollView style={s.container} contentContainerStyle={[s.content, isTablet && { alignSelf: 'center', maxWidth: 700, width: '100%' }]} keyboardShouldPersistTaps="handled">

      {pending.length > 0 && (
        <View style={s.pendingSection}>
          <View style={s.pendingHeader}>
            <Text style={s.pendingTitle}>PENDING SUBMISSIONS</Text>
            <View style={s.pendingBadge}>
              <Text style={s.pendingBadgeText}>{pending.length}</Text>
            </View>
          </View>
          <Text style={s.pendingSubtitle}>Driver-submitted trips — tap to complete</Text>
          {pending.map(e => (
            <PendingRow
              key={e.id}
              entry={e}
              driverName={profiles.find(p => p.id === e.driver_id)?.name ?? 'Unknown'}
              driverWillingToFly={profiles.find(p => p.id === e.driver_id)?.willing_to_fly ?? false}
              onComplete={handlePendingComplete}
              onDelete={handlePendingDelete}
            />
          ))}
          <View style={s.divider} />
        </View>
      )}

      <Text style={s.sectionTitle}>NEW MANUAL ENTRY</Text>
      <Text style={s.sectionSub}>For trips not tracked via the app</Text>

      <Text style={s.label}>DRIVER</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.xs }}>
        {drivers.map(d => (
          <TouchableOpacity
            key={d.id}
            style={[s.pill, form.driver_id === d.id && s.pillActive]}
            onPress={() => set('driver_id', d.id)}
          >
            <Text style={[s.pillText, form.driver_id === d.id && s.pillTextActive]}>
              {d.name}
              {d.willing_to_fly && <Text style={s.flyBadge}> (F)</Text>}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Text style={s.label}>DATE</Text>
      <TouchableOpacity style={s.input} onPress={() => setShowDatePicker(true)}>
        <Text style={{ color: colors.textPrimary, fontSize: 14 }}>
          {new Date(form.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </Text>
      </TouchableOpacity>
      {showDatePicker && (
        <View>
          <DateTimePicker
            value={new Date(form.date + 'T12:00:00')}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            themeVariant="dark"
            textColor="#fff"
            onChange={(event, selectedDate) => {
              if (Platform.OS === 'android') setShowDatePicker(false);
              if (selectedDate) {
                const y = selectedDate.getFullYear();
                const m = String(selectedDate.getMonth() + 1).padStart(2, '0');
                const d = String(selectedDate.getDate()).padStart(2, '0');
                set('date', `${y}-${m}-${d}`);
              }
            }}
          />
          {Platform.OS === 'ios' && (
            <TouchableOpacity style={s.pickerDone} onPress={() => setShowDatePicker(false)}>
              <Text style={s.pickerDoneText}>Done</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <View style={s.row}>
        <View style={s.half}>
          <Text style={s.label}>PAY ($)</Text>
          <TextInput style={s.input} value={form.pay} onChangeText={v => set('pay', v)} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={colors.textMuted} />
        </View>
        <View style={s.half}>
          <Text style={s.label}>HOURS WORKED</Text>
          <TextInput style={s.input} value={form.hours} onChangeText={v => set('hours', v)} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.textMuted} />
        </View>
      </View>

      <View style={s.row}>
        <View style={s.half}>
          <Text style={s.label}>MILES</Text>
          <TextInput style={s.input} value={form.miles} onChangeText={v => set('miles', v)} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.textMuted} />
        </View>
        <View style={s.half}>
          <Text style={s.label}>ACTUAL COST ($)</Text>
          <TextInput style={s.input} value={form.actual_cost} onChangeText={v => set('actual_cost', v)} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={colors.textMuted} />
        </View>
      </View>

      <Text style={s.label}>ESTIMATED COST ($)</Text>
      <TextInput style={s.input} value={form.estimated_cost} onChangeText={v => set('estimated_cost', v)} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={colors.textMuted} />

      <Text style={s.label}>CITY</Text>
      <CityAutocomplete style={s.input} value={form.city} onChangeText={v => set('city', v)} placeholder="Charlotte" placeholderTextColor={colors.textMuted} />

      <Text style={s.label}>CARPAGE ID</Text>
      <TextInput style={s.input} value={form.crm_id} onChangeText={v => set('crm_id', v.toUpperCase())} placeholder="CP-XXXX" placeholderTextColor={colors.textMuted} autoCapitalize="characters" />

      <View style={s.switchRow}>
        <Text style={[s.switchLabel, form.recon_missed && { color: colors.error }]}>RECON MISSED</Text>
        <Switch
          value={form.recon_missed}
          onValueChange={v => set('recon_missed', v)}
          trackColor={{ false: colors.surfaceBorder, true: colors.errorDim }}
          thumbColor={form.recon_missed ? colors.error : colors.textMuted}
        />
      </View>

      <TouchableOpacity style={[s.saveBtn, saving && s.saveBtnDim]} onPress={handleSave} disabled={saving}>
        {saving ? <ActivityIndicator color={colors.bg} /> : <Text style={s.saveBtnText}>SAVE ENTRY →</Text>}
      </TouchableOpacity>

      {saved && (
        <View style={s.success}>
          <Text style={s.successText}>✓ Entry saved</Text>
        </View>
      )}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl, paddingTop: spacing.xl, paddingBottom: 300 },
  center: { ...components.center },
  pendingSection: { marginBottom: spacing.sm },
  pendingHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.xs },
  pendingTitle: { ...typography.labelSm, fontSize: 10, color: colors.primary, letterSpacing: 2 },
  pendingBadge: { backgroundColor: colors.primaryDim, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 1 },
  pendingBadgeText: { ...typography.captionSm, color: colors.primary, fontWeight: '800' },
  pendingSubtitle: { ...typography.captionSm, color: colors.textTertiary, marginBottom: spacing.md },
  divider: { height: 1, backgroundColor: colors.surfaceBorder, marginTop: spacing.xl, marginBottom: spacing.xl },
  sectionTitle: { ...typography.labelSm, fontSize: 10, color: colors.textTertiary, letterSpacing: 2, marginBottom: 2 },
  sectionSub: { ...typography.captionSm, color: colors.textMuted, marginBottom: spacing.sm },
  label: { ...typography.labelSm, fontSize: 10, color: colors.textTertiary, letterSpacing: 2, marginBottom: radius.sm, marginTop: spacing.lg },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, color: colors.textPrimary, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontSize: 14 },
  row: { flexDirection: 'row', gap: spacing.md },
  half: { flex: 1 },
  pill: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, marginRight: spacing.sm, backgroundColor: colors.surface },
  pillActive: { borderColor: colors.primary, backgroundColor: colors.primaryDim },
  pillText: { ...typography.caption, fontSize: 12, color: colors.textTertiary, fontWeight: '700' },
  pillTextActive: { color: colors.primary },
  flyBadge: { fontSize: 12, fontWeight: '700', color: colors.primary },
  pickerDone: { alignSelf: 'center', paddingVertical: spacing.md, paddingHorizontal: spacing.xxxl, backgroundColor: colors.primary, borderRadius: radius.sm, marginTop: spacing.sm, marginBottom: spacing.md },
  pickerDoneText: { fontSize: 14, fontWeight: '700', color: colors.bg },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.xl },
  switchLabel: { ...typography.captionSm, color: colors.textTertiary, letterSpacing: 2, fontWeight: '700' },
  saveBtn: { ...components.buttonPrimary, marginTop: spacing.xxl },
  saveBtnDim: { ...components.buttonDisabled },
  saveBtnText: { ...components.buttonPrimaryText, letterSpacing: 2 },
  success: { backgroundColor: colors.successDim, borderWidth: 1, borderColor: colors.success, borderRadius: radius.sm, padding: spacing.md, marginTop: spacing.md, alignItems: 'center' },
  successText: { color: colors.success, fontWeight: '700' },
  errorText: { ...components.errorText },
  retryBtn: { ...components.retryBtn },
  retryText: { ...components.retryText },
});

const p = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderLeftWidth: 3, borderLeftColor: colors.info, borderRadius: radius.md, marginBottom: spacing.md },
  cardHeader: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg },
  cardLeft: { flex: 1 },
  cardName: { ...typography.body, fontWeight: '800', color: colors.textPrimary, marginBottom: 3 },
  flyBadge: { fontSize: 12, fontWeight: '700', color: colors.primary },
  cardMeta: { ...typography.captionSm, color: colors.textTertiary },
  chevron: { fontSize: 12, color: colors.primary, marginLeft: spacing.md },
  form: { padding: spacing.lg, paddingTop: 0, borderTopWidth: 1, borderTopColor: colors.border },
  row: { flexDirection: 'row', gap: spacing.md },
  half: { flex: 1 },
  label: { ...typography.labelSm, fontSize: 10, color: colors.textTertiary, letterSpacing: 2, marginBottom: radius.sm, marginTop: spacing.lg },
  input: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, color: colors.textPrimary, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontSize: 14 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.xl },
  switchLabel: { ...typography.captionSm, color: colors.textTertiary, letterSpacing: 2, fontWeight: '700' },
  completeBtn: { backgroundColor: colors.info, borderRadius: radius.sm, padding: spacing.lg, alignItems: 'center', marginTop: spacing.lg },
  completeBtnDim: { ...components.buttonDisabled },
  completeBtnText: { color: colors.textPrimary, fontWeight: '900', fontSize: 13, letterSpacing: 2 },
  deleteBtn: { borderWidth: 1, borderColor: colors.error, borderRadius: radius.sm, padding: spacing.md, alignItems: 'center', marginTop: spacing.sm },
  deleteBtnText: { ...typography.labelSm, color: colors.error, letterSpacing: 1.5 },
});