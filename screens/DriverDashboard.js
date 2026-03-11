import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { supabase } from '../lib/supabase';

function getWeekBounds() {
  const today = new Date();
  const day = today.getDay();
  const diff = (day >= 3) ? day - 3 : day + 4;
  const wed = new Date(today);
  wed.setDate(today.getDate() - diff);
  wed.setHours(0, 0, 0, 0);
  const tue = new Date(wed);
  tue.setDate(wed.getDate() + 6);
  tue.setHours(23, 59, 59, 999);
  return { start: wed, end: tue };
}

function getMonthBounds() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  return { start, end };
}

export default function DriverDashboard({ session }) {
  const [profile, setProfile] = useState(null);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async () => {
    const userId = session.user.id;

    const { data: prof } = await supabase
      .from('profiles')
      .select('name, role')
      .eq('id', userId)
      .single();
    setProfile(prof);

    const { data: ents } = await supabase
      .from('entries')
      .select('*')
      .eq('driver_id', userId)
      .order('date', { ascending: false });
    setEntries(ents || []);
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => { fetchData(); }, []);

  const onRefresh = () => { setRefreshing(true); fetchData(); };

  const handleSignOut = () => supabase.auth.signOut();

  const { start: wStart, end: wEnd } = getWeekBounds();
  const { start: mStart, end: mEnd } = getMonthBounds();

  const weekEntries = entries.filter(e => {
    const d = new Date(e.date);
    return d >= wStart && d <= wEnd;
  });
  const monthEntries = entries.filter(e => {
    const d = new Date(e.date);
    return d >= mStart && d <= mEnd;
  });

  const weekPay = weekEntries.reduce((s, e) => s + Number(e.pay), 0);
  const weekHours = weekEntries.reduce((s, e) => s + Number(e.hours), 0);
  const weekMiles = weekEntries.reduce((s, e) => s + Number(e.miles || 0), 0);
  const monthTrips = monthEntries.length;

  const tripBonus = monthTrips >= 20;
  const sortedEntries = [...entries].sort((a, b) => new Date(b.date) - new Date(a.date));
  let reconStreak = 0;
  for (const e of sortedEntries) {
    if (e.recon_missed) break;
    reconStreak++;
  }
  const reconBonus = reconStreak >= 25;

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#f5a623" size="large" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#f5a623" />}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Hey, {profile?.name?.split(' ')[0]}.</Text>
          <Text style={styles.period}>
            PAY PERIOD: {wStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {wEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </Text>
        </View>
        <TouchableOpacity onPress={handleSignOut} style={styles.signOutBtn}>
          <Text style={styles.signOutText}>SIGN OUT</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.heroCard}>
        <Text style={styles.heroLabel}>THIS WEEK'S EARNINGS</Text>
        <Text style={styles.heroValue}>${weekPay.toFixed(2)}</Text>
        <View style={styles.heroRow}>
          <Text style={styles.heroStat}>{weekEntries.length} trips</Text>
          <Text style={styles.heroDot}>·</Text>
          <Text style={styles.heroStat}>{weekHours}h worked</Text>
          <Text style={styles.heroDot}>·</Text>
          <Text style={styles.heroStat}>{weekMiles.toFixed(0)} mi</Text>
        </View>
      </View>

      <Text style={styles.sectionLabel}>BONUS PROGRESS</Text>
      <View style={styles.bonusRow}>
        <View style={[styles.bonusCard, tripBonus && styles.bonusEarned]}>
          <Text style={styles.bonusTitle}>TRIP BONUS</Text>
          <Text style={styles.bonusAmount}>$50</Text>
          <Text style={styles.bonusDesc}>{monthTrips} / 20 trips this month</Text>
          {tripBonus && <Text style={styles.bonusTag}>✓ EARNED</Text>}
        </View>
        <View style={[styles.bonusCard, reconBonus && styles.bonusEarned]}>
          <Text style={styles.bonusTitle}>RECON STREAK</Text>
          <Text style={styles.bonusAmount}>$50</Text>
          <Text style={styles.bonusDesc}>{reconStreak} / 25 consecutive</Text>
          {reconBonus && <Text style={styles.bonusTag}>✓ EARNED</Text>}
        </View>
      </View>

      <Text style={styles.sectionLabel}>RECENT TRIPS</Text>
      {entries.slice(0, 10).map(entry => (
        <View key={entry.id} style={styles.tripRow}>
          <View style={styles.tripLeft}>
            <Text style={styles.tripCity}>{entry.city}</Text>
            <Text style={styles.tripMeta}>
              {new Date(entry.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              {entry.miles ? `  ·  ${entry.miles} mi` : ''}
              {entry.hours ? `  ·  ${entry.hours}h` : ''}
            </Text>
          </View>
          <View style={styles.tripRight}>
            <Text style={styles.tripPay}>${Number(entry.pay).toFixed(2)}</Text>
            {entry.recon_missed && <Text style={styles.missedTag}>MISSED</Text>}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 24, paddingBottom: 48 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0a0a0a' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28, paddingTop: 60 },
  greeting: { fontSize: 26, fontWeight: '900', color: '#fff', letterSpacing: 0.5 },
  period: { fontSize: 10, color: '#555', letterSpacing: 2, marginTop: 4 },
  signOutBtn: { paddingVertical: 6, paddingHorizontal: 12, borderWidth: 1, borderColor: '#2a2a2a', borderRadius: 4 },
  signOutText: { fontSize: 10, color: '#666', letterSpacing: 1.5 },
  heroCard: {
    backgroundColor: '#111',
    borderRadius: 12,
    padding: 24,
    marginBottom: 28,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    borderLeftWidth: 3,
    borderLeftColor: '#f5a623',
  },
  heroLabel: { fontSize: 10, color: '#888', letterSpacing: 2.5, marginBottom: 8 },
  heroValue: { fontSize: 44, fontWeight: '900', color: '#f5a623', letterSpacing: -1 },
  heroRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 6 },
  heroStat: { fontSize: 13, color: '#888' },
  heroDot: { color: '#444' },
  sectionLabel: { fontSize: 10, color: '#555', letterSpacing: 3, marginBottom: 12 },
  bonusRow: { flexDirection: 'row', gap: 12, marginBottom: 28 },
  bonusCard: {
    flex: 1,
    backgroundColor: '#111',
    borderRadius: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1e1e1e',
  },
  bonusEarned: { borderColor: '#f5a623' },
  bonusTitle: { fontSize: 9, color: '#666', letterSpacing: 2, marginBottom: 6 },
  bonusAmount: { fontSize: 24, fontWeight: '900', color: '#fff', marginBottom: 4 },
  bonusDesc: { fontSize: 11, color: '#555' },
  bonusTag: { fontSize: 10, color: '#f5a623', fontWeight: '700', marginTop: 8, letterSpacing: 1 },
  tripRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#151515',
  },
  tripLeft: { flex: 1 },
  tripCity: { fontSize: 15, fontWeight: '700', color: '#fff' },
  tripMeta: { fontSize: 12, color: '#555', marginTop: 2 },
  tripRight: { alignItems: 'flex-end' },
  tripPay: { fontSize: 16, fontWeight: '800', color: '#f5a623' },
  missedTag: { fontSize: 9, color: '#e05252', letterSpacing: 1, marginTop: 3, fontWeight: '700' },
});