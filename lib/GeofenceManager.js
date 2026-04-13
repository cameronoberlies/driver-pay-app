// GEOFENCE MANAGER - PRODUCTION VERSION
// File: /lib/geofenceManager.js

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const GEOFENCE_TASK = 'dealership-geofence-task';

// Discovery Automotive - Shelby, NC
const DEALERSHIP_COORDS = {
  latitude: 35.270366805900295,
  longitude: -81.49624707303701,
  radius: 250, // 250 meters — iOS needs 200m+ for reliable geofence triggers
};

// Outer geofence for gas reminder (~10 miles / 16km)
const GAS_REMINDER_RADIUS = 16000; // 16km ≈ 10 miles

// ─── GEOFENCE TASK DEFINITION ───────────────────────────────────────────────────
// Runs natively when driver enters/exits geofence

TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }) => {
  if (error) {
    console.log('[Geofence] Error:', error.message);
    return;
  }

  const { eventType, region } = data;
  console.log('[Geofence] Event:', eventType, 'Region:', region.identifier);

  try {
    // ─── GAS REMINDER (outer geofence, enter only, drive trips, driver A only) ──
    if (region.identifier === 'gas-reminder-geofence' && eventType === Location.GeofencingEventType.Enter) {
      const activeTripCheck = await AsyncStorage.getItem('activeTrip');
      if (activeTripCheck) {
        const parsed = JSON.parse(activeTripCheck);
        const tripDuration = (Date.now() - parsed.startTime) / 60000;
        // Only fire for drive trips, 30+ min in, and only for the designated driver (Driver A / chase car driver)
        if (tripDuration >= 30 && parsed.tripType === 'drive') {
          const sessionStr = await AsyncStorage.getItem('sb-yincjogkjvotupzgetqg-auth-token');
          const userId = sessionStr ? JSON.parse(sessionStr)?.user?.id : null;
          // Check if this user is the designated driver (Driver A)
          const { createClient } = require('@supabase/supabase-js');
          const client = createClient(
            'https://yincjogkjvotupzgetqg.supabase.co',
            'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpbmNqb2dranZvdHVwemdldHFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5MTc2MTAsImV4cCI6MjA4ODQ5MzYxMH0._gxry5gqeBUFRz8la2IeHW8if1M1IdAHACMKUWy1las'
          );
          const { data: trip } = await client.from('trips').select('designated_driver_id').eq('id', parsed.tripId).single();
          if (trip && trip.designated_driver_id === userId) {
            await Notifications.scheduleNotificationAsync({
              content: {
                title: '⛽ Fuel Check',
                body: 'Please make sure the chase vehicle has at least 1/4 tank before returning it.',
                sound: true,
              },
              trigger: null,
            });
            console.log('[Geofence] Gas reminder sent to Driver A');
          }
        }
      }
      return;
    }

    // Get active trip data
    const activeTripData = await AsyncStorage.getItem('activeTrip');
    const activeTrip = activeTripData ? JSON.parse(activeTripData) : null;

    // Get user session
    const sessionStr = await AsyncStorage.getItem('sb-yincjogkjvotupzgetqg-auth-token');
    if (!sessionStr) return;
    const session = JSON.parse(sessionStr);
    const userId = session?.user?.id;
    if (!userId) return;

    // Skip if current user is not a driver
    const { createClient: createRoleClient } = require('@supabase/supabase-js');
    const roleClient = createRoleClient(
      'https://yincjogkjvotupzgetqg.supabase.co',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpbmNqb2dranZvdHVwemdldHFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5MTc2MTAsImV4cCI6MjA4ODQ5MzYxMH0._gxry5gqeBUFRz8la2IeHW8if1M1IdAHACMKUWy1las',
      { global: { headers: { Authorization: `Bearer ${session?.access_token}` } } }
    );
    const { data: profile } = await roleClient.from('profiles').select('role').eq('id', userId).single();
    if (profile?.role !== 'driver' && profile?.role !== 'manager') return;

    // ─── PROXIMITY CHECK: Ignore phantom events from far away ──────────────────────
    try {
      const currentLoc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation });
      const lat1 = currentLoc.coords.latitude * Math.PI / 180;
      const lat2 = DEALERSHIP_COORDS.latitude * Math.PI / 180;
      const dLat = (DEALERSHIP_COORDS.latitude - currentLoc.coords.latitude) * Math.PI / 180;
      const dLon = (DEALERSHIP_COORDS.longitude - currentLoc.coords.longitude) * Math.PI / 180;
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon/2) * Math.sin(dLon/2);
      const dist = 6371e3 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); // meters
      if (dist > 1500) {
        console.log(`[Geofence] Ignored phantom event — ${Math.round(dist)}m from dealership`);
        return;
      }
    } catch {}

    // Log event type for debugging (debounce removed — duplicates are acceptable)
    const eventKey = eventType === Location.GeofencingEventType.Exit ? 'exit' : 'enter';
    console.log(`[Geofence] Processing ${eventKey} event`);

    // ─── TRIGGER 1: LEAVING DEALERSHIP ─────────────────────────────────────────────
    if (eventType === Location.GeofencingEventType.Exit) {
      // Check if driver has a pending trip (drive or fly)
      const { data: pendingTrips } = await supabase
        .from('trips')
        .select('*')
        .eq('designated_driver_id', userId)
        .eq('status', 'pending');

      if (pendingTrips && pendingTrips.length > 0 && !activeTrip) {
        const trip = pendingTrips[0];
        // Send notification to driver
        await Notifications.scheduleNotificationAsync({
          content: {
            title: '🚗 Start Your Trip?',
            body: `You left the dealership. Start trip to ${trip.city}?`,
            data: {
              type: 'geofence_start_prompt',
              tripId: trip.id,
              city: trip.city
            },
            sound: true,
          },
          trigger: null, // Immediate
        });

        console.log('[Geofence] EXIT prompt sent for trip:', trip.id);
      }
    }

    // ─── TRIGGER 2: ARRIVING AT DEALERSHIP ─────────────────────────────────────────
    if (eventType === Location.GeofencingEventType.Enter) {
      // Check if driver has an active trip (any type - drive OR fly)
      // Skip if trip is paused (driver at hotel overnight, etc.)
      if (activeTrip && !activeTrip.paused) {
        const { data: trip } = await supabase
          .from('trips')
          .select('*')
          .eq('id', activeTrip.tripId)
          .single();

        if (trip && trip.status === 'in_progress') {
          // Only auto-end if trip has been in progress for at least 15 minutes
          const MIN_TRIP_MINUTES = 15;
          const tripDuration = (Date.now() - activeTrip.startTime) / 60000;

          if (tripDuration >= MIN_TRIP_MINUTES) {
            // Auto-end the trip
            const finalMiles = parseFloat(activeTrip.miles.toFixed(1));
            const finalDriveTime = parseFloat(((Date.now() - activeTrip.startTime) / 3600000).toFixed(2));

            const { createClient } = require('@supabase/supabase-js');
            const STORAGE_KEY = 'sb-yincjogkjvotupzgetqg-auth-token';
            const sessionStr = await AsyncStorage.getItem(STORAGE_KEY);
            let accessToken = null;
            if (sessionStr) {
              const sessionData = JSON.parse(sessionStr);
              accessToken = sessionData?.access_token;
            }

            const client = createClient(
              'https://yincjogkjvotupzgetqg.supabase.co',
              'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpbmNqb2dranZvdHVwemdldHFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5MTc2MTAsImV4cCI6MjA4ODQ5MzYxMH0._gxry5gqeBUFRz8la2IeHW8if1M1IdAHACMKUWy1las',
              accessToken ? { global: { headers: { Authorization: `Bearer ${accessToken}` } } } : {}
            );

            // Subtract stop time for avg speed
            const { data: geoStops } = await client.from('trip_stops').select('duration_minutes').eq('trip_id', trip.id);
            const geoStopMinutes = (geoStops ?? []).reduce((s, st) => s + (st.duration_minutes || 0), 0);
            const activeDriveTime = Math.max(0.1, finalDriveTime - (geoStopMinutes / 60));
            const avgSpeed = activeDriveTime > 0 ? Math.round(finalMiles / activeDriveTime) : 0;
            // Finalize any in-progress stop in the DB
            if (activeTrip.currentStopId) {
              const stopDuration = Math.round((Date.now() - activeTrip.currentStopStart) / 60000);
              await client.from('trip_stops').update({
                ended_at: new Date().toISOString(),
                duration_minutes: stopDuration,
              }).eq('id', activeTrip.currentStopId);
            }
            const speedData = {
              top_speed: activeTrip.topSpeed || 0,
              avg_speed: avgSpeed,
              seconds_over_80: Math.round(activeTrip.secondsOver80 || 0),
              seconds_over_90: Math.round(activeTrip.secondsOver90 || 0),
            };

            // Backup trip data to system_logs before writing
            try {
              await client.from('system_logs').insert({
                source: 'mobile',
                level: 'info',
                event: 'geofence_auto_end_data',
                message: `Auto-end backup: ${trip.city} - ${finalMiles}mi, ${finalDriveTime}h`,
                metadata: { trip_id: trip.id, miles: finalMiles, hours: finalDriveTime, speed_data: speedData },
              });
            } catch {}

            await client.from('trips').update({
              status: 'completed',
              actual_end: new Date().toISOString(),
              miles: finalMiles,
              hours: finalDriveTime,
              speed_data: speedData,
            }).eq('id', trip.id);

            // Stop background location tracking + SLC safety net
            const Location = require('expo-location');
            const BG_TASK = 'background-location-task';
            const SLC_TASK = 'significant-location-change-task';
            try {
              const isTracking = await Location.hasStartedLocationUpdatesAsync(BG_TASK);
              if (isTracking) await Location.stopLocationUpdatesAsync(BG_TASK);
            } catch {}
            try {
              const isSLC = await Location.hasStartedLocationUpdatesAsync(SLC_TASK);
              if (isSLC) await Location.stopLocationUpdatesAsync(SLC_TASK);
            } catch {}

            // Clean up driver location
            await client.from('driver_locations').delete().eq('driver_id', userId);

            // Safety net: close any unclosed stops for this trip
            await client.from('trip_stops')
              .update({ ended_at: new Date().toISOString(), duration_minutes: 0 })
              .eq('trip_id', trip.id)
              .is('ended_at', null);

            // Clear active trip from storage
            await AsyncStorage.removeItem('activeTrip');

            // Notify driver
            await Notifications.scheduleNotificationAsync({
              content: {
                title: "🏁 Trip Complete!",
                body: `Your trip to ${trip.city} has been ended automatically. ${finalMiles} mi, ${finalDriveTime}h tracked.`,
                data: {
                  type: 'geofence_auto_end',
                  tripId: trip.id,
                  city: trip.city,
                  miles: finalMiles,
                },
                sound: true,
              },
              trigger: null,
            });

            // Notify admins
            fetch('https://yincjogkjvotupzgetqg.supabase.co/functions/v1/notify-trip-status', {
              method: 'POST',
              headers: {
                apikey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpbmNqb2dranZvdHVwemdldHFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5MTc2MTAsImV4cCI6MjA4ODQ5MzYxMH0._gxry5gqeBUFRz8la2IeHW8if1M1IdAHACMKUWy1las',
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ trip_id: trip.id, driver_id: userId, action: 'ended' }),
            }).catch(() => {});

            console.log('[Geofence] AUTO-END trip:', trip.id, finalMiles, 'mi');
          } else {
            // Trip too short, just send notification prompt
            await Notifications.scheduleNotificationAsync({
              content: {
                title: "🏁 You've Arrived!",
                body: `End your trip to ${trip.city}? (${activeTrip.miles.toFixed(1)} mi tracked)`,
                data: {
                  type: 'geofence_end_prompt',
                  tripId: trip.id,
                  city: trip.city,
                  miles: activeTrip.miles,
                },
                sound: true,
              },
              trigger: null,
            });

            console.log('[Geofence] ENTER prompt sent (trip <30min):', trip.id);
          }
        }
      }
    }

    // Log event for admin
    const { createClient: createLogClient } = require('@supabase/supabase-js');
    const logSessionStr = await AsyncStorage.getItem('sb-yincjogkjvotupzgetqg-auth-token');
    let logToken = null;
    if (logSessionStr) {
      logToken = JSON.parse(logSessionStr)?.access_token;
    }
    const logClient = createLogClient(
      'https://yincjogkjvotupzgetqg.supabase.co',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpbmNqb2dranZvdHVwemdldHFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5MTc2MTAsImV4cCI6MjA4ODQ5MzYxMH0._gxry5gqeBUFRz8la2IeHW8if1M1IdAHACMKUWy1las',
      logToken ? { global: { headers: { Authorization: `Bearer ${logToken}` } } } : {}
    );
    await logClient.from('geofence_events').insert({
      driver_id: userId,
      event_type: eventType === Location.GeofencingEventType.Exit ? 'exit' : 'enter',
      trip_id: activeTrip?.tripId || null,
    });

  } catch (err) {
    console.log('[Geofence] Task error:', err.message);
  }
});

