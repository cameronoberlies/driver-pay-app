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
  radius: 150, // 150 meters (~500 feet)
};

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
    // Get active trip data
    const activeTripData = await AsyncStorage.getItem('activeTrip');
    const activeTrip = activeTripData ? JSON.parse(activeTripData) : null;

    // Get user session
    const sessionStr = await AsyncStorage.getItem('sb-yincjogkjvotupzgetqg-auth-token');
    if (!sessionStr) return;
    const session = JSON.parse(sessionStr);
    const userId = session?.user?.id;
    if (!userId) return;

    // ─── TRIGGER 1: LEAVING DEALERSHIP ─────────────────────────────────────────────
    if (eventType === Location.GeofencingEventType.Exit) {
      // Check if driver has a pending DRIVE trip
      const { data: pendingTrips } = await supabase
        .from('trips')
        .select('*')
        .eq('designated_driver_id', userId)
        .eq('status', 'pending')
        .eq('trip_type', 'drive'); // Only for drive trips!

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
      if (activeTrip) {
        const { data: trip } = await supabase
          .from('trips')
          .select('*')
          .eq('id', activeTrip.tripId)
          .single();

        if (trip && trip.status === 'in_progress') {
          // Send notification to driver
          await Notifications.scheduleNotificationAsync({
            content: {
              title: "🏁 You've Arrived!",
              body: `End your trip to ${trip.city}? (${activeTrip.miles.toFixed(1)} mi tracked)`,
              data: {
                type: 'geofence_end_prompt',
                tripId: trip.id,
                city: trip.city,
                miles: activeTrip.miles
              },
              sound: true,
            },
            trigger: null, // Immediate
          });

          console.log('[Geofence] ENTER prompt sent for trip:', trip.id);
        }
      }
    }

    // Log event for admin
    await supabase.from('geofence_events').insert({
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
      // Check if already monitoring
      const isMonitoring = await TaskManager.isTaskRegisteredAsync(GEOFENCE_TASK);
      if (isMonitoring) {
        console.log('[Geofence] Already monitoring');
        return true;
      }

      // Request location permissions (FIXED: using request instead of get)
      const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
      const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
      if (fgStatus !== 'granted' || bgStatus !== 'granted') {
        console.log('[Geofence] Missing permissions');
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
      return await TaskManager.isTaskRegisteredAsync(GEOFENCE_TASK);
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