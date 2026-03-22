import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  RefreshControl, ActivityIndicator, TouchableOpacity,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { colors, spacing, radius, typography } from '../lib/theme';

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

  if (loading) return <View style={s.center}><ActivityIndicator color={colors.primary} /></View>;

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
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}>

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
                <Text style={s.driverName}>
                  {driver.name}
                  {driver.willing_to_fly && <Text style={s.flyBadge}> (F)</Text>}
                </Text>
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
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.xxxxl },
  center: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  sectionTitle: { ...typography.label, color: colors.textMuted, marginBottom: spacing.lg },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderLeftWidth: 3, borderLeftColor: colors.info, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.md },
  driverName: { fontSize: 15, fontWeight: '800', color: colors.textPrimary, marginBottom: spacing.md },
  flyBadge: { fontSize: 12, fontWeight: '700', color: colors.primary },
  daysRow: { flexDirection: 'row', gap: radius.sm },
  dayChip: { width: 34, height: 34, borderRadius: radius.sm, backgroundColor: colors.surfaceElevated, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.borderLight },
  dayAvail: { backgroundColor: colors.successDim, borderColor: colors.success },
  dayUnavail: { backgroundColor: colors.errorDim, borderColor: colors.borderLight },
  dayLabel: { fontSize: 10, fontWeight: '800', color: colors.textMuted, letterSpacing: 0.5 },
  dayLabelAvail: { color: colors.success },
  dayLabelUnavail: { color: colors.textMuted },
  empty: { ...typography.bodySm, color: colors.textTertiary, textAlign: 'center', marginTop: spacing.sm },
  notice: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderLight, borderRadius: radius.md, padding: spacing.xl },
  noticeTitle: { fontSize: 12, color: colors.error, fontWeight: '900', letterSpacing: 2, marginBottom: spacing.sm },
  noticeText: { ...typography.bodySm, color: colors.textSecondary, marginBottom: spacing.lg },
  code: { fontFamily: 'monospace', fontSize: 11, color: colors.primary, lineHeight: 18 },
  errorText: { color: colors.textTertiary, fontSize: 14, marginBottom: spacing.lg },
  retryBtn: { borderWidth: 1, borderColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: spacing.xxl, paddingVertical: spacing.md },
  retryText: { color: colors.primary, fontSize: 12, letterSpacing: 2, fontWeight: '700' },
});