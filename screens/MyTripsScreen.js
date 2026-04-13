import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput,
  TouchableOpacity, ActivityIndicator, Alert, RefreshControl, AppState, Linking,
} from 'react-native';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';

// Base64 to ArrayBuffer decoder for Supabase storage uploads
function decode(base64) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;
  const len = base64.length;
  let bufferLength = len * 0.75;
  if (base64[len - 1] === '=') bufferLength--;
  if (base64[len - 2] === '=') bufferLength--;
  const arraybuffer = new ArrayBuffer(bufferLength);
  const bytes = new Uint8Array(arraybuffer);
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const e1 = lookup[base64.charCodeAt(i)];
    const e2 = lookup[base64.charCodeAt(i + 1)];
    const e3 = lookup[base64.charCodeAt(i + 2)];
    const e4 = lookup[base64.charCodeAt(i + 3)];
    bytes[p++] = (e1 << 2) | (e2 >> 4);
    bytes[p++] = ((e2 & 15) << 4) | (e3 >> 2);
    bytes[p++] = ((e3 & 3) << 6) | e4;
  }
  return arraybuffer;
}
import * as TaskManager from 'expo-task-manager';
import { supabase } from '../lib/supabase';
import { getDistanceMiles, formatDuration } from '../lib/utils';
import { logEvent } from '../lib/systemLog';
import { colors, spacing, radius, typography, components } from '../lib/theme';
import useResponsive from '../lib/useResponsive';

const LOCATION_TASK = 'background-location-task';
const SIGNIFICANT_CHANGE_TASK = 'significant-location-change-task';
const TIMEOUT_MS = 8000;

// ── Significant Location Change task (safety net) ────────────────────────────
// iOS fires this even if the app was terminated. When triggered, we check if
// there's an active trip and restart high-accuracy tracking.
TaskManager.defineTask(SIGNIFICANT_CHANGE_TASK, async ({ data, error }) => {
  if (error) return;
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;
  const Location = require('expo-location');

  try {
    const stored = await AsyncStorage.getItem('activeTrip');
    if (!stored) return; // No active trip, nothing to recover

    // Check if high-accuracy tracking is already running
    const isTracking = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
    if (isTracking) {
      console.log('[SLC] High-accuracy tracking already active, skipping');
      return;
    }

    // Tracking was killed — restart it
    console.log('[SLC] Restarting high-accuracy tracking after app relaunch');

    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      accuracy: Location.Accuracy.BestForNavigation,
      activityType: Location.ActivityType.AutomotiveNavigation,
      timeInterval: 10000,
      distanceInterval: 0,
      foregroundService: {
        notificationTitle: 'Trip in Progress',
        notificationBody: 'Discovery Driver Portal is tracking your location.',
        notificationColor: '#f5a623',
      },
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
    });

    console.log('[SLC] High-accuracy tracking restarted successfully');
  } catch (e) {
    console.log('[SLC] Error:', e.message);
  }
});

// ── Background task definition (must be at module level) ─────────────────────
// This task runs natively even when iOS kills the JS runtime

TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data) return;
  const { locations } = data;
  if (!locations || locations.length === 0) return;

  const AsyncStorage = require('@react-native-async-storage/async-storage').default;
  const { createClient } = require('@supabase/supabase-js');

  try {
    const stored = await AsyncStorage.getItem('activeTrip');
    if (!stored) return;
    const parsed = JSON.parse(stored);
    if (parsed.paused) return; // Skip everything if trip is paused
    const { tripId, userId, lastLat, lastLon, miles, startTime } = parsed;
    const storedTopSpeed = parsed.topSpeed;
    const storedOver80 = parsed.secondsOver80;
    const storedOver90 = parsed.secondsOver90;
    const storedSpeedTime = parsed.lastSpeedTime;
    let bgStopStart = parsed.currentStopStart;

    // FIX: Get session from Supabase v2 storage key
    const STORAGE_KEY = 'sb-yincjogkjvotupzgetqg-auth-token';
    const sessionStr = await AsyncStorage.getItem(STORAGE_KEY);
    if (!sessionStr) {
      console.log('[BG Task] No session in storage');
      return;
    }

    const sessionData = JSON.parse(sessionStr);
    let accessToken = sessionData?.access_token;
    const refreshToken = sessionData?.refresh_token;

    // Check if token is expired or about to expire
    const expiresAt = sessionData?.expires_at;
    const now = Math.floor(Date.now() / 1000);
    const isExpired = expiresAt && now >= expiresAt;
    const expiringSoon = expiresAt && (expiresAt - now) < 300; // Less than 5 minutes left

    // Refresh token if expired or expiring soon
    if ((isExpired || expiringSoon) && refreshToken) {
      console.log('[BG Task] Token expired/expiring, refreshing...');

      const tempClient = createClient(
        'https://yincjogkjvotupzgetqg.supabase.co',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpbmNqb2dranZvdHVwemdldHFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5MTc2MTAsImV4cCI6MjA4ODQ5MzYxMH0._gxry5gqeBUFRz8la2IeHW8if1M1IdAHACMKUWy1las'
      );

      const { data: refreshData, error: refreshError } = await tempClient.auth.refreshSession({
        refresh_token: refreshToken
      });

      if (refreshError || !refreshData.session) {
        console.log('[BG Task] Token refresh failed:', refreshError?.message);
        return;
      }

      // Write back the refreshed session in the same format Supabase v2 expects
      accessToken = refreshData.session.access_token;
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(refreshData.session));
      console.log('[BG Task] Token refreshed successfully');
    }

    if (!accessToken) {
      console.log('[BG Task] No access token available');
      return;
    }

    // Create authenticated client with fresh token
    const client = createClient(
      'https://yincjogkjvotupzgetqg.supabase.co',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpbmNqb2dranZvdHVwemdldHFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5MTc2MTAsImV4cCI6MjA4ODQ5MzYxMH0._gxry5gqeBUFRz8la2IeHW8if1M1IdAHACMKUWy1las',
      { global: { headers: { Authorization: `Bearer ${accessToken}` } } }
    );

    const loc = locations[locations.length - 1];
    const { latitude, longitude, speed: rawSpeed } = loc.coords;

    // Only accumulate miles if mileage tracking is active
    // For fly trips, mileage starts at scheduled pickup time
    const bgMileageActive = !parsed.mileageStartTime || Date.now() >= parsed.mileageStartTime;

    let newMiles = miles;
    if (bgMileageActive && lastLat && lastLon) {
      // Calculate distance using Haversine formula
      const R = 3958.8; // Earth radius in miles
      const dLat = (latitude - lastLat) * Math.PI / 180;
      const dLon = (longitude - lastLon) * Math.PI / 180;
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(lastLat * Math.PI / 180) * Math.cos(latitude * Math.PI / 180) *
                Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      const distance = R * c;
      newMiles += distance;
    }

    // Speed tracking (rawSpeed is m/s, convert to mph)
    const speedNow = Date.now();
    // Fallback: calculate speed from distance if GPS speed unavailable (-1)
    let speedMph = 0;
    if (rawSpeed != null && rawSpeed >= 0) {
      speedMph = rawSpeed * 2.237;
    } else if (lastLat && lastLon && storedSpeedTime) {
      const R = 3958.8;
      const dLat2 = (latitude - lastLat) * Math.PI / 180;
      const dLon2 = (longitude - lastLon) * Math.PI / 180;
      const a2 = Math.sin(dLat2/2) * Math.sin(dLat2/2) +
                Math.cos(lastLat * Math.PI / 180) * Math.cos(latitude * Math.PI / 180) *
                Math.sin(dLon2/2) * Math.sin(dLon2/2);
      const dist = R * 2 * Math.atan2(Math.sqrt(a2), Math.sqrt(1-a2));
      const timeSec = (speedNow - storedSpeedTime) / 1000;
      if (timeSec > 0 && timeSec < 120) {
        speedMph = (dist / timeSec) * 3600;
      }
    }
    let topSpeed = storedTopSpeed || 0;
    let secondsOver80 = storedOver80 || 0;
    let secondsOver90 = storedOver90 || 0;

    // Cap at 150 mph — anything higher is a GPS teleport glitch
    if (speedMph > 150) speedMph = 0;

    if (bgMileageActive && speedMph > topSpeed) topSpeed = Math.round(speedMph);
    const elapsed = storedSpeedTime ? (speedNow - storedSpeedTime) / 1000 : 0;
    if (bgMileageActive && elapsed > 0 && elapsed < 120) {
      if (speedMph > 80) secondsOver80 += elapsed;
      if (speedMph > 90) secondsOver90 += elapsed;
    }

    // Stop tracking (under 5 mph = stopped) — writes to trip_stops table in real-time
    let bgStopId = parsed.currentStopId;
    if (speedMph < 5) {
      if (!bgStopStart) {
        bgStopStart = speedNow;
      } else if (!bgStopId && (speedNow - bgStopStart) >= 5 * 60 * 1000) {
        // Check for existing unclosed stop before creating a new one
        const { data: existingBgStop } = await client.from('trip_stops')
          .select('id')
          .eq('trip_id', tripId)
          .eq('driver_id', userId)
          .is('ended_at', null)
          .limit(1)
          .single();
        if (existingBgStop) {
          bgStopId = existingBgStop.id;
        } else {
          const { data: stopRow } = await client.from('trip_stops').insert({
            trip_id: tripId,
            driver_id: userId,
            latitude,
            longitude,
            started_at: new Date(bgStopStart).toISOString(),
          }).select('id').single();
          if (stopRow) bgStopId = stopRow.id;
        }
      }
    } else if (bgStopStart) {
      if (bgStopId) {
        const stopDuration = Math.round((speedNow - bgStopStart) / 60000);
        const { error: bgStopErr } = await client.from('trip_stops').update({
          ended_at: new Date().toISOString(),
          duration_minutes: stopDuration,
        }).eq('id', bgStopId);
        if (bgStopErr) console.log('[BG Task] Stop end failed:', bgStopErr.message);
        else console.log('[BG Task] Stop ended:', bgStopId, stopDuration + 'min');
      }
      bgStopId = null;
      bgStopStart = null;
    }

    // Write to database
    const { error: dbError } = await client.from('driver_locations').upsert({
      driver_id: userId,
      latitude,
      longitude,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'driver_id' });

    if (dbError) {
      console.log('[BG Task] DB write error:', dbError.message);
    } else {
      console.log('[BG Task] Location updated successfully');
    }

    // Update AsyncStorage
    await AsyncStorage.setItem('activeTrip', JSON.stringify({
      tripId, userId,
      lastLat: latitude,
      lastLon: longitude,
      miles: newMiles,
      startTime,
      topSpeed,
      secondsOver80,
      secondsOver90,
      lastSpeedTime: speedNow,
      currentStopId: bgStopId,
      currentStopStart: bgStopStart,
    }));

  } catch (e) {
    console.log('[BG Task] Error:', e.message);
  }
});

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

