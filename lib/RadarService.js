import Radar from 'react-native-radar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const RADAR_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_RADAR_PUBLISHABLE_KEY;

class RadarService {
  constructor() {
    this.isInitialized = false;
    this.currentTripId = null;
  }

  async initialize(userId, userName) {
    if (this.isInitialized) return { success: true };

    if (RADAR_PUBLISHABLE_KEY === 'WAITING_FOR_RADAR_API_KEY') {
      console.warn('[Radar] Using placeholder key - features disabled');
      return { success: false, error: 'Waiting for API key' };
    }

    try {
      await Radar.initialize(RADAR_PUBLISHABLE_KEY);
      await Radar.setUserId(userId);
      await Radar.setMetadata({
        driverId: userId,
        driverName: userName,
        dealership: 'discovery_automotive'
      });

      this.isInitialized = true;
      console.log('[Radar] Initialized');
      return { success: true };
    } catch (error) {
      console.error('[Radar] Init error:', error);
      return { success: false, error: error.message };
    }
  }

  async startTripTracking(tripId) {
    if (!this.isInitialized) {
      return { success: false, error: 'Radar not initialized' };
    }

    try {
      const status = await Radar.requestPermissions(true);
      if (status !== 'GRANTED_BACKGROUND') {
        return { success: false, error: 'Background permission required' };
      }

      // Start tracking with Radar
      await Radar.startTracking('responsive'); // Good balance of battery/accuracy
      await Radar.startTrip({
        externalId: tripId,
        destinationGeofenceTag: 'dealership',
        mode: 'car'
      });

      // Store start time for offline resilience
      await AsyncStorage.setItem('active_trip_id', tripId);
      await AsyncStorage.setItem('trip_start_time', new Date().toISOString());

      this.currentTripId = tripId;
      console.log('[Radar] Trip tracking started:', tripId);

      // Also start location updates to driver_locations table (for LiveDriversScreen)
      this.startLocationUpdates(userId);

      return { success: true };
    } catch (error) {
      console.error('[Radar] Start error:', error);
      return { success: false, error: error.message };
    }
  }

  async stopTripTracking(tripId, userId) {
    try {
      // Get trip start time
      const startTime = await AsyncStorage.getItem('trip_start_time');
      const start = new Date(startTime);
      const end = new Date();

      // Calculate total hours (includes offline periods like flights)
      const totalHours = (end - start) / (1000 * 60 * 60);

      // Get Radar trip data (GPS-tracked portions)
      const tripData = await this.getTripData();

      // Clean up
      await AsyncStorage.removeItem('active_trip_id');
      await AsyncStorage.removeItem('trip_start_time');

      await Radar.completeTrip();
      await Radar.stopTracking();

      this.currentTripId = null;
      this.stopLocationUpdates();

      console.log('[Radar] Trip stopped');

      return {
        success: true,
        tripData: {
          hours: totalHours.toFixed(2),
          actual_distance_miles: tripData?.distance 
            ? (tripData.distance / 1609.34).toFixed(2) 
            : null,
          route_geojson: tripData?.geometry,
          actual_duration_minutes: tripData?.duration 
            ? Math.round(tripData.duration / 60)
            : null
        }
      };
    } catch (error) {
      console.error('[Radar] Stop error:', error);
      return { success: false, error: error.message };
    }
  }

  async getTripData() {
    try {
      const result = await Radar.trackOnce();
      return result.user?.trip;
    } catch (error) {
      console.error('[Radar] Get trip data error:', error);
      return null;
    }
  }

  /**
   * Update driver_locations table for LiveDriversScreen
   * Runs in background while trip is active
   */
  async startLocationUpdates(userId) {
    this.locationInterval = setInterval(async () => {
      try {
        const result = await Radar.trackOnce();
        if (result.location) {
          await supabase
            .from('driver_locations')
            .upsert({
              driver_id: userId,
              latitude: result.location.latitude,
              longitude: result.location.longitude,
              updated_at: new Date().toISOString()
            });
        }
      } catch (error) {
        console.error('[Radar] Location update error:', error);
      }
    }, 30000); // Update every 30 seconds
  }

  stopLocationUpdates() {
    if (this.locationInterval) {
      clearInterval(this.locationInterval);
      this.locationInterval = null;
    }
  }

  async isTracking() {
    try {
      return await Radar.isTracking();
    } catch {
      return false;
    }
  }

  async cleanup() {
    try {
      if (this.currentTripId) {
        await Radar.completeTrip();
      }
      await Radar.stopTracking();
      await Radar.setUserId(null);
      this.stopLocationUpdates();
      this.isInitialized = false;
      this.currentTripId = null;
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

export default new RadarService();