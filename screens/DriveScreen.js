import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Alert,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import * as Location from 'expo-location';
import { supabase } from '../lib/supabase';

// Haversine formula — calculates distance between two GPS coords in miles
function getDistanceMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

const STATES = {
  IDLE: 'idle',
  DRIVING: 'driving',
  SUMMARY: 'summary',
};

// How often to push live location to Supabase (ms)
const LIVE_LOCATION_INTERVAL = 30000; // 30 seconds

export default function DriveScreen({ session }) {
  const [state, setState] = useState(STATES.IDLE);
  const [miles, setMiles] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [city, setCity] = useState('');
  const [saving, setSaving] = useState(false);

  const waypointsRef = useRef([]);
  const startTimeRef = useRef(null);
  const locationSubRef = useRef(null);
  const timerRef = useRef(null);
  const liveLocationTimerRef = useRef(null);
  const lastKnownLocationRef = useRef(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (locationSubRef.current) locationSubRef.current.remove();
      if (timerRef.current) clearInterval(timerRef.current);
      if (liveLocationTimerRef.current) clearInterval(liveLocationTimerRef.current);
    };
  }, []);

  const requestPermissions = async () => {
    const { status: fg } = await Location.requestForegroundPermissionsAsync();
    if (fg !== 'granted') {
      Alert.alert('Permission Required', 'Location access is needed to track your trip.');
      return false;
    }
    const { status: bg } = await Location.requestBackgroundPermissionsAsync();
    if (bg !== 'granted') {
      Alert.alert(
        'Background Location Required',
        'Please allow "Always" location access in Settings so the app can track miles when your screen is locked.',
        [{ text: 'OK' }]
      );
      return false;
    }
    return true;
  };

  // Push current location to Supabase for live tracking
  const pushLiveLocation = async () => {
    if (!lastKnownLocationRef.current || !session?.user?.id) return;
    const { latitude, longitude } = lastKnownLocationRef.current;
    await supabase.from('driver_locations').upsert({
      driver_id: session.user.id,
      latitude,
      longitude,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'driver_id' });
  };

  // Start live location push timer
    liveLocationTimerRef.current = setInterval(pushLiveLocation, LIVE_LOCATION_INTERVAL);

    // Push immediately on start
    pushLiveLocation();

  // Clear live location from Supabase when drive ends
  const clearLiveLocation = async () => {
    if (!session?.user?.id) return;
    await supabase.from('driver_locations').delete().eq('driver_id', session.user.id);
  };

  const startDrive = async () => {
    const permitted = await requestPermissions();
    if (!permitted) return;

    waypointsRef.current = [];
    startTimeRef.current = Date.now();
    setMiles(0);
    setElapsed(0);

    // Start watching position
    const sub = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: 10000,
        distanceInterval: 50,
      },
      (loc) => {
        const { latitude, longitude } = loc.coords;
        lastKnownLocationRef.current = { latitude, longitude };

        // 👇 ADD THIS LINE
        if (waypointsRef.current.length === 0) pushLiveLocation();

        const waypoints = waypointsRef.current;
        if (waypoints.length > 0) {
          const last = waypoints[waypoints.length - 1];
          const added = getDistanceMiles(last.lat, last.lon, latitude, longitude);
          setMiles(prev => prev + added);
        }
        waypointsRef.current.push({ lat: latitude, lon: longitude });
      }
    );

    locationSubRef.current = sub;

    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);

    liveLocationTimerRef.current = setInterval(pushLiveLocation, LIVE_LOCATION_INTERVAL);

    // 👇 ADD THIS LINE
    pushLiveLocation();

    setState(STATES.DRIVING);
  };

  const stopDrive = () => {
    if (locationSubRef.current) {
      locationSubRef.current.remove();
      locationSubRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (liveLocationTimerRef.current) {
      clearInterval(liveLocationTimerRef.current);
      liveLocationTimerRef.current = null;
    }
    clearLiveLocation();
    setState(STATES.SUMMARY);
  };

  const saveTrip = async () => {
    if (!city.trim()) {
      Alert.alert('City Required', 'Please enter the destination city.');
      return;
    }

    setSaving(true);

    // drive_time = GPS-tracked drive duration in decimal hours
    const driveTimeDecimal = parseFloat((elapsed / 3600).toFixed(2));
    const roundedMiles = parseFloat(miles.toFixed(1));
    const today = new Date().toISOString().split('T')[0];

    const { error } = await supabase.from('entries').insert({
      driver_id: session.user.id,
      date: today,
      pay: 0,
      hours: null,        // Admin fills in total hours worked
      drive_time: driveTimeDecimal, // GPS-tracked drive time
      miles: roundedMiles,
      city: city.trim(),
      crm_id: '',
      recon_missed: false,
    });

    setSaving(false);

    if (error) {
      Alert.alert('Save Failed', error.message);
      return;
    }

    Alert.alert(
      'Trip Saved',
      `${roundedMiles} miles · ${formatDuration(elapsed)} · ${city.trim()}`,
      [{ text: 'Done', onPress: resetToIdle }]
    );
  };

  const resetToIdle = () => {
    setState(STATES.IDLE);
    setMiles(0);
    setElapsed(0);
    setCity('');
    waypointsRef.current = [];
    lastKnownLocationRef.current = null;
  };

  // IDLE — ready to start
  if (state === STATES.IDLE) {
    return (
      <View style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.idleTitle}>READY TO DRIVE</Text>
          <Text style={styles.idleSub}>Tap start when you leave the lot</Text>
          <TouchableOpacity style={styles.startBtn} onPress={startDrive}>
            <Text style={styles.startBtnText}>START DRIVE</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // DRIVING — live tracking
  if (state === STATES.DRIVING) {
    return (
      <View style={styles.container}>
        <View style={styles.center}>
          <View style={styles.liveIndicator}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>TRACKING</Text>
          </View>

          <Text style={styles.bigMiles}>{miles.toFixed(1)}</Text>
          <Text style={styles.milesLabel}>MILES</Text>

          <Text style={styles.elapsed}>{formatDuration(elapsed)}</Text>

          <TouchableOpacity style={styles.stopBtn} onPress={stopDrive}>
            <Text style={styles.stopBtnText}>END DRIVE</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // SUMMARY — confirm and save
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.summaryContent}>
      <Text style={styles.summaryTitle}>TRIP COMPLETE</Text>

      <View style={styles.summaryCard}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>MILES DRIVEN</Text>
          <Text style={styles.summaryValue}>{miles.toFixed(1)} mi</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>DRIVE TIME</Text>
          <Text style={styles.summaryValue}>{formatDuration(elapsed)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>DATE</Text>
          <Text style={styles.summaryValue}>
            {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </Text>
        </View>
      </View>

      <Text style={styles.inputLabel}>DESTINATION CITY</Text>
      <TextInput
        style={styles.input}
        value={city}
        onChangeText={setCity}
        placeholder="e.g. Charlotte"
        placeholderTextColor="#555"
        autoCapitalize="words"
      />

      <Text style={styles.adminNote}>
        Pay, CRM lead ID, and recon will be filled in by admin
      </Text>

      <TouchableOpacity
        style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
        onPress={saveTrip}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator color="#0a0a0a" />
        ) : (
          <Text style={styles.saveBtnText}>SAVE TRIP →</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity style={styles.discardBtn} onPress={resetToIdle}>
        <Text style={styles.discardText}>DISCARD TRIP</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  summaryContent: { padding: 24, paddingBottom: 48 },

  // Idle
  idleTitle: { fontSize: 22, fontWeight: '900', color: '#fff', letterSpacing: 2, marginBottom: 8 },
  idleSub: { fontSize: 13, color: '#555', marginBottom: 48 },
  startBtn: {
    backgroundColor: '#f5a623',
    borderRadius: 50,
    paddingVertical: 24,
    paddingHorizontal: 48,
  },
  startBtnText: { fontSize: 16, fontWeight: '900', color: '#0a0a0a', letterSpacing: 2 },

  // Driving
  liveIndicator: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 32 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4caf50' },
  liveText: { fontSize: 11, color: '#4caf50', letterSpacing: 3, fontWeight: '700' },
  bigMiles: { fontSize: 80, fontWeight: '900', color: '#f5a623', letterSpacing: -2 },
  milesLabel: { fontSize: 12, color: '#555', letterSpacing: 4, marginTop: -8, marginBottom: 16 },
  elapsed: { fontSize: 24, color: '#888', fontWeight: '300', marginBottom: 48 },
  stopBtn: {
    borderWidth: 2,
    borderColor: '#e05252',
    borderRadius: 50,
    paddingVertical: 20,
    paddingHorizontal: 40,
  },
  stopBtnText: { fontSize: 14, fontWeight: '900', color: '#e05252', letterSpacing: 2 },

  // Summary
  summaryTitle: { fontSize: 20, fontWeight: '900', color: '#fff', letterSpacing: 2, marginBottom: 24 },
  summaryCard: {
    backgroundColor: '#111',
    borderRadius: 12,
    padding: 20,
    marginBottom: 28,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    borderLeftWidth: 3,
    borderLeftColor: '#f5a623',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  summaryLabel: { fontSize: 10, color: '#666', letterSpacing: 2 },
  summaryValue: { fontSize: 15, fontWeight: '700', color: '#fff' },
  inputLabel: { fontSize: 11, color: '#888', letterSpacing: 2, marginBottom: 8 },
  input: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#fff',
    fontSize: 15,
    marginBottom: 12,
  },
  adminNote: { fontSize: 11, color: '#444', marginBottom: 28, fontStyle: 'italic' },
  saveBtn: {
    backgroundColor: '#f5a623',
    borderRadius: 6,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: '#0a0a0a', fontWeight: '800', fontSize: 14, letterSpacing: 2 },
  discardBtn: { paddingVertical: 16, alignItems: 'center' },
  discardText: { fontSize: 12, color: '#444', letterSpacing: 1.5 },
});