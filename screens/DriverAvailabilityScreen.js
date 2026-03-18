import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Switch,
  TouchableOpacity, ActivityIndicator, TextInput, Platform,
} from 'react-native';
import { supabase } from '../lib/supabase';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function getNextWeekStart() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 6=Sat
  const daysUntilSunday = day === 0 ? 7 : 7 - day;
  const nextSunday = new Date(now);
  nextSunday.setDate(now.getDate() + daysUntilSunday);
  nextSunday.setHours(0, 0, 0, 0);
  return nextSunday;
}

function getNextWeekLabel() {
  const start = getNextWeekStart();
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const opts = { month: 'short', day: 'numeric' };
  return `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', { ...opts, year: 'numeric' })}`;
}

export default function DriverAvailabilityScreen({ session }) {
  const weekStart = getNextWeekStart().toISOString().slice(0, 10);

  const emptyAvail = {
    sun: false, mon: false, tue: false, wed: false,
    thu: false, fri: false, sat: false,
    sun_done_by: '', mon_done_by: '', tue_done_by: '',
    wed_done_by: '', thu_done_by: '', fri_done_by: '', sat_done_by: '',
  };

  const [avail, setAvail] = useState(emptyAvail);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [existingRecord, setExistingRecord] = useState(null);

  const today = new Date().getDay();
  const isAfterSat = today !== 6; // not Saturday
  const isAmend = existingRecord && isAfterSat;

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('availability')
      .select('*')
      .eq('driver_id', session.user.id)
      .eq('week_start', weekStart)
      .maybeSingle();

    if (data) {
      setExistingRecord(data);
      setAvail({
        sun: data.sun, mon: data.mon, tue: data.tue,
        wed: data.wed, thu: data.thu, fri: data.fri, sat: data.sat,
        sun_done_by: data.sun_done_by ?? '',
        mon_done_by: data.mon_done_by ?? '',
        tue_done_by: data.tue_done_by ?? '',
        wed_done_by: data.wed_done_by ?? '',
        thu_done_by: data.thu_done_by ?? '',
        fri_done_by: data.fri_done_by ?? '',
        sat_done_by: data.sat_done_by ?? '',
      });
    } else {
      setExistingRecord(null);
      setAvail(emptyAvail);
    }
    setLoading(false);
  }

  async function handleSave() {
    if (isAmend && !reason.trim()) return;
    setSaving(true);

    const payload = {
      driver_id: session.user.id,
      week_start: weekStart,
      ...avail,
      updated_after_saturday: isAfterSat
        ? true
        : (existingRecord?.updated_after_saturday ?? false),
      update_reason: isAfterSat
        ? reason.trim()
        : (existingRecord?.update_reason ?? null),
    };

    // Null out done_by for unchecked days
    DAYS.forEach(d => {
      if (!avail[d]) payload[`${d}_done_by`] = null;
    });

    await supabase
      .from('availability')
      .upsert(payload, { onConflict: 'driver_id,week_start' });

    setSaving(false);
    setSaved(true);
    setReason('');
    await load();
    setTimeout(() => setSaved(false), 3000);
  }

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color="#f5a623" />
      </View>
    );
  }

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      {/* Header */}
      <Text style={s.heading}>AVAILABILITY</Text>
      <Text style={s.subheading}>{getNextWeekLabel()}</Text>

      {/* Already submitted banner */}
      {existingRecord && (
        <View style={s.submittedBanner}>
          <Text style={s.submittedText}>
            ✓ Submitted on{' '}
            {new Date(existingRecord.submitted_at ?? existingRecord.updated_at).toLocaleDateString('en-US', {
              weekday: 'long', month: 'short', day: 'numeric',
            })}
          </Text>
          {existingRecord.updated_after_saturday && (
            <Text style={s.amendedText}>
              ⚠ Amended — Reason: "{existingRecord.update_reason}"
            </Text>
          )}
        </View>
      )}

      {/* Amendment warning */}
      {isAmend && (
        <View style={s.warningBanner}>
          <Text style={s.warningText}>
            ⚠ You are updating your availability after Saturday. Your manager will be notified and you must provide a reason below.
          </Text>
        </View>
      )}

      {/* Day rows */}
      <View style={s.daysContainer}>
        {DAYS.map((day, i) => (
          <View key={day} style={s.dayRow}>
            <View style={s.dayLeft}>
              <Switch
                value={avail[day]}
                onValueChange={val => setAvail(a => ({ ...a, [day]: val }))}
                trackColor={{ false: '#1a1a1a', true: 'rgba(245,166,35,0.4)' }}
                thumbColor={avail[day] ? '#f5a623' : '#444'}
              />
              <Text style={[s.dayLabel, avail[day] && s.dayLabelActive]}>
                {DAY_LABELS[i]}
              </Text>
            </View>
            {avail[day] && (
              <View style={s.doneByRow}>
                <Text style={s.doneByLabel}>Done by</Text>
                <TextInput
                  style={s.timeInput}
                  value={avail[`${day}_done_by`]}
                  onChangeText={val => setAvail(a => ({ ...a, [`${day}_done_by`]: val }))}
                  placeholder="e.g. 3:00 PM"
                  placeholderTextColor="#333"
                  keyboardType="default"
                />
              </View>
            )}
          </View>
        ))}
      </View>

      {/* Amendment reason */}
      {isAmend && (
        <View style={s.field}>
          <Text style={s.fieldLabel}>REASON FOR CHANGE <Text style={s.required}>*</Text></Text>
          <TextInput
            style={s.input}
            value={reason}
            onChangeText={setReason}
            placeholder="e.g. Doctor appointment on Monday"
            placeholderTextColor="#333"
          />
        </View>
      )}

      {/* Save button */}
      <TouchableOpacity
        style={[s.saveBtn, (saving || (isAmend && !reason.trim())) && s.saveBtnDisabled]}
        onPress={handleSave}
        disabled={saving || (isAmend && !reason.trim())}
      >
        <Text style={s.saveBtnText}>
          {saving
            ? 'SAVING...'
            : existingRecord
              ? 'UPDATE AVAILABILITY'
              : 'SUBMIT AVAILABILITY'}
        </Text>
      </TouchableOpacity>

      {saved && (
        <View style={s.successToast}>
          <Text style={s.successText}>
            ✓ Availability {isAmend ? 'updated' : 'submitted'}!
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 20, paddingTop: 60, paddingBottom: 48 },
  center: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center' },

  heading: { fontSize: 24, fontWeight: '900', color: '#fff', letterSpacing: 3, marginBottom: 4 },
  subheading: { fontSize: 12, color: '#555', marginBottom: 20 },

  submittedBanner: {
    backgroundColor: 'rgba(74,232,133,0.08)',
    borderWidth: 1, borderColor: 'rgba(74,232,133,0.2)',
    padding: 12, marginBottom: 16,
  },
  submittedText: { fontSize: 12, color: '#4ae885', fontWeight: '600' },
  amendedText: { fontSize: 11, color: '#f5a623', marginTop: 4 },

  warningBanner: {
    backgroundColor: 'rgba(245,166,35,0.08)',
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.25)',
    padding: 12, marginBottom: 16,
  },
  warningText: { fontSize: 12, color: '#f5a623', lineHeight: 18 },

  daysContainer: {
    backgroundColor: '#111',
    borderWidth: 1, borderColor: '#1e1e1e',
    marginBottom: 20,
  },
  dayRow: {
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
    padding: 14, minHeight: 56,
  },
  dayLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dayLabel: { fontSize: 15, fontWeight: '600', color: '#444' },
  dayLabelActive: { color: '#fff' },

  doneByRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: 10, marginTop: 10, marginLeft: 52,
  },
  doneByLabel: { fontSize: 11, color: '#555' },
  timeInput: {
    flex: 1, backgroundColor: '#0a0a0a',
    borderWidth: 1, borderColor: '#2a2a2a',
    color: '#fff', padding: 8, fontSize: 13,
  },

  field: { marginBottom: 16 },
  fieldLabel: { fontSize: 10, color: '#555', letterSpacing: 2, fontWeight: '700', marginBottom: 6 },
  required: { color: '#e05252' },
  input: {
    backgroundColor: '#111', borderWidth: 1, borderColor: '#2a2a2a',
    color: '#fff', padding: 12, fontSize: 14,
  },

  saveBtn: {
    backgroundColor: '#f5a623', padding: 16,
    alignItems: 'center', marginBottom: 16,
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { color: '#0a0a0a', fontWeight: '900', fontSize: 13, letterSpacing: 2 },

  successToast: {
    backgroundColor: 'rgba(74,232,133,0.1)',
    borderWidth: 1, borderColor: '#4ae885',
    padding: 12, alignItems: 'center',
  },
  successText: { color: '#4ae885', fontSize: 13, fontWeight: '600' },
});