// ─── GEOFENCE MANAGER ───────────────────────────────────────────────────────────

export const GeofenceManager = {
  /**
   * Start monitoring geofence
   * Call this when driver logs in or app starts
   */
  async start() {
    try {
      // Check if geofencing is already active
      const isGeofencing = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK);
      if (isGeofencing) {
        console.log('[Geofence] Already monitoring');
        return true;
      }

      // Request location permissions
      const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
      const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
      if (fgStatus !== 'granted' || bgStatus !== 'granted') {
        console.log('[Geofence] Missing permissions:', fgStatus, bgStatus);
        return false;
      }

      // Start geofencing
      await Location.startGeofencingAsync(GEOFENCE_TASK, [
        {
          identifier: 'dealership-geofence',
          latitude: DEALERSHIP_COORDS.latitude,
          longitude: DEALERSHIP_COORDS.longitude,
          radius: DEALERSHIP_COORDS.radius,
          notifyOnEnter: true,
          notifyOnExit: true,
        },
        {
          identifier: 'gas-reminder-geofence',
          latitude: DEALERSHIP_COORDS.latitude,
          longitude: DEALERSHIP_COORDS.longitude,
          radius: GAS_REMINDER_RADIUS,
          notifyOnEnter: true,
          notifyOnExit: false,
        },
      ]);

      console.log('[Geofence] Started monitoring dealership');
      return true;

    } catch (error) {
      console.log('[Geofence] Start error:', error.message);
      return false;
    }
  },

  /**
   * Stop monitoring geofence
   * Call this when driver logs out
   */
  async stop() {
    try {
      const isMonitoring = await TaskManager.isTaskRegisteredAsync(GEOFENCE_TASK);
      if (isMonitoring) {
        await Location.stopGeofencingAsync(GEOFENCE_TASK);
        console.log('[Geofence] Stopped monitoring');
      }
    } catch (error) {
      console.log('[Geofence] Stop error:', error.message);
    }
  },

  /**
   * Check if geofence is currently active
   */
  async isActive() {
    try {
      return await Location.hasStartedGeofencingAsync(GEOFENCE_TASK);
    } catch {
      return false;
    }
  },

  /**
   * Get current distance from geofence center
   * Useful for debugging
   */
  async getDistanceFromGeofence() {
    try {
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      const { latitude, longitude } = location.coords;
      
      // Haversine formula
      const R = 6371e3; // Earth radius in meters
      const φ1 = DEALERSHIP_COORDS.latitude * Math.PI / 180;
      const φ2 = latitude * Math.PI / 180;
      const Δφ = (latitude - DEALERSHIP_COORDS.latitude) * Math.PI / 180;
      const Δλ = (longitude - DEALERSHIP_COORDS.longitude) * Math.PI / 180;

      const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                Math.cos(φ1) * Math.cos(φ2) *
                Math.sin(Δλ/2) * Math.sin(Δλ/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      const distance = R * c;

      return {
        distance: Math.round(distance),
        insideZone: distance < DEALERSHIP_COORDS.radius,
        radius: DEALERSHIP_COORDS.radius,
      };
    } catch (error) {
      console.log('[Geofence] Distance check error:', error.message);
      return null;
    }
  },
};