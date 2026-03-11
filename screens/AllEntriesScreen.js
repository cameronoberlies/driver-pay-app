import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, RefreshControl, ActivityIndicator,
} from 'react-native';
import { supabase } from '../lib/supabase';

function fmtDate(d) { const [y,m,day] = d.split('-'); return `${m}/${day}/${y}`; }
function fmtMoney(n) { return '$' + Number(n||0).toLocaleString('en-US', { minimumFractionDigits: 2 }); }

export default function AllEntriesScreen() {
  const [entries, setEntries] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [filterDriver, setFilterDriver] = useState('all');

  async function load() {
    const [{ data: e }, { data: p }] = await Promise.all([
      supabase.from('entries').select('*').order('date', { ascending: false }),
      supabase.from('profiles').select('*'),
    ]);
    setEntries(e ?? []);
    setProfiles(p ?? []);
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => { load(); }, []);
  function onRefresh() { setRefreshing(true); load(); }

  const drivers = profiles.filter(p => p.role === 'driver');

  const filtered = entries.filter(e => {
    const driver = profiles.find(p => p.id === e.driver_id);
    const matchDriver = filterDriver === 'all' || e.driver_id === filterDriver;
    const q = search.toLowerCase();
    const matchSearch = !q ||
      e.city?.toLowerCase().includes(q) ||
      e.crm_id?.toLowerCase().includes(q) ||
      driver?.name?.toLowerCase().includes(q);
    return matchDriver && matchSearch;
  });

  if (loading) return <View style={s.center}><ActivityIndicator color="#f5a623" /></View>;

  return (
    <View style={s.container}>
      <View style={s.topBar}>
        <TextInput
          style={s.search}
          value={search}
          onChangeText={setSearch}
          placeholder="Search city, CRM ID, driver..."
          placeholderTextColor="#333"
        />
        <Text style={s.count}>{filtered.length}/{entries.length}</Text>
      </View>

      <FlatList
        horizontal showsHorizontalScrollIndicator={false}
        data={[{ id: 'all', name: 'All' }, ...drivers]}
        keyExtractor={d => d.id}
        style={s.filterRow}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[s.pill, filterDriver === item.id && s.pillActive]}
            onPress={() => setFilterDriver(item.id)}
          >
            <Text style={[s.pillText, filterDriver === item.id && s.pillTextActive]}>{item.name}</Text>
          </TouchableOpacity>
        )}
      />

      <FlatList
        data={filtered}
        keyExtractor={e => e.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#f5a623" />}
        contentContainerStyle={s.list}
        ListEmptyComponent={<Text style={s.empty}>No entries found.</Text>}
        renderItem={({ item: e }) => {
          const driver = profiles.find(p => p.id === e.driver_id);
          return (
            <View style={s.card}>
              <View style={s.cardTop}>
                <Text style={s.driverName}>{driver?.name ?? '—'}</Text>
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
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center' },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 10, gap: 10 },
  search: { flex: 1, backgroundColor: '#111', borderWidth: 1, borderColor: '#1e1e1e', color: '#fff', paddingHorizontal: 12, paddingVertical: 9, fontSize: 13 },
  count: { fontSize: 11, color: '#555' },
  filterRow: { paddingLeft: 20, marginBottom: 10, flexGrow: 0 },
  pill: { borderWidth: 1, borderColor: '#1e1e1e', paddingHorizontal: 12, paddingVertical: 6, marginRight: 8, backgroundColor: '#111' },
  pillActive: { borderColor: '#f5a623', backgroundColor: 'rgba(245,166,35,0.1)' },
  pillText: { fontSize: 11, color: '#555', fontWeight: '700' },
  pillTextActive: { color: '#f5a623' },
  list: { paddingHorizontal: 20, paddingBottom: 40 },
  card: { backgroundColor: '#111', borderWidth: 1, borderColor: '#1e1e1e', borderLeftWidth: 3, borderLeftColor: '#2a2a2a', padding: 14, marginBottom: 8 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  driverName: { fontSize: 14, fontWeight: '800', color: '#fff' },
  pay: { fontSize: 16, fontWeight: '900', color: '#f5a623' },
  cardMid: { flexDirection: 'row', gap: 12, marginBottom: 6 },
  city: { fontSize: 11, color: '#888', fontWeight: '600' },
  crm: { fontSize: 11, color: '#555' },
  cardBot: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  meta: { fontSize: 11, color: '#555' },
  badge: { backgroundColor: 'rgba(74,232,133,0.15)', paddingHorizontal: 8, paddingVertical: 2 },
  badgeMiss: { backgroundColor: 'rgba(232,90,74,0.15)' },
  badgeText: { fontSize: 9, fontWeight: '700', color: '#4ae885', letterSpacing: 1 },
  badgeTextMiss: { color: '#e85a4a' },
  empty: { color: '#444', textAlign: 'center', marginTop: 32 },
});