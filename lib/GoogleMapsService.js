// GOOGLE MAPS SERVICE - Drop-in replacement for RadarService.js
// Provides GPS tracking, geofencing, and route recording using Google Maps Platform
// Cost: FREE for <40k requests/month ($200/month credit covers it)

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

// Background location tracking task
const LOCATION_TASK_NAME = 'background-location-task';

// Dealership geofence (Discovery Automotive - Shelby, NC)
const DEALERSHIP_COORDS = {
  latitude: 35.270366,
  longitude: -81.496247,
  radius: 150, // meters
};

// ─────────────────────────────────────────────────────────────────────────────
// BACKGROUND TASK - Updates location while app is backgrounded
// ─────────────────────────────────────────────────────────────────────────────

TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error('[GoogleMaps] Background task error:', error);
    return;
  }

  if (data) {
    const { locations } = data;
    const location = locations[0];

    try {
      // Get active trip
      const activeTripId = await AsyncStorage.getItem('active_trip_id');
      if (!activeTripId) return;

      // Get user session
      const sessionStr = await AsyncStorage.getItem('sb-yincjogkjvotupzgetqg-auth-token');
      if (!sessionStr) return;
      const session = JSON.parse(sessionStr);
      const userId = session?.user?.id;
      if (!userId) return;

      // Update driver location in database (for LiveDriversScreen)
      await supabase
        .from('driver_locations')
        .upsert({
          driver_id: userId,
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          updated_at: new Date().toISOString(),
        });

      // Store location in route history
      const routeHistory = await AsyncStorage.getItem(`route_${activeTripId}`);
      const route = routeHistory ? JSON.parse(routeHistory) : [];
      route.push({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        timestamp: location.timestamp,
      });
      await AsyncStorage.setItem(`route_${activeTripId}`, JSON.stringify(route));

      // Calculate miles traveled
      if (route.length > 1) {
        const totalMiles = calculateTotalDistance(route);
        await AsyncStorage.setItem(`trip_miles_${activeTripId}`, totalMiles.toString());
      }

      // Check geofence events
      await checkGeofence(location.coords, userId, activeTripId);

    } catch (err) {
      console.error('[GoogleMaps] Background location processing error:', err);
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GEOFENCE CHECKER
// ─────────────────────────────────────────────────────────────────────────────

let lastGeofenceState = null; // 'inside' or 'outside'

async function checkGeofence(coords, userId, tripId) {
  const distance = getDistanceFromDealership(coords.latitude, coords.longitude);
  const isInside = distance < DEALERSHIP_COORDS.radius;
  const currentState = isInside ? 'inside' : 'outside';

  // Detect state change
  if (lastGeofenceState !== null && lastGeofenceState !== currentState) {
    const eventType = currentState === 'inside' ? 'enter' : 'exit';
    
    // Log to database
    await supabase.from('geofence_events').insert({
      driver_id: userId,
      event_type: eventType,
      trip_id: tripId,
      created_at: new Date().toISOString(),
    });

    console.log(`[GoogleMaps] Geofence ${eventType}`);
  }

  lastGeofenceState = currentState;
}

// ─────────────────────────────────────────────────────────────────────────────
// GOOGLE MAPS SERVICE CLASS
// ─────────────────────────────────────────────────────────────────────────────

class GoogleMapsService {
  constructor() {
    this.isInitialized = false;
    this.currentTripId = null;
    this.locationSubscription = null;
  }

  /**
   * Initialize service
   */
  async initialize(userId, userName) {
    if (this.isInitialized) return { success: true };

    if (!GOOGLE_MAPS_API_KEY || GOOGLE_MAPS_API_KEY === 'WAITING_FOR_GOOGLE_API_KEY') {
      console.warn('[GoogleMaps] Using placeholder key - features disabled');
      return { success: false, error: 'Waiting for Google API key' };
    }

    try {
      // Request permissions
      const { status: foregroundStatus } = await Location.requestForegroundPermissionsAsync();
      if (foregroundStatus !== 'granted') {
        return { success: false, error: 'Foreground location permission denied' };
      }

      const { status: backgroundStatus } = await Location.requestBackgroundPermissionsAsync();
      if (backgroundStatus !== 'granted') {
        console.warn('[GoogleMaps] Background permission denied - tracking may be limited');
      }

      this.isInitialized = true;
      console.log('[GoogleMaps] Initialized for user:', userName);
      return { success: true };
    } catch (error) {
      console.error('[GoogleMaps] Init error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Start trip tracking
   */
  async startTripTracking(tripId) {
    if (!this.isInitialized) {
      return { success: false, error: 'GoogleMaps not initialized' };
    }

    try {
      // Store trip metadata
      await AsyncStorage.setItem('active_trip_id', tripId);
      await AsyncStorage.setItem('trip_start_time', new Date().toISOString());
      await AsyncStorage.setItem(`route_${tripId}`, JSON.stringify([]));
      await AsyncStorage.setItem(`trip_miles_${tripId}`, '0');

      // Start background location tracking
      await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
        accuracy: Location.Accuracy.High,
        timeInterval: 10000, // Update every 10 seconds
        distanceInterval: 10, // Or every 10 meters
        foregroundService: {
          notificationTitle: 'Trip Active',
          notificationBody: 'Tracking your route and mileage',
          notificationColor: '#f5a623',
        },
        pausesUpdatesAutomatically: false, // Keep tracking even when stationary
        activityType: Location.ActivityType.AutomotiveNavigation,
        showsBackgroundLocationIndicator: true,
      });

      this.currentTripId = tripId;
      console.log('[GoogleMaps] Trip tracking started:', tripId);

      return { success: true };
    } catch (error) {
      console.error('[GoogleMaps] Start tracking error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Stop trip tracking and return trip data
   */
  async stopTripTracking(tripId, userId) {
    try {
      // Stop background tracking
      const isTaskRegistered = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
      if (isTaskRegistered) {
        await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
      }

      // Get trip data from AsyncStorage
      const startTime = await AsyncStorage.getItem('trip_start_time');
      const routeStr = await AsyncStorage.getItem(`route_${tripId}`);
      const milesStr = await AsyncStorage.getItem(`trip_miles_${tripId}`);

      const start = new Date(startTime);
      const end = new Date();
      const totalHours = (end - start) / (1000 * 60 * 60);
      const route = routeStr ? JSON.parse(routeStr) : [];
      const miles = milesStr ? parseFloat(milesStr) : 0;

      // Convert route to GeoJSON
      const routeGeoJSON = route.length > 0 ? {
        type: 'LineString',
        coordinates: route.map(point => [point.longitude, point.latitude])
      } : null;

      // Clean up AsyncStorage
      await AsyncStorage.removeItem('active_trip_id');
      await AsyncStorage.removeItem('trip_start_time');
      await AsyncStorage.removeItem(`route_${tripId}`);
      await AsyncStorage.removeItem(`trip_miles_${tripId}`);

      // Clear driver location (trip ended)
      await supabase
        .from('driver_locations')
        .delete()
        .eq('driver_id', userId);

      this.currentTripId = null;
      lastGeofenceState = null;
      console.log('[GoogleMaps] Trip stopped:', tripId);

      return {
        success: true,
        tripData: {
          hours: totalHours.toFixed(2),
          actual_distance_miles: miles > 0 ? miles.toFixed(2) : null,
          route_geojson: routeGeoJSON,
          actual_duration_minutes: Math.round(totalHours * 60),
        }
      };
    } catch (error) {
      console.error('[GoogleMaps] Stop tracking error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Check if currently tracking
   */
  async isTracking() {
    try {
      return await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
    } catch {
      return false;
    }
  }

  /**
   * Cleanup service (on logout)
   */
  async cleanup() {
    try {
      const isTaskRegistered = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
      if (isTaskRegistered) {
        await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
      }

      if (this.currentTripId) {
        await AsyncStorage.removeItem('active_trip_id');
        await AsyncStorage.removeItem('trip_start_time');
        await AsyncStorage.removeItem(`route_${this.currentTripId}`);
        await AsyncStorage.removeItem(`trip_miles_${this.currentTripId}`);
      }

      this.isInitialized = false;
      this.currentTripId = null;
      lastGeofenceState = null;
      console.log('[GoogleMaps] Cleanup complete');

      return { success: true };
    } catch (error) {
      console.error('[GoogleMaps] Cleanup error:', error);
      return { success: false, error: error.message };
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate total distance traveled along a route
 */
function calculateTotalDistance(route) {
  if (route.length < 2) return 0;

  let totalMeters = 0;
  for (let i = 1; i < route.length; i++) {
    const prev = route[i - 1];
    const curr = route[i];
    totalMeters += getDistance(
      prev.latitude,
      prev.longitude,
      curr.latitude,
      curr.longitude
    );
  }

  return totalMeters / 1609.34; // Convert meters to miles
}

/**
 * Haversine distance between two coordinates (in meters)
 */
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c;
}

/**
 * Get distance from dealership geofence center
 */
function getDistanceFromDealership(lat, lon) {
  return getDistance(
    DEALERSHIP_COORDS.latitude,
    DEALERSHIP_COORDS.longitude,
    lat,
    lon
  );
}

export default new GoogleMapsService();