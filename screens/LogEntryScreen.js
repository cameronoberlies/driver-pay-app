import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, TextInput, Switch, ActivityIndicator,
} from 'react-native';
import { supabase } from '../lib/supabase';

export default function LogEntryScreen({ session }) {
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

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('profiles').select('*').eq('role', 'driver');
      const driverList = data ?? [];
      setDrivers(driverList);
      if (driverList.length > 0) setForm(f => ({ ...f, driver_id: driverList[0].id }));
      setLoading(false);
    }
    load();
  }, []);

  async function handleSave() {
    if (!form.pay || !form.hours || !form.city || !form.crm_id || !form.driver_id) return;
    setSaving(true);
    const { error } = await supabase.from('entries').insert({
      driver_id: form.driver_id,
      date: form.date,
      pay: Number(form.pay),
      hours: Number(form.hours),
      miles: form.miles ? Number(form.miles) : 0,
      actual_cost: form.actual_cost ? Number(form.actual_cost) : 0,
      estimated_cost: form.estimated_cost ? Number(form.estimated_cost) : 0,
      city: form.city,
      crm_id: form.crm_id,
      recon_missed: form.recon_missed,
    });
    setSaving(false);
    if (!error) {
      setSaved(true);
      setForm(f => ({ ...f, pay: '', hours: '', miles: '', actual_cost: '', estimated_cost: '', city: '', crm_id: '', recon_missed: false }));
      setTimeout(() => setSaved(false), 3000);
    }
  }

  if (loading) return <View style={styles.center}><ActivityIndicator color="#f5a623" /></View>;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>LOG ENTRY</Text>

      {/* Driver picker */}
      <Text style={styles.label}>DRIVER</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pickerRow}>
        {drivers.map(d => (
          <TouchableOpacity
            key={d.id}
            style={[styles.pickerBtn, form.driver_id === d.id && styles.pickerBtnActive]}
            onPress={() => setForm(f => ({ ...f, driver_id: d.id }))}
          >
            <Text style={[styles.pickerBtnText, form.driver_id === d.id && styles.pickerBtnTextActive]}>
              {d.name}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Date */}
      <Text style={styles.label}>DATE</Text>
      <TextInput
        style={styles.input}
        value={form.date}
        onChangeText={v => setForm(f => ({ ...f, date: v }))}
        placeholder="YYYY-MM-DD"
        placeholderTextColor="#333"
      />

      {/* Pay + Hours */}
      <View style={styles.row}>
        <View style={styles.halfField}>
          <Text style={styles.label}>PAY ($)</Text>
          <TextInput style={styles.input} value={form.pay} onChangeText={v => setForm(f => ({ ...f, pay: v }))} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor="#333" />
        </View>
        <View style={styles.halfField}>
          <Text style={styles.label}>HOURS WORKED</Text>
          <TextInput style={styles.input} value={form.hours} onChangeText={v => setForm(f => ({ ...f, hours: v }))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor="#333" />
        </View>
      </View>

      {/* Miles + Actual Cost */}
      <View style={styles.row}>
        <View style={styles.halfField}>
          <Text style={styles.label}>MILES</Text>
          <TextInput style={styles.input} value={form.miles} onChangeText={v => setForm(f => ({ ...f, miles: v }))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor="#333" />
        </View>
        <View style={styles.halfField}>
          <Text style={styles.label}>ACTUAL COST ($)</Text>
          <TextInput style={styles.input} value={form.actual_cost} onChangeText={v => setForm(f => ({ ...f, actual_cost: v }))} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor="#333" />
        </View>
      </View>

      {/* Estimated Cost */}
      <Text style={styles.label}>ESTIMATED COST ($)</Text>
      <TextInput style={styles.input} value={form.estimated_cost} onChangeText={v => setForm(f => ({ ...f, estimated_cost: v }))} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor="#333" />

      {/* City */}
      <Text style={styles.label}>CITY</Text>
      <TextInput style={styles.input} value={form.city} onChangeText={v => setForm(f => ({ ...f, city: v }))} placeholder="Charlotte" placeholderTextColor="#333" autoCapitalize="words" />

      {/* CRM ID */}
      <Text style={styles.label}>CARPAGE ID</Text>
      <TextInput style={styles.input} value={form.crm_id} onChangeText={v => setForm(f => ({ ...f, crm_id: v }))} placeholder="CP-XXXX" placeholderTextColor="#333" autoCapitalize="characters" />

      {/* Recon missed */}
      <View style={styles.switchRow}>
        <Text style={[styles.switchLabel, form.recon_missed && { color: '#e85a4a' }]}>RECON MISSED</Text>
        <Switch
          value={form.recon_missed}
          onValueChange={v => setForm(f => ({ ...f, recon_missed: v }))}
          trackColor={{ false: '#1a1a1a', true: 'rgba(232,90,74,0.4)' }}
          thumbColor={form.recon_missed ? '#e85a4a' : '#333'}
        />
      </View>

      {/* Save button */}
      <TouchableOpacity
        style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
        onPress={handleSave}
        disabled={saving}
      >
        {saving
          ? <ActivityIndicator color="#0a0a0a" />
          : <Text style={styles.saveBtnText}>SAVE ENTRY →</Text>
        }
      </TouchableOpacity>

      {saved && (
        <View style={styles.successBanner}>
          <Text style={styles.successText}>✓ Entry saved</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 20, paddingTop: 60, paddingBottom: 40 },
  center: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 24, fontWeight: '900', color: '#fff', letterSpacing: 2, marginBottom: 24 },
  label: { fontSize: 10, color: '#555', letterSpacing: 2, fontWeight: '700', marginBottom: 6, marginTop: 14 },
  input: {
    backgroundColor: '#111', borderWidth: 1, borderColor: '#1e1e1e',
    color: '#fff', paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 14,
  },
  row: { flexDirection: 'row', gap: 10 },
  halfField: { flex: 1 },
  pickerRow: { flexDirection: 'row', marginBottom: 4 },
  pickerBtn: {
    borderWidth: 1, borderColor: '#1e1e1e', paddingHorizontal: 14, paddingVertical: 8,
    marginRight: 8, backgroundColor: '#111',
  },
  pickerBtnActive: { borderColor: '#f5a623', backgroundColor: 'rgba(245,166,35,0.1)' },
  pickerBtnText: { fontSize: 12, color: '#555', fontWeight: '700' },
  pickerBtnTextActive: { color: '#f5a623' },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, marginBottom: 4 },
  switchLabel: { fontSize: 11, color: '#555', letterSpacing: 2, fontWeight: '700' },
  saveBtn: { backgroundColor: '#f5a623', padding: 16, alignItems: 'center', marginTop: 24 },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: '#0a0a0a', fontWeight: '900', fontSize: 14, letterSpacing: 2 },
  successBanner: { backgroundColor: 'rgba(74,232,133,0.1)', borderWidth: 1, borderColor: '#4ae885', padding: 12, marginTop: 12, alignItems: 'center' },
  successText: { color: '#4ae885', fontWeight: '700', fontSize: 13 },
});