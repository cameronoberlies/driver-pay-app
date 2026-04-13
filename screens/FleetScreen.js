import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, RefreshControl,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { colors, spacing, radius, typography } from '../lib/theme';
import useResponsive from '../lib/useResponsive';

export default function FleetScreen() {
  const { isTablet } = useResponsive();
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState('list'); // list | add | detail
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [mileageLog, setMileageLog] = useState([]);
  const [form, setForm] = useState({ stock_number: '', vin: '', year: '', make: '', model: '', current_mileage: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    const { data } = await supabase.from('chase_vehicles').select('*').order('stock_number');
    setVehicles(data || []);
    setLoading(false);
  }

  async function loadMileageLog(vehicleId) {
    const { data } = await supabase
      .from('chase_vehicle_mileage_log')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .order('created_at', { ascending: false })
      .limit(20);
    setMileageLog(data || []);
  }

  function resetForm() {
    setForm({ stock_number: '', vin: '', year: '', make: '', model: '', current_mileage: '', notes: '' });
    setError('');
  }

  async function handleSave() {
    if (!form.stock_number) { setError('Stock number is required'); return; }
    setSaving(true);
    setError('');

    const payload = {
      stock_number: form.stock_number,
      vin: form.vin || null,
      year: form.year ? Number(form.year) : null,
      make: form.make || null,
      model: form.model || null,
      current_mileage: form.current_mileage ? Number(form.current_mileage) : 0,
      notes: form.notes || null,
      updated_at: new Date().toISOString(),
    };

    if (editing && selectedVehicle) {
      const { error: err } = await supabase.from('chase_vehicles').update(payload).eq('id', selectedVehicle.id);
      if (err) { setError(err.message); setSaving(false); return; }
    } else {
      const { error: err } = await supabase.from('chase_vehicles').insert(payload);
      if (err) { setError(err.message); setSaving(false); return; }
    }

    setSaving(false);
    setEditing(false);
    setView('list');
    resetForm();
    load();
  }

  async function handleDelete(vehicle) {
    Alert.alert('Delete Vehicle', `Delete ${vehicle.year} ${vehicle.make} ${vehicle.model}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          await supabase.from('chase_vehicles').delete().eq('id', vehicle.id);
          setView('list');
          setSelectedVehicle(null);
          load();
        },
      },
    ]);
  }

  async function handleStatusChange(vehicle, newStatus) {
    await supabase.from('chase_vehicles').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', vehicle.id);
    load();
    setSelectedVehicle({ ...vehicle, status: newStatus });
  }

  if (loading) return <View style={s.center}><ActivityIndicator color={colors.primary} /></View>;

  // Add/Edit form
  if (view === 'add') {
    return (
      <ScrollView style={s.container} contentContainerStyle={[s.content, isTablet && { maxWidth: 600, alignSelf: 'center', width: '100%' }]} keyboardShouldPersistTaps="handled">
        <Text style={s.title}>{editing ? 'EDIT VEHICLE' : 'ADD VEHICLE'}</Text>

        <Text style={s.label}>STOCK NUMBER *</Text>
        <TextInput style={s.input} value={form.stock_number} onChangeText={(v) => setForm({ ...form, stock_number: v })} placeholder="STK-001" placeholderTextColor={colors.textMuted} />

        <Text style={s.label}>VIN</Text>
        <TextInput style={s.input} value={form.vin} onChangeText={(v) => setForm({ ...form, vin: v })} placeholder="1HGCM82633A004352" placeholderTextColor={colors.textMuted} />

        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>YEAR</Text>
            <TextInput style={s.input} value={form.year} onChangeText={(v) => setForm({ ...form, year: v })} keyboardType="number-pad" placeholder="2024" placeholderTextColor={colors.textMuted} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>MAKE</Text>
            <TextInput style={s.input} value={form.make} onChangeText={(v) => setForm({ ...form, make: v })} placeholder="Toyota" placeholderTextColor={colors.textMuted} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>MODEL</Text>
            <TextInput style={s.input} value={form.model} onChangeText={(v) => setForm({ ...form, model: v })} placeholder="Camry" placeholderTextColor={colors.textMuted} />
          </View>
        </View>

        <Text style={s.label}>CURRENT MILEAGE</Text>
        <TextInput style={s.input} value={form.current_mileage} onChangeText={(v) => setForm({ ...form, current_mileage: v })} keyboardType="decimal-pad" placeholder="45000" placeholderTextColor={colors.textMuted} />

        <Text style={s.label}>NOTES</Text>
        <TextInput style={[s.input, { height: 60 }]} value={form.notes} onChangeText={(v) => setForm({ ...form, notes: v })} placeholder="Any notes..." placeholderTextColor={colors.textMuted} multiline />

        {error ? <Text style={s.errorText}>{error}</Text> : null}

        <TouchableOpacity style={[s.saveBtn, saving && { opacity: 0.5 }]} onPress={handleSave} disabled={saving}>
          <Text style={s.saveBtnText}>{saving ? 'SAVING...' : editing ? 'SAVE CHANGES' : 'ADD VEHICLE'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.cancelBtn} onPress={() => { setView('list'); setEditing(false); resetForm(); }}>
          <Text style={s.cancelBtnText}>CANCEL</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // Vehicle detail view
  if (view === 'detail' && selectedVehicle) {
    const v = selectedVehicle;
    return (
      <ScrollView style={s.container} contentContainerStyle={[s.content, isTablet && { maxWidth: 600, alignSelf: 'center', width: '100%' }]}>
        <TouchableOpacity onPress={() => { setView('list'); setSelectedVehicle(null); }}>
          <Text style={s.backBtn}>← Back</Text>
        </TouchableOpacity>

        <View style={s.detailCard}>
          <Text style={s.detailTitle}>{v.year} {v.make} {v.model}</Text>
          <Text style={s.detailStock}>Stock: {v.stock_number}</Text>
          {v.vin && <Text style={s.detailMeta}>VIN: {v.vin}</Text>}
          <Text style={s.detailMileage}>{Number(v.current_mileage || 0).toLocaleString()} mi</Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
            {['active', 'inactive', 'sold'].map((st) => (
              <TouchableOpacity
                key={st}
                style={[s.statusPill, v.status === st && s.statusPillActive]}
                onPress={() => handleStatusChange(v, st)}
              >
                <Text style={[s.statusPillText, v.status === st && s.statusPillTextActive]}>{st.toUpperCase()}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg }}>
          <TouchableOpacity style={s.editBtn} onPress={() => {
            setForm({
              stock_number: v.stock_number || '',
              vin: v.vin || '',
              year: v.year ? String(v.year) : '',
              make: v.make || '',
              model: v.model || '',
              current_mileage: v.current_mileage ? String(v.current_mileage) : '',
              notes: v.notes || '',
            });
            setEditing(true);
            setView('add');
          }}>
            <Text style={s.editBtnText}>EDIT</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.deleteBtn} onPress={() => handleDelete(v)}>
            <Text style={s.deleteBtnText}>DELETE</Text>
          </TouchableOpacity>
        </View>

        <Text style={s.sectionTitle}>MILEAGE LOG</Text>
        {mileageLog.length === 0 ? (
          <Text style={s.emptyText}>No trips recorded for this vehicle yet.</Text>
        ) : (
          mileageLog.map((log) => (
            <View key={log.id} style={s.logRow}>
              <View>
                <Text style={s.logCity}>{log.trip_city || '—'}</Text>
                <Text style={s.logMeta}>{log.trip_date} · {log.driver_name}</Text>
              </View>
              <Text style={s.logMiles}>+{Number(log.miles_added).toFixed(1)} mi</Text>
            </View>
          ))
        )}
      </ScrollView>
    );
  }

  // List view
  const activeVehicles = vehicles.filter((v) => v.status === 'active');

  return (
    <ScrollView
      style={s.container}
      contentContainerStyle={[s.content, isTablet && { maxWidth: 700, alignSelf: 'center', width: '100%' }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load().then(() => setRefreshing(false)); }} />}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg }}>
        <View>
          <Text style={s.title}>FLEET</Text>
          <Text style={s.subtitle}>{activeVehicles.length} active vehicle{activeVehicles.length !== 1 ? 's' : ''}</Text>
        </View>
        <TouchableOpacity style={s.addBtn} onPress={() => { resetForm(); setView('add'); }}>
          <Text style={s.addBtnText}>+ ADD</Text>
        </TouchableOpacity>
      </View>

      {vehicles.map((v) => (
        <TouchableOpacity
          key={v.id}
          style={[s.vehicleCard, v.status !== 'active' && { opacity: 0.5 }]}
          onPress={() => {
            setSelectedVehicle(v);
            loadMileageLog(v.id);
            setView('detail');
          }}
        >
          <View style={s.vehicleLeft}>
            <Text style={s.vehicleTitle}>{v.year} {v.make} {v.model}</Text>
            <Text style={s.vehicleStock}>Stock: {v.stock_number}</Text>
          </View>
          <View style={s.vehicleRight}>
            <Text style={s.vehicleMileage}>{Number(v.current_mileage || 0).toLocaleString()} mi</Text>
            <Text style={s.vehicleChevron}>›</Text>
          </View>
        </TouchableOpacity>
      ))}

      {vehicles.length === 0 && (
        <View style={{ alignItems: 'center', padding: 40 }}>
          <Text style={{ color: colors.textTertiary }}>No chase vehicles added yet.</Text>
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl, paddingBottom: 100 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
  title: { ...typography.labelSm, fontSize: 10, color: colors.textTertiary, letterSpacing: 2 },
  subtitle: { ...typography.captionSm, color: colors.textMuted, marginTop: 2 },
  addBtn: { backgroundColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  addBtnText: { color: colors.bg, fontWeight: '800', fontSize: 12, letterSpacing: 1 },
  vehicleCard: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderLeftWidth: 3, borderLeftColor: colors.primary,
    borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.md, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  vehicleLeft: { flex: 1 },
  vehicleTitle: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
  vehicleStock: { fontSize: 12, color: colors.textTertiary, marginTop: 2, fontFamily: 'monospace' },
  vehicleRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  vehicleMileage: { fontSize: 16, fontWeight: '700', color: colors.primary },
  vehicleChevron: { fontSize: 18, color: colors.textTertiary },
  backBtn: { color: colors.primary, fontSize: 14, fontWeight: '700', marginBottom: spacing.lg },
  detailCard: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, padding: spacing.xl, marginBottom: spacing.lg,
  },
  detailTitle: { fontSize: 20, fontWeight: '800', color: colors.textPrimary, marginBottom: 4 },
  detailStock: { fontSize: 13, color: colors.primary, fontWeight: '700', fontFamily: 'monospace' },
  detailMeta: { fontSize: 12, color: colors.textTertiary, marginTop: 4 },
  detailMileage: { fontSize: 28, fontWeight: '900', color: colors.primary, marginTop: spacing.md },
  statusPill: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  statusPillActive: { borderColor: colors.primary, backgroundColor: 'rgba(245,166,35,0.1)' },
  statusPillText: { fontSize: 10, fontWeight: '700', color: colors.textTertiary, letterSpacing: 1 },
  statusPillTextActive: { color: colors.primary },
  editBtn: { backgroundColor: 'rgba(245,166,35,0.1)', borderWidth: 1, borderColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  editBtnText: { color: colors.primary, fontWeight: '700', fontSize: 11, letterSpacing: 1 },
  deleteBtn: { backgroundColor: 'rgba(232,90,74,0.1)', borderWidth: 1, borderColor: colors.error, borderRadius: radius.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  deleteBtnText: { color: colors.error, fontWeight: '700', fontSize: 11, letterSpacing: 1 },
  sectionTitle: { ...typography.labelSm, fontSize: 10, color: colors.textTertiary, letterSpacing: 2, marginBottom: spacing.md },
  emptyText: { color: colors.textMuted, fontSize: 13 },
  logRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  logCity: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  logMeta: { fontSize: 11, color: colors.textTertiary, marginTop: 2 },
  logMiles: { fontSize: 14, fontWeight: '700', color: colors.primary },
  label: { ...typography.labelSm, fontSize: 10, color: colors.textTertiary, letterSpacing: 2, marginBottom: radius.sm, marginTop: spacing.lg },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, color: colors.textPrimary, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontSize: 14 },
  errorText: { color: colors.error, fontSize: 13, marginTop: spacing.md },
  saveBtn: { backgroundColor: colors.primary, borderRadius: radius.sm, padding: spacing.lg, alignItems: 'center', marginTop: spacing.xl },
  saveBtnText: { color: colors.bg, fontWeight: '900', fontSize: 13, letterSpacing: 2 },
  cancelBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.md, alignItems: 'center', marginTop: spacing.sm },
  cancelBtnText: { color: colors.textTertiary, fontWeight: '700', fontSize: 12, letterSpacing: 1 },
});
