import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  RefreshControl, ActivityIndicator, TouchableOpacity,
} from 'react-native';
import { supabase } from '../lib/supabase';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const TIMEOUT_MS = 8000;
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

export default function AvailabilityScreen() {
  const [availability, setAvailability] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);

  async function load() {
    setError(false);
    try {
      const [{ data: p }, { data: a }] = await withTimeout(
        Promise.all([
          supabase.from('profiles').select('*').eq('role', 'driver'),
          supabase.from('availability').select('*'),
        ]),
        TIMEOUT_MS
      );
      setProfiles(p ?? []);
      setAvailability(a ?? []);
    } catch (err) {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { load(); }, []);
  function onRefresh() { setRefreshing(true); load(); }

  if (loading) return <View style={s.center}><ActivityIndicator color="#f5a623" /></View>;

  if (error) return (
    <View style={s.center}>
      <Text style={s.errorText}>Failed to load data</Text>
      <TouchableOpacity style={s.retryBtn} onPress={() => { setLoading(true); load(); }}>
        <Text style={s.retryText}>RETRY</Text>
      </TouchableOpacity>
    </View>
  );

  if (profiles.length === 0) {
    return (
      <View style={s.center}>
        <Text style={s.empty}>No drivers found.</Text>
      </View>
    );
  }

  const noTable = availability === null;

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#f5a623" />}>

      {noTable ? (
        <View style={s.notice}>
          <Text style={s.noticeTitle}>TABLE NOT SET UP</Text>
          <Text style={s.noticeText}>Run this in Supabase SQL Editor to enable availability tracking:</Text>
          <Text style={s.code}>{`create table availability (\n  id uuid primary key default gen_random_uuid(),\n  driver_id uuid references profiles(id),\n  day text,\n  available boolean default true,\n  note text,\n  updated_at timestamptz default now()\n);\nalter table availability enable row level security;\ncreate policy "All authenticated can read"\n  on availability for select using (auth.uid() is not null);\ncreate policy "Drivers manage own"\n  on availability for all using (auth.uid() = driver_id)\n  with check (auth.uid() = driver_id);`}</Text>
        </View>
      ) : (
        <>
          <Text style={s.sectionTitle}>DRIVER AVAILABILITY</Text>
          {profiles.map(driver => {
            const driverAvail = DAYS.map(day => {
              const record = availability.find(a => a.driver_id === driver.id && a.day === day);
              return { day, available: record ? record.available : null, note: record?.note };
            });

            return (
              <View key={driver.id} style={s.card}>
                <Text style={s.driverName}>{driver.name}</Text>
                <View style={s.daysRow}>
                  {driverAvail.map(({ day, available }) => (
                    <View key={day} style={[
                      s.dayChip,
                      available === true && s.dayAvail,
                      available === false && s.dayUnavail,
                    ]}>
                      <Text style={[
                        s.dayLabel,
                        available === true && s.dayLabelAvail,
                        available === false && s.dayLabelUnavail,
                      ]}>
                        {day.slice(0, 2).toUpperCase()}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            );
          })}

          {availability.length === 0 && (
            <Text style={s.empty}>No availability submitted yet. Drivers set their availability from the app.</Text>
          )}
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 20, paddingTop: 20, paddingBottom: 40 },
  center: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center', padding: 20 },
  sectionTitle: { fontSize: 10, color: '#444', letterSpacing: 2, fontWeight: '700', marginBottom: 14 },
  card: { backgroundColor: '#111', borderWidth: 1, borderColor: '#1e1e1e', borderLeftWidth: 3, borderLeftColor: '#3b8cf7', padding: 16, marginBottom: 10 },
  driverName: { fontSize: 15, fontWeight: '800', color: '#fff', marginBottom: 12 },
  daysRow: { flexDirection: 'row', gap: 6 },
  dayChip: { width: 34, height: 34, borderRadius: 4, backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#2a2a2a' },
  dayAvail: { backgroundColor: 'rgba(74,232,133,0.15)', borderColor: '#4ae885' },
  dayUnavail: { backgroundColor: 'rgba(232,90,74,0.1)', borderColor: '#2a2a2a' },
  dayLabel: { fontSize: 10, fontWeight: '800', color: '#444', letterSpacing: 0.5 },
  dayLabelAvail: { color: '#4ae885' },
  dayLabelUnavail: { color: '#333' },
  empty: { color: '#555', fontSize: 13, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  notice: { backgroundColor: '#111', borderWidth: 1, borderColor: '#2a2a2a', padding: 20 },
  noticeTitle: { fontSize: 12, color: '#e85a4a', fontWeight: '900', letterSpacing: 2, marginBottom: 8 },
  noticeText: { fontSize: 13, color: '#888', marginBottom: 14 },
  code: { fontFamily: 'monospace', fontSize: 11, color: '#f5a623', lineHeight: 18 },
  errorText: { color: '#555', fontSize: 14, marginBottom: 16 },
  retryBtn: { borderWidth: 1, borderColor: '#f5a623', paddingHorizontal: 24, paddingVertical: 10 },
  retryText: { color: '#f5a623', fontSize: 12, letterSpacing: 2, fontWeight: '700' },
});