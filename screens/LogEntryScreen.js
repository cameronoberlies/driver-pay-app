import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Switch, ActivityIndicator, Alert,
} from 'react-native';
import { supabase } from '../lib/supabase';

export default function LogEntryScreen() {
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

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

  useEffect(() => {
    supabase.from('profiles').select('*').eq('role', 'driver').then(({ data }) => {
      const list = data ?? [];
      setDrivers(list);
      if (list.length > 0) set('driver_id', list[0].id);
      setLoading(false);
    });
  }, []);

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

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">

      <Text style={s.label}>DRIVER</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
        {drivers.map(d => (
          <TouchableOpacity
            key={d.id}
            style={[s.pill, form.driver_id === d.id && s.pillActive]}
            onPress={() => set('driver_id', d.id)}
          >
            <Text style={[s.pillText, form.driver_id === d.id && s.pillTextActive]}>{d.name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Text style={s.label}>DATE</Text>
      <TextInput style={s.input} value={form.date} onChangeText={v => set('date', v)} placeholder="YYYY-MM-DD" placeholderTextColor="#333" />

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
      <TextInput style={s.input} value={form.city} onChangeText={v => set('city', v)} placeholder="Charlotte" placeholderTextColor="#333" autoCapitalize="words" />

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
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center' },
  label: { fontSize: 10, color: '#555', letterSpacing: 2, fontWeight: '700', marginBottom: 6, marginTop: 14 },
  input: { backgroundColor: '#111', borderWidth: 1, borderColor: '#1e1e1e', color: '#fff', paddingHorizontal: 14, paddingVertical: 12, fontSize: 14 },
  row: { flexDirection: 'row', gap: 10 },
  half: { flex: 1 },
  pill: { borderWidth: 1, borderColor: '#1e1e1e', paddingHorizontal: 14, paddingVertical: 8, marginRight: 8, backgroundColor: '#111' },
  pillActive: { borderColor: '#f5a623', backgroundColor: 'rgba(245,166,35,0.1)' },
  pillText: { fontSize: 12, color: '#555', fontWeight: '700' },
  pillTextActive: { color: '#f5a623' },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 20 },
  switchLabel: { fontSize: 11, color: '#555', letterSpacing: 2, fontWeight: '700' },
  saveBtn: { backgroundColor: '#f5a623', padding: 16, alignItems: 'center', marginTop: 24 },
  saveBtnDim: { opacity: 0.5 },
  saveBtnText: { color: '#0a0a0a', fontWeight: '900', fontSize: 14, letterSpacing: 2 },
  success: { backgroundColor: 'rgba(74,232,133,0.1)', borderWidth: 1, borderColor: '#4ae885', padding: 12, marginTop: 12, alignItems: 'center' },
  successText: { color: '#4ae885', fontWeight: '700' },
});