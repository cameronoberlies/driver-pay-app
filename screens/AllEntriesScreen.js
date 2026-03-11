import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList,
  TouchableOpacity, TextInput, RefreshControl, ActivityIndicator,
} from 'react-native';
import { supabase } from '../lib/supabase';

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${m}/${d}/${y}`;
}

function formatCurrency(n) {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2 });
}

export default function AllEntriesScreen({ session }) {
  const [entries, setEntries] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [filterDriver, setFilterDriver] = useState('all');

  async function loadData() {
    const [{ data: entryData }, { data: profileData }] = await Promise.all([
      supabase.from('entries').select('*').order('date', { ascending: false }),
      supabase.from('profiles').select('*'),
    ]);
    setEntries(entryData ?? []);
    setProfiles(profileData ?? []);
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => { loadData(); }, []);

  function onRefresh() { setRefreshing(true); loadData(); }

  const drivers = profiles.filter(p => p.role === 'driver');

  const filtered = entries.filter(e => {
    const driver = profiles.find(p => p.id === e.driver_id);
    const matchDriver = filterDriver === 'all' || e.driver_id === filterDriver;
    const matchSearch = !search ||
      e.city?.toLowerCase().includes(search.toLowerCase()) ||
      e.crm_id?.toLowerCase().includes(search.toLowerCase()) ||
      driver?.name?.toLowerCase().includes(search.toLowerCase());
    return matchDriver && matchSearch;
  });

  if (loading) return <View style={styles.center}><ActivityIndicator color="#f5a623" /></View>;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>ALL ENTRIES</Text>
        <Text style={styles.count}>{filtered.length} of {entries.length}</Text>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search city, CRM ID, driver..."
          placeholderTextColor="#333"
        />
      </View>

      {/* Driver filter pills */}
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={[{ id: 'all', name: 'All' }, ...drivers]}
        keyExtractor={d => d.id}
        style={styles.filterRow}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.filterPill, filterDriver === item.id && styles.filterPillActive]}
            onPress={() => setFilterDriver(item.id)}
          >
            <Text style={[styles.filterPillText, filterDriver === item.id && styles.filterPillTextActive]}>
              {item.name}
            </Text>
          </TouchableOpacity>
        )}
      />

      {/* Entries list */}
      <FlatList
        data={filtered}
        keyExtractor={e => e.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#f5a623" />}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<Text style={styles.empty}>No entries found.</Text>}
        renderItem={({ item: e }) => {
          const driver = profiles.find(p => p.id === e.driver_id);
          return (
            <View style={styles.entryCard}>
              <View style={styles.entryTop}>
                <Text style={styles.entryDriver}>{driver?.name ?? '—'}</Text>
                <Text style={styles.entryPay}>{formatCurrency(e.pay)}</Text>
              </View>
              <View style={styles.entryMid}>
                <Text style={styles.entryDate}>{formatDate(e.date)}</Text>
                <Text style={styles.entryCity}>{e.city}</Text>
                <Text style={styles.entryCrm}>{e.crm_id}</Text>
              </View>
              <View style={styles.entryBottom}>
                <Text style={styles.entryMeta}>{e.hours ?? '—'}h worked</Text>
                <Text style={styles.entryMeta}>{e.miles ?? 0} mi</Text>
                {e.drive_time != null && (
                  <Text style={styles.entryMeta}>{e.drive_time}h drive</Text>
                )}
                <View style={[styles.reconBadge, e.recon_missed && styles.reconBadgeMiss]}>
                  <Text style={[styles.reconText, e.recon_missed && styles.reconTextMiss]}>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 60, paddingBottom: 12 },
  title: { fontSize: 22, fontWeight: '900', color: '#fff', letterSpacing: 2 },
  count: { fontSize: 12, color: '#555' },
  searchWrap: { paddingHorizontal: 20, marginBottom: 10 },
  searchInput: {
    backgroundColor: '#111', borderWidth: 1, borderColor: '#1e1e1e',
    color: '#fff', paddingHorizontal: 14, paddingVertical: 10, fontSize: 13,
  },
  filterRow: { paddingLeft: 20, marginBottom: 12, flexGrow: 0 },
  filterPill: {
    borderWidth: 1, borderColor: '#1e1e1e', paddingHorizontal: 12, paddingVertical: 6,
    marginRight: 8, backgroundColor: '#111',
  },
  filterPillActive: { borderColor: '#f5a623', backgroundColor: 'rgba(245,166,35,0.1)' },
  filterPillText: { fontSize: 11, color: '#555', fontWeight: '700' },
  filterPillTextActive: { color: '#f5a623' },
  listContent: { paddingHorizontal: 20, paddingBottom: 40 },
  entryCard: {
    backgroundColor: '#111', borderWidth: 1, borderColor: '#1e1e1e',
    borderLeftWidth: 3, borderLeftColor: '#2a2a2a',
    padding: 14, marginBottom: 8,
  },
  entryTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  entryDriver: { fontSize: 14, fontWeight: '800', color: '#fff' },
  entryPay: { fontSize: 16, fontWeight: '900', color: '#f5a623' },
  entryMid: { flexDirection: 'row', gap: 12, marginBottom: 8 },
  entryDate: { fontSize: 11, color: '#555' },
  entryCity: { fontSize: 11, color: '#888', fontWeight: '600' },
  entryCrm: { fontSize: 11, color: '#555', fontFamily: 'monospace' },
  entryBottom: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  entryMeta: { fontSize: 11, color: '#555' },
  reconBadge: { backgroundColor: 'rgba(74,232,133,0.15)', paddingHorizontal: 8, paddingVertical: 2 },
  reconBadgeMiss: { backgroundColor: 'rgba(232,90,74,0.15)' },
  reconText: { fontSize: 9, fontWeight: '700', color: '#4ae885', letterSpacing: 1 },
  reconTextMiss: { color: '#e85a4a' },
  empty: { color: '#444', fontSize: 13, textAlign: 'center', marginTop: 32 },
});