function statusColor(status) {
  if (status === 'pending') return colors.info;
  if (status === 'in_progress') return colors.primary;
  if (status === 'completed') return colors.success;
  return colors.textMuted;
}

function statusLabel(status) {
  if (status === 'pending') return 'PENDING';
  if (status === 'in_progress') return 'IN PROGRESS';
  if (status === 'completed') return 'AWAITING FINALIZATION';
  return status.toUpperCase();
}

function TripCard({ trip, currentUserId, onStart, onEnd, onPause, onResume, activeTrip, linkedInfo, unreadCount, onChatPress, onMileageSubmit, onPhotoUpload }) {
  const [showMileageInput, setShowMileageInput] = useState(false);
  const [vehicleMileage, setVehicleMileage] = useState('');
  const [mileageSaving, setMileageSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoCount, setPhotoCount] = useState(trip._photoCount || 0);
  const isDesignated = trip.designated_driver_id === currentUserId;
  const isActive = activeTrip?.id === trip.id;
  const isPaused = isActive && activeTrip.paused;

  const canStart = isDesignated && trip.status === 'pending' && !activeTrip;
  const canPause = isDesignated && trip.status === 'in_progress' && isActive && !isPaused;
  const canResume = isDesignated && trip.status === 'in_progress' && isActive && isPaused;
  const waitingForDesignated = !isDesignated && trip.trip_type === 'drive' && trip.status === 'pending';

  const px = 20; // consistent horizontal padding

  return (
    <View style={[s.card, { borderLeftColor: statusColor(trip.status), borderLeftWidth: 4, paddingVertical: 20, paddingHorizontal: 0 }]}>
      {/* ── Header ── */}
      <View style={{ paddingHorizontal: px, marginBottom: 16 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, color: colors.textTertiary, fontWeight: '600', fontFamily: 'monospace', marginBottom: 2 }}>{trip.carpage_id ?? trip.crm_id ?? '—'}</Text>
            <Text style={{ fontSize: 22, fontWeight: '900', color: colors.textPrimary, letterSpacing: 0.5 }}>{trip.trip_type === 'airport' ? `Airport Drop-off` : trip.city}</Text>
            {trip.trip_type === 'airport' && <Text style={{ fontSize: 14, color: colors.textTertiary, marginTop: 2 }}>{trip.city}</Text>}
          </View>
          <View style={[s.statusBadge, { borderColor: statusColor(trip.status) }]}>
            <Text style={[s.statusText, { color: statusColor(trip.status) }]}>
              {statusLabel(trip.status)}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 }}>
          <Text style={{ fontSize: 12, color: colors.textTertiary }}>{{ fly: '✈ FLY', drive: '🚗 DRIVE', aa: '🚐 AA', courier: '📦 COURIER', airport: '🛫 AIRPORT' }[trip.trip_type] || trip.trip_type}</Text>
          {trip.scheduled_pickup && (
            <Text style={{ fontSize: 12, color: colors.textMuted }}>
              {new Date(trip.scheduled_pickup).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </Text>
          )}
        </View>
      </View>

      {/* ── Notes ── */}
      {trip.notes && (
        <View style={{ marginHorizontal: px, marginBottom: 16, padding: 14, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: colors.border, borderRadius: 12 }}>
          <Text style={{ fontSize: 13, color: colors.textTertiary, lineHeight: 20 }}>{trip.notes}</Text>
        </View>
      )}

      {/* ── Linked driver ── */}
      {linkedInfo && (
        <View style={{ marginHorizontal: px, marginBottom: 16, padding: 12, backgroundColor: 'rgba(245,166,35,0.06)', borderWidth: 1, borderColor: 'rgba(245,166,35,0.15)', borderRadius: 10 }}>
          <Text style={{ fontSize: 13, color: colors.primary, fontWeight: '700' }}>
            {linkedInfo.label}: <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>{linkedInfo.name}</Text>
          </Text>
        </View>
      )}

      {/* ── Tracking status ── */}
      {isActive && !isPaused && (
        <View style={[s.liveRow, { marginHorizontal: px, marginBottom: 20, borderRadius: 10, paddingVertical: 14 }, activeTrip.stale && s.liveRowStale]}>
          <View style={[s.liveDot, activeTrip.stale && s.liveDotStale]} />
          <Text style={[s.liveText, activeTrip.stale && s.liveTextStale]}>
            {activeTrip.stale ? 'RECONNECTING...' : 'TRACKING'}
          </Text>
          <Text style={s.liveMiles}>{(activeTrip.miles ?? 0).toFixed(1)} mi  ·  {formatDuration(activeTrip.elapsed ?? 0)}</Text>
        </View>
      )}

      {isPaused && (
        <View style={[s.pausedRow, { marginHorizontal: px, marginBottom: 20, borderRadius: 10, paddingVertical: 14 }]}>
          <Text style={s.pausedIcon}>⏸</Text>
          <Text style={s.pausedText}>PAUSED</Text>
          <Text style={s.liveMiles}>{(activeTrip.miles ?? 0).toFixed(1)} mi  ·  {formatDuration(activeTrip.elapsed ?? 0)}</Text>
        </View>
      )}

      {/* ── Submitted mileage (editable) ── */}
      {trip.purchased_vehicle_mileage && (
        <TouchableOpacity
          style={{ marginHorizontal: px, marginBottom: 16, padding: 14, backgroundColor: 'rgba(245,166,35,0.06)', borderWidth: 1, borderColor: 'rgba(245,166,35,0.15)', borderRadius: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
          onPress={() => { setVehicleMileage(String(trip.purchased_vehicle_mileage)); setShowMileageInput(true); }}
        >
          <Text style={{ fontSize: 13, color: colors.textTertiary }}>Vehicle Odometer</Text>
          <Text style={{ fontSize: 15, color: colors.primary, fontWeight: '800' }}>{Number(trip.purchased_vehicle_mileage).toLocaleString()} mi ✎</Text>
        </TouchableOpacity>
      )}

      {/* ── Primary action ── */}
      {canStart && (
        <View style={{ paddingHorizontal: px, marginBottom: 16 }}>
          <TouchableOpacity style={[s.startBtn, { borderRadius: 12, paddingVertical: 16 }]} onPress={() => onStart(trip)}>
            <Text style={[s.startBtnText, { fontSize: 15 }]}>▶  START TRIP</Text>
          </TouchableOpacity>
        </View>
      )}

      {canPause && (
        <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: px, marginBottom: 16 }}>
          <TouchableOpacity style={[s.pauseBtn, { flex: 1, borderRadius: 12, paddingVertical: 16 }]} onPress={() => onPause(trip)}>
            <Text style={[s.pauseBtnText, { fontSize: 14 }]}>⏸  PAUSE</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.endBtn, { flex: 1, borderRadius: 12, paddingVertical: 16 }]} onPress={() => onEnd(trip)}>
            <Text style={[s.endBtnText, { fontSize: 14 }]}>⏹  END TRIP</Text>
          </TouchableOpacity>
        </View>
      )}

      {canResume && (
        <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: px, marginBottom: 16 }}>
          <TouchableOpacity style={[s.resumeBtn, { flex: 1, borderRadius: 12, paddingVertical: 16 }]} onPress={() => onResume(trip)}>
            <Text style={[s.resumeBtnText, { fontSize: 14 }]}>▶  RESUME</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.endBtn, { flex: 1, borderRadius: 12, paddingVertical: 16 }]} onPress={() => onEnd(trip)}>
            <Text style={[s.endBtnText, { fontSize: 14 }]}>⏹  END TRIP</Text>
          </TouchableOpacity>
        </View>
      )}

      {waitingForDesignated && (
        <View style={{ paddingHorizontal: px, marginBottom: 16 }}>
          <Text style={[s.waitingText, { textAlign: 'center', fontSize: 13 }]}>Waiting for designated driver to start</Text>
        </View>
      )}

      {activeTrip && !isActive && trip.status === 'pending' && (
        <View style={{ paddingHorizontal: px, marginBottom: 16 }}>
          <Text style={[s.waitingText, { textAlign: 'center', fontSize: 13 }]}>Another trip is currently active</Text>
        </View>
      )}

      {/* ── Separator ── */}
      <View style={{ height: 1, backgroundColor: colors.border, marginHorizontal: px, marginBottom: 16 }} />

      {/* ── Tools grid ── */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: px }}>
        {(trip.status === 'pending' || trip.status === 'in_progress') && (
          <TouchableOpacity
            style={{ flex: 1, minWidth: '45%', paddingVertical: 14, backgroundColor: 'rgba(59,130,246,0.08)', borderWidth: 1, borderColor: 'rgba(59,130,246,0.25)', borderRadius: 10, alignItems: 'center', gap: 4 }}
            onPress={() => {
              const destination = trip.destination_address || ((trip.notes || '').match(/Address:\s*(.+?)(?:\s*\||$)/) || [])[1]?.trim() || trip.city;
              Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`);
            }}
          >
            <Text style={{ fontSize: 20 }}>🧭</Text>
            <Text style={{ fontSize: 11, fontWeight: '700', color: '#3b82f6', letterSpacing: 1 }}>NAVIGATE</Text>
          </TouchableOpacity>
        )}

        {trip.status === 'in_progress' && !trip.purchased_vehicle_mileage && (!isDesignated || trip.trip_type === 'fly') && (
          <TouchableOpacity
            style={{ flex: 1, minWidth: '45%', paddingVertical: 14, backgroundColor: 'rgba(245,166,35,0.08)', borderWidth: 1, borderColor: 'rgba(245,166,35,0.2)', borderRadius: 10, alignItems: 'center', gap: 4 }}
            onPress={() => setShowMileageInput(true)}
          >
            <Text style={{ fontSize: 20 }}>📋</Text>
            <Text style={{ fontSize: 11, fontWeight: '700', color: colors.primary, letterSpacing: 1 }}>MILEAGE</Text>
          </TouchableOpacity>
        )}

        {trip.status === 'in_progress' && (!isDesignated || trip.trip_type === 'fly') && (
          <TouchableOpacity
            style={{ flex: 1, minWidth: '45%', paddingVertical: 14, backgroundColor: 'rgba(59,130,246,0.08)', borderWidth: 1, borderColor: 'rgba(59,130,246,0.25)', borderRadius: 10, alignItems: 'center', gap: 4, opacity: uploadingPhoto ? 0.5 : 1 }}
            onPress={async () => {
              setUploadingPhoto(true);
              const count = await onPhotoUpload(trip.id, currentUserId);
              if (count !== null) setPhotoCount(count);
              setUploadingPhoto(false);
            }}
            disabled={uploadingPhoto}
          >
            <Text style={{ fontSize: 20 }}>📸</Text>
            <Text style={{ fontSize: 11, fontWeight: '700', color: '#3b82f6', letterSpacing: 1 }}>{uploadingPhoto ? 'UPLOADING...' : `PHOTOS${photoCount > 0 ? ` (${photoCount})` : ''}`}</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={{ flex: 1, minWidth: '45%', paddingVertical: 14, backgroundColor: 'rgba(245,166,35,0.06)', borderWidth: 1, borderColor: 'rgba(245,166,35,0.15)', borderRadius: 10, alignItems: 'center', gap: 4 }}
          onPress={() => onChatPress(trip)}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={{ fontSize: 20 }}>💬</Text>
            {unreadCount > 0 && (
              <View style={s.chatBadge}>
                <Text style={s.chatBadgeText}>{unreadCount}</Text>
              </View>
            )}
          </View>
          <Text style={{ fontSize: 11, fontWeight: '700', color: colors.primary, letterSpacing: 1 }}>MESSAGES</Text>
        </TouchableOpacity>
      </View>

      {/* ── Mileage input overlay ── */}
      {showMileageInput && (
        <View style={{ marginHorizontal: 20, marginTop: 16, marginBottom: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 16 }}>
          <Text style={{ fontSize: 10, fontWeight: '700', color: colors.textTertiary, letterSpacing: 1.5, marginBottom: 8 }}>VEHICLE ODOMETER READING</Text>
          <TextInput
            style={{ backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12, color: colors.textPrimary, fontSize: 18, fontWeight: '700', textAlign: 'center' }}
            placeholder="Enter mileage"
            placeholderTextColor={colors.textMuted}
            keyboardType="decimal-pad"
            value={vehicleMileage}
            onChangeText={setVehicleMileage}
            autoFocus
          />
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
            <TouchableOpacity
              style={{ flex: 1, backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 12, alignItems: 'center', opacity: mileageSaving ? 0.5 : 1 }}
              onPress={async () => {
                if (!vehicleMileage) return;
                setMileageSaving(true);
                await onMileageSubmit(trip.id, Number(vehicleMileage));
                setMileageSaving(false);
                setShowMileageInput(false);
              }}
              disabled={mileageSaving}
            >
              <Text style={{ color: colors.bg, fontWeight: '800', fontSize: 13, letterSpacing: 1 }}>{mileageSaving ? 'SAVING...' : 'SUBMIT'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingVertical: 12, alignItems: 'center' }}
              onPress={() => { setShowMileageInput(false); setVehicleMileage(''); }}
            >
              <Text style={{ color: colors.textTertiary, fontWeight: '700', fontSize: 13 }}>CANCEL</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

export default function MyTripsScreen({ session, navigation }) {
  const { isTablet } = useResponsive();
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [activeTrip, setActiveTrip] = useState(null);
  const [unreadCounts, setUnreadCounts] = useState({});
  const [linkedDriverNames, setLinkedDriverNames] = useState({}); // tripId -> name

  const startTimeRef = useRef(null);
  const timerRef = useRef(null);
  const locationWatcherRef = useRef(null);
  const appStateRef = useRef(AppState.currentState);

  const AsyncStorage = require('@react-native-async-storage/async-storage').default;

  // ── Sync miles from background task storage ──────────────────────────────
  async function syncMilesFromStorage() {
    try {
      const stored = await AsyncStorage.getItem('activeTrip');
      if (!stored) return;
      const { miles } = JSON.parse(stored);
      setActiveTrip(prev => prev ? { ...prev, miles } : prev);
    } catch {}
  }

  // ── AppState listener to sync miles when foregrounded ────────────────────
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (appStateRef.current.match(/inactive|background/) && nextState === 'active') {
        syncMilesFromStorage();
      }
      appStateRef.current = nextState;
    });
    return () => sub.remove();
  }, []);

  // ── Cleanup on unmount ───────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (locationWatcherRef.current) locationWatcherRef.current.remove();
    };
  }, []);

  async function load() {
    setError(false);
    try {
      const userId = session.user.id;
      const { data, error: err } = await withTimeout(
        supabase
          .from('trips')
          .select('*')
          .or(`driver_id.eq.${userId},second_driver_id.eq.${userId}`)
          .in('status', ['pending', 'in_progress', 'completed'])
          .order('scheduled_pickup', { ascending: true }),
        TIMEOUT_MS
      );
      if (err) throw err;
      setTrips(data ?? []);

      // Resolve linked driver names (airport ↔ flyer)
      const linkedNames = {};
      const tripsData = data ?? [];
      for (const t of tripsData) {
        // Airport driver → show who they're driving
        if (t.trip_type === 'airport' && t.parent_trip_id) {
          const parent = tripsData.find((p) => p.id === t.parent_trip_id);
          if (parent) {
            const { data: prof } = await supabase.from('profiles').select('name').eq('id', parent.driver_id).single();
            if (prof) linkedNames[t.id] = { label: 'Driving to airport', name: prof.name };
          } else {
            const { data: parentTrip } = await supabase.from('trips').select('driver_id').eq('id', t.parent_trip_id).single();
            if (parentTrip) {
              const { data: prof } = await supabase.from('profiles').select('name').eq('id', parentTrip.driver_id).single();
              if (prof) linkedNames[t.id] = { label: 'Driving to airport', name: prof.name };
            }
          }
        }
        // Flyer → check if there's an airport driver linked
        if (t.trip_type === 'fly') {
          const { data: airportTrips } = await supabase
            .from('trips')
            .select('driver_id')
            .eq('parent_trip_id', t.id)
            .eq('trip_type', 'airport')
            .limit(1);
          if (airportTrips && airportTrips.length > 0) {
            const { data: prof } = await supabase.from('profiles').select('name').eq('id', airportTrips[0].driver_id).single();
            if (prof) linkedNames[t.id] = { label: 'Airport driver', name: prof.name };
          }
        }
      }
      setLinkedDriverNames(linkedNames);

      // Rehydrate activeTrip if there's an in_progress trip
      const inProgress = (data ?? []).find(
        t => t.status === 'in_progress' && t.designated_driver_id === userId
      );
      if (inProgress) {
        // Check if background task has stored state
        const stored = await AsyncStorage.getItem('activeTrip');
        const storedData = stored ? JSON.parse(stored) : null;
        const miles = storedData?.miles ?? inProgress.miles ?? 0;
        const startTime = storedData?.startTime ?? Date.now();
        startTimeRef.current = startTime;

        const isPaused = storedData?.paused ?? false;
        let elapsed;
        if (isPaused && storedData?.pausedAt) {
          // Show only active time, not pause time
          elapsed = Math.floor((storedData.pausedAt - startTime) / 1000);
        } else {
          elapsed = Math.floor((Date.now() - startTime) / 1000);
        }
        setActiveTrip({ id: inProgress.id, miles, elapsed, paused: isPaused });

        // Restart elapsed timer (only if not paused)
        if (!isPaused) {
          if (timerRef.current) clearInterval(timerRef.current);
          timerRef.current = setInterval(() => {
            setActiveTrip(prev => {
              if (!prev) return prev;
              const isStale = prev.lastGps && (Date.now() - prev.lastGps) > 60000;
              return {
                ...prev,
                elapsed: Math.floor((Date.now() - startTimeRef.current) / 1000),
                stale: isStale,
              };
            });
          }, 1000);
        }
      }

      loadUnreadCounts(data ?? []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function loadUnreadCounts(tripList) {
    const userId = session.user.id;
    const tripIds = tripList.map(t => t.id);
    if (tripIds.length === 0) return;

    const { data: messages } = await supabase
      .from('trip_messages')
      .select('trip_id, sender_id')
      .in('trip_id', tripIds);

    if (!messages) return;

    const counts = {};
    messages.forEach(msg => {
      if (msg.sender_id !== userId) {
        counts[msg.trip_id] = (counts[msg.trip_id] || 0) + 1;
      }
    });

    setUnreadCounts(counts);
  }

  useEffect(() => {
    load();

    // Realtime: refresh when trips are created/updated/assigned
    const subscription = supabase
      .channel('driver_trips')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trips' },
        (payload) => {
          const row = payload.new || payload.old;
          const userId = session.user.id;
          // Only reload if this trip involves the current driver
          if (row?.driver_id === userId || row?.second_driver_id === userId) {
            load();
          }
        }
      )
      .subscribe();

    return () => { subscription.unsubscribe(); };
  }, []);
  function onRefresh() { setRefreshing(true); load(); }

  // ── GPS helpers ──────────────────────────────────────────────────────────
  const requestPermissions = async () => {
    const { status: fg } = await Location.requestForegroundPermissionsAsync();
    if (fg !== 'granted') {
      Alert.alert('Permission Required', 'Location access is needed to track your trip.');
      return false;
    }
    const { status: bg } = await Location.requestBackgroundPermissionsAsync();
    if (bg !== 'granted') {
      Alert.alert('Background Location Required', 'Please allow "Always" location access in Settings so the app can track miles when your screen is locked.', [{ text: 'OK' }]);
      return false;
    }
    return true;
  };

  const clearLiveLocation = async () => {
    if (!session?.user?.id) return;
    await supabase.from('driver_locations').delete().eq('driver_id', session.user.id);
  };

  // ── Notify admins of trip status change (fire-and-forget) ──
  async function handlePhotoUpload(tripId, driverId) {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        quality: 0.7,
        base64: true,
      });
      if (result.canceled || !result.assets || result.assets.length === 0) return null;

      for (const asset of result.assets) {
        const ext = asset.uri.split('.').pop()?.toLowerCase() || 'jpg';
        const fileName = `${tripId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

        // Use base64 from image picker and decode to ArrayBuffer
        if (!asset.base64) {
          console.log('[Photo] No base64 data for asset, skipping');
          continue;
        }

        const { error: uploadErr } = await supabase.storage
          .from('vehicle-photos')
          .upload(fileName, decode(asset.base64), { cacheControl: '3600', contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}` });

        if (uploadErr) {
          console.log('[Photo] Upload failed:', uploadErr.message);
          continue;
        }

        await supabase.from('vehicle_photos').insert({
          trip_id: tripId,
          driver_id: driverId,
          storage_path: fileName,
        });
      }

      // Return updated count
      const { count } = await supabase
        .from('vehicle_photos')
        .select('id', { count: 'exact', head: true })
        .eq('trip_id', tripId);
      return count || 0;
    } catch (e) {
      Alert.alert('Upload Failed', e.message);
      return null;
    }
  }

  async function handleMileageSubmit(tripId, mileage) {
    const { error } = await supabase
      .from('trips')
      .update({ purchased_vehicle_mileage: mileage })
      .eq('id', tripId);
    if (error) {
      Alert.alert('Failed', error.message);
      return;
    }
    // Update local state
    setTrips(prev => prev.map(t => t.id === tripId ? { ...t, purchased_vehicle_mileage: mileage } : t));
  }

  function notifyTripStatus(tripId, action) {
    fetch('https://yincjogkjvotupzgetqg.supabase.co/functions/v1/notify-trip-status', {
      method: 'POST',
      headers: {
        apikey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpbmNqb2dranZvdHVwemdldHFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5MTc2MTAsImV4cCI6MjA4ODQ5MzYxMH0._gxry5gqeBUFRz8la2IeHW8if1M1IdAHACMKUWy1las',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ trip_id: tripId, driver_id: session.user.id, action }),
    }).catch(() => {}); // Silent fail — don't block trip flow
  }

  // ── Start trip ───────────────────────────────────────────────────────────
  async function handleStart(trip) {
    const permitted = await requestPermissions();
    if (!permitted) return;

    const { error: err } = await supabase
      .from('trips')
      .update({ status: 'in_progress', actual_start: new Date().toISOString() })
      .eq('id', trip.id);

    if (err) { Alert.alert('Failed to start trip', err.message); return; }

    notifyTripStatus(trip.id, 'started');

    const startTime = Date.now();
    startTimeRef.current = startTime;

    // Update UI immediately — don't wait for GPS/background task startup
    setActiveTrip({ id: trip.id, miles: 0, elapsed: 0 });
    setTrips(prev => prev.map(t => t.id === trip.id ? { ...t, status: 'in_progress' } : t));

    // Start elapsed timer
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setActiveTrip(prev => {
        if (!prev) return prev;
        const isStale = prev.lastGps && (Date.now() - prev.lastGps) > 60000;
        return {
          ...prev,
          elapsed: Math.floor((Date.now() - startTimeRef.current) / 1000),
          stale: isStale,
        };
      });
    }, 1000);

    // Store trip state in AsyncStorage for background task
    const mileageStartTime = trip.trip_type === 'fly' && trip.scheduled_pickup
      ? new Date(trip.scheduled_pickup).getTime()
      : null; // null = start counting immediately (drive trips)

    await AsyncStorage.setItem('activeTrip', JSON.stringify({
      tripId: trip.id,
      userId: session.user.id,
      lastLat: null,
      lastLon: null,
      miles: 0,
      startTime,
      topSpeed: 0,
      secondsOver80: 0,
      secondsOver90: 0,
      lastSpeedTime: null,
      currentStopId: null,
      currentStopStart: null,
      tripType: trip.trip_type,
      mileageStartTime,
    }));

    // Foreground watcher — pushes live location to driver_locations while app is open.
    // This is the reliable path for the Live Drivers admin view; the background task
    // (below) takes over if iOS kills the JS runtime.
    if (locationWatcherRef.current) locationWatcherRef.current.remove();
    locationWatcherRef.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 10000, distanceInterval: 0 },
      async (loc) => {
        const { latitude, longitude, speed: rawSpeed } = loc.coords;

        // Push live location to DB for admin Live Drivers view
        await supabase.from('driver_locations').upsert({
          driver_id: session.user.id,
          latitude,
          longitude,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'driver_id' });

        // Accumulate miles and speed data in AsyncStorage
        try {
          const stored = await AsyncStorage.getItem('activeTrip');
          if (!stored) return;
          const tripData = JSON.parse(stored);
          let newMiles = tripData.miles || 0;

          // Only accumulate miles if mileage tracking is active
          // For fly trips, mileage starts at scheduled pickup time
          const mileageActive = !tripData.mileageStartTime || Date.now() >= tripData.mileageStartTime;

          if (mileageActive && tripData.lastLat && tripData.lastLon) {
            newMiles += getDistanceMiles(tripData.lastLat, tripData.lastLon, latitude, longitude);
          }

          // Speed tracking (rawSpeed is m/s, convert to mph)
          const now = Date.now();
          // Fallback: calculate speed from distance if GPS speed unavailable (-1)
          let speedMph = 0;
          if (rawSpeed != null && rawSpeed >= 0) {
            speedMph = rawSpeed * 2.237;
          } else if (tripData.lastLat && tripData.lastLon && tripData.lastSpeedTime) {
            const dist = getDistanceMiles(tripData.lastLat, tripData.lastLon, latitude, longitude);
            const timeSec = (now - tripData.lastSpeedTime) / 1000;
            if (timeSec > 0 && timeSec < 120) {
              speedMph = (dist / timeSec) * 3600;
            }
          }
          // Cap at 150 mph — anything higher is a GPS teleport glitch
          if (speedMph > 150) speedMph = 0;

          let topSpeed = tripData.topSpeed || 0;
          let secondsOver80 = tripData.secondsOver80 || 0;
          let secondsOver90 = tripData.secondsOver90 || 0;

          // Only track speed metrics after mileage is active
          if (mileageActive && speedMph > topSpeed) topSpeed = Math.round(speedMph);
          const elapsed = tripData.lastSpeedTime ? (now - tripData.lastSpeedTime) / 1000 : 0;
          if (mileageActive && elapsed > 0 && elapsed < 120) {
            if (speedMph > 80) secondsOver80 += elapsed;
            if (speedMph > 90) secondsOver90 += elapsed;
          }

          // Stop tracking (under 5 mph = stopped) — writes to trip_stops table in real-time
          let currentStopId = tripData.currentStopId;
          let currentStopStart = tripData.currentStopStart;

          if (speedMph < 5) {
            if (!currentStopStart) {
              currentStopStart = now;
            } else if (!currentStopId && (now - currentStopStart) >= 5 * 60 * 1000) {
              // Check for existing unclosed stop before creating a new one
              const { data: existingStop } = await supabase.from('trip_stops')
                .select('id')
                .eq('trip_id', tripData.tripId)
                .eq('driver_id', session.user.id)
                .is('ended_at', null)
                .limit(1)
                .single();
              if (existingStop) {
                currentStopId = existingStop.id;
              } else {
                const { data: stopRow } = await supabase.from('trip_stops').insert({
                  trip_id: tripData.tripId,
                  driver_id: session.user.id,
                  latitude,
                  longitude,
                  started_at: new Date(currentStopStart).toISOString(),
                }).select('id').single();
                if (stopRow) currentStopId = stopRow.id;
              }
            }
          } else if (currentStopStart) {
            // Movement resumed — end the stop
            if (currentStopId) {
              const stopDuration = Math.round((now - currentStopStart) / 60000);
              const { error: stopEndErr } = await supabase.from('trip_stops').update({
                ended_at: new Date().toISOString(),
                duration_minutes: stopDuration,
              }).eq('id', currentStopId);
              if (stopEndErr) console.log('[Stop] End failed:', stopEndErr.message);
            }
            currentStopId = null;
            currentStopStart = null;
          }

          await AsyncStorage.setItem('activeTrip', JSON.stringify({
            ...tripData,
            lastLat: latitude,
            lastLon: longitude,
            miles: newMiles,
            topSpeed,
            secondsOver80,
            secondsOver90,
            lastSpeedTime: now,
            currentStopId,
            currentStopStart,
          }));

          // Update UI with new miles
          setActiveTrip(prev => prev ? { ...prev, miles: newMiles, stale: false, lastGps: Date.now() } : prev);
        } catch {}
      }
    );

    // Background task — survives iOS runtime kills
    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      accuracy: Location.Accuracy.BestForNavigation,
      activityType: Location.ActivityType.AutomotiveNavigation,
      timeInterval: 10000,
      distanceInterval: 0,
      foregroundService: {
        notificationTitle: 'Trip in Progress',
        notificationBody: 'Discovery Driver Portal is tracking your location.',
        notificationColor: '#f5a623',
      },
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
    });

    // Register significant location change as safety net
    // iOS will wake the app even if terminated when driver moves ~500m
    try {
      const isSLC = await Location.hasStartedLocationUpdatesAsync(SIGNIFICANT_CHANGE_TASK);
      if (!isSLC) {
        await Location.startLocationUpdatesAsync(SIGNIFICANT_CHANGE_TASK, {
          accuracy: Location.Accuracy.Lowest,
          distanceInterval: 500,
          deferredUpdatesInterval: 60000,
          foregroundService: {
            notificationTitle: 'Trip in Progress',
            notificationBody: 'Discovery Driver Portal is tracking your location.',
            notificationColor: '#f5a623',
          },
        });
        console.log('[SLC] Safety net registered');
      }
    } catch (e) {
      console.log('[SLC] Registration failed:', e.message);
    }
  }

  // ── Pause trip ───────────────────────────────────────────────────────────
  async function handlePause(trip) {
    // Stop foreground watcher
    if (locationWatcherRef.current) { locationWatcherRef.current.remove(); locationWatcherRef.current = null; }
    // Stop background task + SLC
    try {
      const isTracking = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
      if (isTracking) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    } catch {}
    try {
      const isSLC = await Location.hasStartedLocationUpdatesAsync(SIGNIFICANT_CHANGE_TASK);
      if (isSLC) await Location.stopLocationUpdatesAsync(SIGNIFICANT_CHANGE_TASK);
    } catch {}
    // Stop elapsed timer
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    // Clear live location from map
    await supabase.from('driver_locations').delete().eq('driver_id', session.user.id);
    // Finalize any active stop
    const stored = await AsyncStorage.getItem('activeTrip');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.currentStopId) {
        const stopDuration = Math.round((Date.now() - parsed.currentStopStart) / 60000);
        await supabase.from('trip_stops').update({
          ended_at: new Date().toISOString(),
          duration_minutes: stopDuration,
        }).eq('id', parsed.currentStopId);
      }
      // Mark as paused in AsyncStorage
      await AsyncStorage.setItem('activeTrip', JSON.stringify({
        ...parsed,
        paused: true,
        pausedAt: Date.now(),
        currentStopId: null,
        currentStopStart: null,
      }));
    }
    setActiveTrip(prev => prev ? { ...prev, paused: true } : prev);
    notifyTripStatus(trip.id, 'paused');
    // Direct write instead of queue — pause events are critical for ops
    await supabase.from('system_logs').insert({
      source: 'mobile', level: 'info', event: 'trip_paused',
      message: `Trip to ${trip.city} paused`,
      metadata: { trip_id: trip.id, driver_id: session.user.id },
      created_at: new Date().toISOString(),
    });
  }

  // ── Resume trip ─────────────────────────────────────────────────────────
  async function handleResume(trip) {
    const permitted = await requestPermissions();
    if (!permitted) return;

    const stored = await AsyncStorage.getItem('activeTrip');
    if (!stored) return;
    const parsed = JSON.parse(stored);

    // Adjust start time to account for pause duration
    const pauseDuration = parsed.pausedAt ? (Date.now() - parsed.pausedAt) : 0;
    const adjustedStartTime = parsed.startTime + pauseDuration;

    // Unpause in AsyncStorage
    await AsyncStorage.setItem('activeTrip', JSON.stringify({
      ...parsed,
      paused: false,
      pausedAt: null,
      startTime: adjustedStartTime,
    }));

    setActiveTrip(prev => prev ? { ...prev, paused: false, stale: false } : prev);

    // Restart elapsed timer
    startTimeRef.current = adjustedStartTime;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setActiveTrip(prev => {
        if (!prev) return prev;
        const isStale = prev.lastGps && (Date.now() - prev.lastGps) > 60000;
        return {
          ...prev,
          elapsed: Math.floor((Date.now() - startTimeRef.current) / 1000),
          stale: isStale,
        };
      });
    }, 1000);

    // Restart foreground watcher
    if (locationWatcherRef.current) locationWatcherRef.current.remove();
    locationWatcherRef.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 10000, distanceInterval: 0 },
      async (loc) => {
        const { latitude, longitude, speed: rawSpeed } = loc.coords;
        await supabase.from('driver_locations').upsert({
          driver_id: session.user.id,
          latitude,
          longitude,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'driver_id' });

        try {
          const tripStored = await AsyncStorage.getItem('activeTrip');
          if (!tripStored) return;
          const tripData = JSON.parse(tripStored);
          if (tripData.paused) return;

          const resumeMileageActive = !tripData.mileageStartTime || Date.now() >= tripData.mileageStartTime;

          let newMiles = tripData.miles || 0;
          if (resumeMileageActive && tripData.lastLat && tripData.lastLon) {
            newMiles += getDistanceMiles(tripData.lastLat, tripData.lastLon, latitude, longitude);
          }

          let speedMph = 0;
          const now = Date.now();
          if (rawSpeed != null && rawSpeed >= 0) {
            speedMph = rawSpeed * 2.237;
          } else if (tripData.lastLat && tripData.lastLon && tripData.lastSpeedTime) {
            const dist = getDistanceMiles(tripData.lastLat, tripData.lastLon, latitude, longitude);
            const timeSec = (now - tripData.lastSpeedTime) / 1000;
            if (timeSec > 0 && timeSec < 120) speedMph = (dist / timeSec) * 3600;
          }

          // Cap at 150 mph — anything higher is a GPS teleport glitch
          if (speedMph > 150) speedMph = 0;

          let topSpeed = tripData.topSpeed || 0;
          let secondsOver80 = tripData.secondsOver80 || 0;
          let secondsOver90 = tripData.secondsOver90 || 0;
          if (resumeMileageActive && speedMph > topSpeed) topSpeed = Math.round(speedMph);
          const elapsed = tripData.lastSpeedTime ? (now - tripData.lastSpeedTime) / 1000 : 0;
          if (resumeMileageActive && elapsed > 0 && elapsed < 120) {
            if (speedMph > 80) secondsOver80 += elapsed;
            if (speedMph > 90) secondsOver90 += elapsed;
          }

          let currentStopId = tripData.currentStopId;
          let currentStopStart = tripData.currentStopStart;
          if (speedMph < 5) {
            if (!currentStopStart) currentStopStart = now;
            else if (!currentStopId && (now - currentStopStart) >= 5 * 60 * 1000) {
              const { data: existingResumeStop } = await supabase.from('trip_stops')
                .select('id')
                .eq('trip_id', tripData.tripId)
                .eq('driver_id', session.user.id)
                .is('ended_at', null)
                .limit(1)
                .single();
              if (existingResumeStop) {
                currentStopId = existingResumeStop.id;
              } else {
                const { data: stopRow } = await supabase.from('trip_stops').insert({
                  trip_id: tripData.tripId, driver_id: session.user.id,
                  latitude, longitude, started_at: new Date(currentStopStart).toISOString(),
                }).select('id').single();
                if (stopRow) currentStopId = stopRow.id;
              }
            }
          } else if (currentStopStart) {
            if (currentStopId) {
              await supabase.from('trip_stops').update({
                ended_at: new Date().toISOString(),
                duration_minutes: Math.round((now - currentStopStart) / 60000),
              }).eq('id', currentStopId);
            }
            currentStopId = null;
            currentStopStart = null;
          }

          await AsyncStorage.setItem('activeTrip', JSON.stringify({
            ...tripData, lastLat: latitude, lastLon: longitude, miles: newMiles,
            topSpeed, secondsOver80, secondsOver90, lastSpeedTime: now,
            currentStopId, currentStopStart,
          }));
          setActiveTrip(prev => prev ? { ...prev, miles: newMiles, stale: false, lastGps: Date.now() } : prev);
        } catch {}
      }
    );

    // Restart background task
    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      accuracy: Location.Accuracy.BestForNavigation,
      activityType: Location.ActivityType.AutomotiveNavigation,
      timeInterval: 10000,
      distanceInterval: 0,
      foregroundService: {
        notificationTitle: 'Trip in Progress',
        notificationBody: 'Discovery Driver Portal is tracking your location.',
        notificationColor: '#f5a623',
      },
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
    });

    // Re-register SLC safety net
    try {
      const isSLC = await Location.hasStartedLocationUpdatesAsync(SIGNIFICANT_CHANGE_TASK);
      if (!isSLC) {
        await Location.startLocationUpdatesAsync(SIGNIFICANT_CHANGE_TASK, {
          accuracy: Location.Accuracy.Lowest,
          distanceInterval: 500,
          deferredUpdatesInterval: 60000,
          foregroundService: {
            notificationTitle: 'Trip in Progress',
            notificationBody: 'Discovery Driver Portal is tracking your location.',
            notificationColor: '#f5a623',
          },
        });
      }
    } catch {}

    notifyTripStatus(trip.id, 'resumed');
    await supabase.from('system_logs').insert({
      source: 'mobile', level: 'info', event: 'trip_resumed',
      message: `Trip to ${trip.city} resumed`,
      metadata: { trip_id: trip.id, driver_id: session.user.id },
      created_at: new Date().toISOString(),
    });
  }

  // ── End trip ─────────────────────────────────────────────────────────────
  async function handleEnd(trip) {
    Alert.alert(
      'End Trip?',
      'This will stop GPS tracking and mark the trip as complete.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End Trip', style: 'destructive', onPress: async () => {
            // Check if trip was already ended (e.g. by geofence auto-end)
            const { data: currentTrip } = await supabase
              .from('trips')
              .select('status')
              .eq('id', trip.id)
              .single();

            if (currentTrip?.status === 'completed' || currentTrip?.status === 'finalized') {
              // Trip already ended — just clean up local state
              if (locationWatcherRef.current) { locationWatcherRef.current.remove(); locationWatcherRef.current = null; }
              try {
                const isTracking = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
                if (isTracking) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
              } catch {}
              try {
                const isSLC = await Location.hasStartedLocationUpdatesAsync(SIGNIFICANT_CHANGE_TASK);
                if (isSLC) await Location.stopLocationUpdatesAsync(SIGNIFICANT_CHANGE_TASK);
              } catch {}
              if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
              await AsyncStorage.removeItem('activeTrip');
              setActiveTrip(null);
              load();
              Alert.alert('Trip Already Ended', 'This trip was automatically ended when you arrived at the dealership.');
              return;
            }

            // Stop foreground watcher, background task, and SLC safety net
            if (locationWatcherRef.current) { locationWatcherRef.current.remove(); locationWatcherRef.current = null; }
            const isTracking = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
            if (isTracking) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
            try {
              const isSLC = await Location.hasStartedLocationUpdatesAsync(SIGNIFICANT_CHANGE_TASK);
              if (isSLC) await Location.stopLocationUpdatesAsync(SIGNIFICANT_CHANGE_TASK);
            } catch {}

            if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
            clearLiveLocation();

            // Get final miles and speed data from AsyncStorage
            let finalMiles = 0;
            let finalDriveTime = 0;
            let speedData = null;
            try {
              const stored = await AsyncStorage.getItem('activeTrip');
              if (!stored) {
                // AsyncStorage already cleared — geofence likely already ended this trip
                const { data: recheck } = await supabase.from('trips').select('status').eq('id', trip.id).single();
                if (recheck?.status === 'completed' || recheck?.status === 'finalized') {
                  setActiveTrip(null);
                  load();
                  Alert.alert('Trip Already Ended', 'This trip was automatically ended when you arrived at the dealership.');
                  return;
                }
              }
              if (stored) {
                const parsed = JSON.parse(stored);
                finalMiles = parseFloat(parsed.miles.toFixed(1));
                finalDriveTime = parseFloat(((Date.now() - parsed.startTime) / 3600000).toFixed(2));

                // Subtract stop time from drive time for avg speed calc
                const { data: tripStops } = await supabase
                  .from('trip_stops')
                  .select('duration_minutes')
                  .eq('trip_id', trip.id);
                const totalStopMinutes = (tripStops ?? []).reduce((s, st) => s + (st.duration_minutes || 0), 0);
                const activeDriveTime = Math.max(0.1, finalDriveTime - (totalStopMinutes / 60));
                const avgSpeed = activeDriveTime > 0 ? Math.round(finalMiles / activeDriveTime) : 0;
                // Finalize any in-progress stop in the DB
                if (parsed.currentStopId) {
                  const stopDuration = Math.round((Date.now() - parsed.currentStopStart) / 60000);
                  await supabase.from('trip_stops').update({
                    ended_at: new Date().toISOString(),
                    duration_minutes: stopDuration,
                  }).eq('id', parsed.currentStopId);
                }
                speedData = {
                  top_speed: parsed.topSpeed || 0,
                  avg_speed: avgSpeed,
                  seconds_over_80: Math.round(parsed.secondsOver80 || 0),
                  seconds_over_90: Math.round(parsed.secondsOver90 || 0),
                };
              }
            } catch {}

            await AsyncStorage.removeItem('activeTrip');

            const tripUpdate = {
              status: 'completed',
              actual_end: new Date().toISOString(),
              miles: finalMiles,
              hours: finalDriveTime,
            };
            if (speedData) tripUpdate.speed_data = speedData;

            const { error: err } = await supabase
              .from('trips')
              .update(tripUpdate)
              .eq('id', trip.id);

            if (err) { Alert.alert('Failed to end trip', err.message); return; }

            // Safety net: close any unclosed stops for this trip
            await supabase.from('trip_stops')
              .update({ ended_at: new Date().toISOString(), duration_minutes: 0 })
              .eq('trip_id', trip.id)
              .is('ended_at', null);

            notifyTripStatus(trip.id, 'ended');

            setActiveTrip(null);
            setTrips(prev => prev.map(t =>
              t.id === trip.id
                ? { ...t, status: 'completed', miles: finalMiles, hours: finalDriveTime }
                : t
            ));
          }
        },
      ]
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────
  if (loading) return <View style={s.center}><ActivityIndicator color={colors.primary} /></View>;

  if (error) return (
    <View style={s.center}>
      <Text style={s.errorText}>Failed to load trips</Text>
      <TouchableOpacity style={s.retryBtn} onPress={() => { setLoading(true); load(); }}>
        <Text style={s.retryText}>RETRY</Text>
      </TouchableOpacity>
    </View>
  );

  const activeTrips = trips.filter(t => t.status === 'pending' || t.status === 'in_progress');
  const completedTrips = trips.filter(t => t.status === 'completed');

  return (
    <ScrollView
      style={s.container}
      contentContainerStyle={[s.content, { maxWidth: 700, alignSelf: 'center', width: '100%' }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      {activeTrips.length === 0 && completedTrips.length === 0 && (
        <View style={s.empty}>
          <Text style={s.emptyTitle}>NO TRIPS ASSIGNED</Text>
          <Text style={s.emptySub}>Your admin will assign trips here</Text>
        </View>
      )}

      {activeTrips.length > 0 && (
        <>
          <Text style={s.sectionTitle}>YOUR TRIPS</Text>
          {activeTrips.map(trip => (
            <TripCard
              key={trip.id}
              trip={trip}
              currentUserId={session.user.id}
              onStart={handleStart}
              onEnd={handleEnd}
              onPause={handlePause}
              onResume={handleResume}
              activeTrip={activeTrip}
              linkedInfo={linkedDriverNames[trip.id]}
              onMileageSubmit={handleMileageSubmit}
              onPhotoUpload={handlePhotoUpload}
              unreadCount={unreadCounts[trip.id] || 0}
              onChatPress={(selectedTrip) => {
                navigation.navigate('TripChat', {
                  trip: selectedTrip,
                  currentUser: { id: session.user.id, name: 'You' },
                  allProfiles: [],
                });
              }}
            />
          ))}
        </>
      )}

      {completedTrips.length > 0 && (
        <>
          <Text style={s.sectionTitle}>COMPLETED</Text>
          {completedTrips.map(trip => (
            <TripCard
              key={trip.id}
              trip={trip}
              currentUserId={session.user.id}
              onStart={handleStart}
              onEnd={handleEnd}
              onPause={handlePause}
              onResume={handleResume}
              activeTrip={activeTrip}
              linkedInfo={linkedDriverNames[trip.id]}
              onMileageSubmit={handleMileageSubmit}
              onPhotoUpload={handlePhotoUpload}
              unreadCount={unreadCounts[trip.id] || 0}
              onChatPress={(selectedTrip) => {
                navigation.navigate('TripChat', {
                  trip: selectedTrip,
                  currentUser: { id: session.user.id, name: 'You' },
                  allProfiles: [],
                });
              }}
            />
          ))}
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { ...components.screen },
  content: { padding: spacing.xl, paddingTop: 60, paddingBottom: spacing.xxxxl },
  center: { ...components.center },
  sectionTitle: { ...components.sectionTitle },

  card: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderLeftWidth: 3, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.md,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.sm },
  cardHeaderLeft: { flex: 1 },
  cardCrm: { ...typography.caption, color: colors.textTertiary, letterSpacing: 1, marginBottom: 2 },
  cardCity: { ...typography.displaySm, fontSize: 20, color: colors.textPrimary },
  statusBadge: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, marginLeft: spacing.sm },
  statusText: { ...typography.labelSm, letterSpacing: 1.5 },

  cardMeta: { flexDirection: 'row', gap: spacing.lg, marginBottom: spacing.sm },
  metaItem: { ...typography.captionSm, color: colors.textTertiary },
  notes: { ...typography.bodySm, fontSize: 12, color: colors.textTertiary, fontStyle: 'italic', marginBottom: spacing.sm, marginTop: spacing.xs },

  liveRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginTop: spacing.sm, marginBottom: spacing.xs,
    backgroundColor: colors.successDim, borderRadius: radius.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderWidth: 1, borderColor: colors.successBorder,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  liveDotStale: { backgroundColor: colors.warning },
  liveText: { ...typography.labelSm, fontSize: 10, color: colors.success, letterSpacing: 2 },
  liveTextStale: { color: colors.warning },
  liveRowStale: { backgroundColor: colors.warningDim, borderColor: colors.warningBorder },
  liveMiles: { ...typography.caption, color: colors.textSecondary, marginLeft: spacing.xs },

  startBtn: { backgroundColor: colors.primary, borderRadius: radius.sm, padding: spacing.md, alignItems: 'center', marginTop: spacing.md },
  startBtnText: { color: colors.bg, fontWeight: '900', fontSize: 13, letterSpacing: 2 },
  tripActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  pauseBtn: { flex: 1, borderWidth: 2, borderColor: colors.warning, borderRadius: radius.sm, padding: spacing.md, alignItems: 'center' },
  pauseBtnText: { color: colors.warning, fontWeight: '900', fontSize: 13, letterSpacing: 2 },
  resumeBtn: { flex: 1, backgroundColor: colors.success, borderRadius: radius.sm, padding: spacing.md, alignItems: 'center' },
  resumeBtnText: { color: colors.bg, fontWeight: '900', fontSize: 13, letterSpacing: 2 },
  endBtn: { flex: 1, borderWidth: 2, borderColor: colors.error, borderRadius: radius.sm, padding: spacing.md, alignItems: 'center' },
  endBtnText: { color: colors.error, fontWeight: '900', fontSize: 13, letterSpacing: 2 },
  pausedRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginTop: spacing.sm, marginBottom: spacing.xs,
    backgroundColor: colors.warningDim, borderRadius: radius.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderWidth: 1, borderColor: colors.warningBorder,
  },
  pausedIcon: { fontSize: 14 },
  pausedText: { ...typography.labelSm, fontSize: 10, color: colors.warning, letterSpacing: 2 },
  waitingText: { ...typography.captionSm, color: colors.textMuted, fontStyle: 'italic', marginTop: spacing.md, textAlign: 'center' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyTitle: { ...typography.h3, fontSize: 16, fontWeight: '900', color: colors.textMuted, letterSpacing: 2, marginBottom: spacing.sm },
  emptySub: { ...typography.bodySm, fontSize: 12, color: colors.textTertiary },

  errorText: { ...components.errorText },
  retryBtn: { ...components.retryBtn },
  retryText: { ...components.retryText },

  chatRow: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#1e1e1e',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  chatBtn: {
    position: 'relative',
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: 'rgba(245, 166, 35, 0.1)',
    borderWidth: 1,
    borderColor: '#f5a623',
    borderRadius: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chatIcon: {
    fontSize: 16,
  },
  chatBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#f5a623',
    letterSpacing: 1,
  },
  chatBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: '#ef4444',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  chatBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },
});