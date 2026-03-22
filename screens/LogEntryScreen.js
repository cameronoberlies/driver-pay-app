import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Switch, ActivityIndicator, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { supabase } from '../lib/supabase';
import CityAutocomplete from '../components/CityAutocomplete';
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

function PendingRow({ entry, driverName, driverWillingToFly, onComplete }) {
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
              <TextInput style={p.input} value={form.pay} onChangeText={v => set('pay', v)} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor="#333" />
            </View>
            <View style={p.half}>
              <Text style={p.label}>HOURS WORKED</Text>
              <TextInput style={p.input} value={form.hours} onChangeText={v => set('hours', v)} keyboardType="decimal-pad" placeholder="0" placeholderTextColor="#333" />
            </View>
          </View>
          <View style={p.row}>
            <View style={p.half}>
              <Text style={p.label}>ACTUAL COST ($)</Text>
              <TextInput style={p.input} value={form.actual_cost} onChangeText={v => set('actual_cost', v)} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor="#333" />
            </View>
            <View style={p.half}>
              <Text style={p.label}>ESTIMATED COST ($)</Text>
              <TextInput style={p.input} value={form.estimated_cost} onChangeText={v => set('estimated_cost', v)} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor="#333" />
            </View>
          </View>
          <Text style={p.label}>CARPAGE ID *</Text>
          <TextInput style={p.input} value={form.crm_id} onChangeText={v => set('crm_id', v)} placeholder="CP-XXXX" placeholderTextColor="#333" autoCapitalize="characters" />

          <View style={p.switchRow}>
            <Text style={[p.switchLabel, form.recon_missed && { color: '#e85a4a' }]}>RECON MISSED</Text>
            <Switch
              value={form.recon_missed}
              onValueChange={v => set('recon_missed', v)}
              trackColor={{ false: '#1a1a1a', true: 'rgba(232,90,74,0.4)' }}
              thumbColor={form.recon_missed ? '#e85a4a' : '#333'}
            />
          </View>

          <TouchableOpacity
            style={[p.completeBtn, (saving || !form.pay || !form.crm_id) && p.completeBtnDim]}
            onPress={handleComplete}
            disabled={saving || !form.pay || !form.crm_id}
          >
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={p.completeBtnText}>COMPLETE ENTRY →</Text>}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

export default function LogEntryScreen() {
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
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={100}>
    <ScrollView style={s.container} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">

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
            />
          ))}
          <View style={s.divider} />
        </View>
      )}

      <Text style={s.sectionTitle}>NEW MANUAL ENTRY</Text>
      <Text style={s.sectionSub}>For trips not tracked via the app</Text>

      <Text style={s.label}>DRIVER</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
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
        <Text style={{ color: '#fff', fontSize: 14 }}>
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
          <TextInput style={s.input} value={form.pay} onChangeText={v => set('pay', v)} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor="#333" />
        </View>
        <View style={s.half}>
          <Text style={s.label}>HOURS WORKED</Text>
          <TextInput style={s.input} value={form.hours} onChangeText={v => set('hours', v)} keyboardType="decimal-pad" placeholder="0" placeholderTextColor="#333" />
        </View>
      </View>

      <View style={s.row}>
        <View style={s.half}>
          <Text style={s.label}>MILES</Text>
          <TextInput style={s.input} value={form.miles} onChangeText={v => set('miles', v)} keyboardType="decimal-pad" placeholder="0" placeholderTextColor="#333" />
        </View>
        <View style={s.half}>
          <Text style={s.label}>ACTUAL COST ($)</Text>
          <TextInput style={s.input} value={form.actual_cost} onChangeText={v => set('actual_cost', v)} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor="#333" />
        </View>
      </View>

      <Text style={s.label}>ESTIMATED COST ($)</Text>
      <TextInput style={s.input} value={form.estimated_cost} onChangeText={v => set('estimated_cost', v)} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor="#333" />

      <Text style={s.label}>CITY</Text>
      <CityAutocomplete style={s.input} value={form.city} onChangeText={v => set('city', v)} placeholder="Charlotte" placeholderTextColor="#333" />

      <Text style={s.label}>CARPAGE ID</Text>
      <TextInput style={s.input} value={form.crm_id} onChangeText={v => set('crm_id', v)} placeholder="CP-XXXX" placeholderTextColor="#333" autoCapitalize="characters" />

      <View style={s.switchRow}>
        <Text style={[s.switchLabel, form.recon_missed && { color: '#e85a4a' }]}>RECON MISSED</Text>
        <Switch
          value={form.recon_missed}
          onValueChange={v => set('recon_missed', v)}
          trackColor={{ false: '#1a1a1a', true: 'rgba(232,90,74,0.4)' }}
          thumbColor={form.recon_missed ? '#e85a4a' : '#333'}
        />
      </View>

      <TouchableOpacity style={[s.saveBtn, saving && s.saveBtnDim]} onPress={handleSave} disabled={saving}>
        {saving ? <ActivityIndicator color="#0a0a0a" /> : <Text style={s.saveBtnText}>SAVE ENTRY →</Text>}
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
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 20, paddingTop: 20, paddingBottom: 40 },
  center: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center' },
  pendingSection: { marginBottom: 8 },
  pendingHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  pendingTitle: { fontSize: 10, color: '#f5a623', letterSpacing: 2, fontWeight: '700' },
  pendingBadge: { backgroundColor: 'rgba(245,166,35,0.15)', borderWidth: 1, borderColor: '#f5a623', paddingHorizontal: 7, paddingVertical: 1 },
  pendingBadgeText: { fontSize: 11, color: '#f5a623', fontWeight: '800' },
  pendingSubtitle: { fontSize: 11, color: '#555', marginBottom: 12 },
  divider: { height: 1, backgroundColor: '#1a1a1a', marginTop: 20, marginBottom: 20 },
  sectionTitle: { fontSize: 10, color: '#555', letterSpacing: 2, fontWeight: '700', marginBottom: 2 },
  sectionSub: { fontSize: 11, color: '#333', marginBottom: 8 },
  label: { fontSize: 10, color: '#555', letterSpacing: 2, fontWeight: '700', marginBottom: 6, marginTop: 14 },
  input: { backgroundColor: '#111', borderWidth: 1, borderColor: '#1e1e1e', color: '#fff', paddingHorizontal: 14, paddingVertical: 12, fontSize: 14 },
  row: { flexDirection: 'row', gap: 10 },
  half: { flex: 1 },
  pill: { borderWidth: 1, borderColor: '#1e1e1e', paddingHorizontal: 14, paddingVertical: 8, marginRight: 8, backgroundColor: '#111' },
  pillActive: { borderColor: '#f5a623', backgroundColor: 'rgba(245,166,35,0.1)' },
  pillText: { fontSize: 12, color: '#555', fontWeight: '700' },
  pillTextActive: { color: '#f5a623' },
  flyBadge: { fontSize: 12, fontWeight: '700', color: '#f5a623' },
  pickerDone: { alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 32, backgroundColor: '#f5a623', borderRadius: 6, marginTop: 8, marginBottom: 12 },
  pickerDoneText: { fontSize: 14, fontWeight: '700', color: '#0a0a0a' },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 20 },
  switchLabel: { fontSize: 11, color: '#555', letterSpacing: 2, fontWeight: '700' },
  saveBtn: { backgroundColor: '#f5a623', padding: 16, alignItems: 'center', marginTop: 24 },
  saveBtnDim: { opacity: 0.5 },
  saveBtnText: { color: '#0a0a0a', fontWeight: '900', fontSize: 14, letterSpacing: 2 },
  success: { backgroundColor: 'rgba(74,232,133,0.1)', borderWidth: 1, borderColor: '#4ae885', padding: 12, marginTop: 12, alignItems: 'center' },
  successText: { color: '#4ae885', fontWeight: '700' },
  errorText: { color: '#555', fontSize: 14, marginBottom: 16 },
  retryBtn: { borderWidth: 1, borderColor: '#f5a623', paddingHorizontal: 24, paddingVertical: 10 },
  retryText: { color: '#f5a623', fontSize: 12, letterSpacing: 2, fontWeight: '700' },
});

const p = StyleSheet.create({
  card: { backgroundColor: '#111', borderWidth: 1, borderColor: '#1e1e1e', borderLeftWidth: 3, borderLeftColor: '#3b8cf7', marginBottom: 10 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  cardLeft: { flex: 1 },
  cardName: { fontSize: 14, fontWeight: '800', color: '#fff', marginBottom: 3 },
  flyBadge: { fontSize: 12, fontWeight: '700', color: '#f5a623' },
  cardMeta: { fontSize: 11, color: '#555' },
  chevron: { fontSize: 12, color: '#f5a623', marginLeft: 10 },
  form: { padding: 14, paddingTop: 0, borderTopWidth: 1, borderTopColor: '#1e1e1e' },
  row: { flexDirection: 'row', gap: 10 },
  half: { flex: 1 },
  label: { fontSize: 10, color: '#555', letterSpacing: 2, fontWeight: '700', marginBottom: 6, marginTop: 14 },
  input: { backgroundColor: '#0a0a0a', borderWidth: 1, borderColor: '#1e1e1e', color: '#fff', paddingHorizontal: 14, paddingVertical: 12, fontSize: 14 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 20 },
  switchLabel: { fontSize: 11, color: '#555', letterSpacing: 2, fontWeight: '700' },
  completeBtn: { backgroundColor: '#3b8cf7', padding: 14, alignItems: 'center', marginTop: 16 },
  completeBtnDim: { opacity: 0.4 },
  completeBtnText: { color: '#fff', fontWeight: '900', fontSize: 13, letterSpacing: 2 },
});