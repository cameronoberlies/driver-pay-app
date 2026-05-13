// OBD Data Manager
// Collects, processes, and stores vehicle data during trips
// Sits between BLEManager (raw data) and the trip tracking system
// For ELM327 adapters — values arrive parsed via parsePIDResponse

import { PIDS, TRIP_PIDS, kmhToMph, kmToMiles, celsiusToFahrenheit } from './OBDPids';
import { obdBLE } from './BLEManager';
import { logEvent } from '../systemLog';
import { supabase } from '../supabase';

class OBDDataManager {
  constructor() {
    this.isRecording = false;
    this.currentData = {};
    this.tripData = {
      startOdometer: null,
      endOdometer: null,
      maxRPM: 0,
      maxSpeed: 0,
      fuelStart: null,
      fuelEnd: null,
      hardBrakes: 0,
      hardAccelerations: 0,
      diagnosticCodes: [],
    };
    this.lastSpeed = 0;
    this.lastSpeedTime = null;
    this.listeners = [];
  }

  // Register a data listener (for UI updates)
  onUpdate(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }

  _notify() {
    const snapshot = this.getSnapshot();
    this.listeners.forEach(cb => cb(snapshot));
    // Persist latest OBD snapshot to AsyncStorage so the BG location task
    // can include it in driver_locations upserts even when app is backgrounded.
    this._persistSnapshot(snapshot);
    // BLE-driven heartbeat: every BLE notification from the Veepeak wakes the
    // JS runtime briefly. We use that wake-up to write directly to
    // driver_locations so the admin Live view stays fresh even when iOS has
    // suspended the background-location-task. Throttled to once per 20s to
    // avoid hammering Supabase (Veepeak streams PIDs at ~2/sec).
    this._writeBleHeartbeat(snapshot);
  }

  async _notifyAdminsDTC(codes) {
    // Only fire once per recording — avoid spamming admins if Mode 03 is re-polled
    if (this._dtcNotified) return;
    this._dtcNotified = true;
    try {
      const AsyncStorage = require('@react-native-async-storage/async-storage').default;
      const stored = await AsyncStorage.getItem('activeTrip');
      if (!stored) return;
      const parsed = JSON.parse(stored);
      const sessionStr = await AsyncStorage.getItem('sb-yincjogkjvotupzgetqg-auth-token');
      const accessToken = sessionStr ? JSON.parse(sessionStr)?.access_token : null;
      await fetch('https://yincjogkjvotupzgetqg.supabase.co/functions/v1/notify-trip-status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpbmNqb2dranZvdHVwemdldHFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5MTc2MTAsImV4cCI6MjA4ODQ5MzYxMH0._gxry5gqeBUFRz8la2IeHW8if1M1IdAHACMKUWy1las',
          ...(accessToken && { 'Authorization': `Bearer ${accessToken}` }),
        },
        body: JSON.stringify({
          trip_id: parsed.tripId,
          driver_id: parsed.userId,
          action: 'dtc_detected',
          metadata: { codes },
        }),
      }).catch(() => {});
    } catch {}
  }

  async _writeBleHeartbeat(snapshot) {
    if (!this._heartbeatThrottle) this._heartbeatThrottle = 0;
    const now = Date.now();
    if (now - this._heartbeatThrottle < 20000) return; // 20s throttle
    this._heartbeatThrottle = now;

    try {
      const AsyncStorage = require('@react-native-async-storage/async-storage').default;
      const stored = await AsyncStorage.getItem('activeTrip');
      if (!stored) return;
      const parsed = JSON.parse(stored);
      if (!parsed.userId || parsed.lastLat == null || parsed.lastLon == null) return;

      const update = {
        driver_id: parsed.userId,
        latitude: parsed.lastLat,
        longitude: parsed.lastLon,
        updated_at: new Date().toISOString(),
      };
      if (snapshot.speed != null) update.obd_speed = snapshot.speed;
      if (snapshot.rpm != null) update.obd_rpm = snapshot.rpm;
      if (snapshot.fuelLevel != null) update.obd_fuel = snapshot.fuelLevel;
      await supabase.from('driver_locations').upsert(update, { onConflict: 'driver_id' });
    } catch (e) {
      console.log('[OBD-Data] heartbeat write failed (non-fatal):', e.message);
    }
  }

  _persistSnapshot(snapshot) {
    if (!this._persistThrottle) this._persistThrottle = 0;
    const now = Date.now();
    if (now - this._persistThrottle < 2000) return; // throttle to ~once per 2s
    this._persistThrottle = now;
    try {
      const AsyncStorage = require('@react-native-async-storage/async-storage').default;
      const minimal = {
        speed: snapshot.speed ?? null,
        rpm: snapshot.rpm ?? null,
        fuelLevel: snapshot.fuelLevel ?? null,
        timestamp: now,
      };
      AsyncStorage.setItem('obdSnapshot', JSON.stringify(minimal)).catch(() => {});
    } catch {}
  }

  // Start recording trip data
  startRecording() {
    this.isRecording = true;
    this.tripData = {
      startOdometer: null,
      endOdometer: null,
      maxRPM: 0,
      maxSpeed: 0,
      fuelStart: null,
      fuelEnd: null,
      hardBrakes: 0,
      hardAccelerations: 0,
      diagnosticCodes: [],
    };

    // Pass driver_id to BLEManager so its logEvent calls can be grouped
    // by driver on the admin instability indicator
    try {
      const AsyncStorage = require('@react-native-async-storage/async-storage').default;
      AsyncStorage.getItem('activeTrip').then((stored) => {
        if (stored) {
          const parsed = JSON.parse(stored);
          obdBLE.driverId = parsed.userId || null;
        }
      }).catch(() => {});
    } catch {}

    // Listen for OBD data
    obdBLE.onData((data) => {
      if (!this.isRecording) return;
      this._processReading(data);
    });

    // Start polling PIDs from the adapter
    obdBLE.startPolling(TRIP_PIDS, 2000);

    // Watchdog: if no PIDs arrive within 60s of recording start, the ECU
    // isn't responding even though BLE/ELM327 think they're ready. Log it
    // so we know to look at vehicle/adapter health, not just connection state.
    setTimeout(() => {
      if (this.isRecording && !this._firstPidLogged && obdBLE.isConnected()) {
        logEvent('warn', 'obd_no_ecu_response',
          'BLE + ELM327 ready but no PID responses from vehicle ECU after 60s',
          { connected: obdBLE.isConnected() });
      }
    }, 60000);

    // Request VIN with retries — protocol detection can take time on first PID
    // Retry every 30s up to 5 times until vehicle info is captured
    let vinAttempts = 0;
    const vinInterval = setInterval(() => {
      vinAttempts++;
      if (this.currentData.vehicle || vinAttempts > 5 || !this.isRecording) {
        clearInterval(vinInterval);
        return;
      }
      if (obdBLE.isConnected()) {
        console.log('[OBD-Data] Requesting VIN, attempt', vinAttempts);
        obdBLE.sendCommand('0902');
      }
    }, 30000);
    // First attempt sooner, after ELM327 has had time to lock protocol
    setTimeout(() => {
      if (obdBLE.isConnected() && !this.currentData.vehicle) {
        obdBLE.sendCommand('0902');
      }
    }, 15000);

    // Request DTCs once at trip start — gives us any pending engine codes.
    // Wait long enough for the ELM327 protocol to be locked in.
    setTimeout(() => {
      if (obdBLE.isConnected() && this.isRecording) {
        console.log('[OBD-Data] Requesting DTCs (Mode 03)');
        obdBLE.sendCommand('03');
      }
    }, 20000);

    console.log('[OBD-Data] Recording started');
    logEvent('info', 'obd_recording_started', 'OBD trip recording started');
    this._firstPidLogged = false;
    this._dtcNotified = false;
  }

  // Stop recording and return trip summary
  stopRecording() {
    this.isRecording = false;
    obdBLE.stopPolling();
    obdBLE.onData(null);
    // Clear persisted snapshot so BG task doesn't write stale OBD data
    try {
      const AsyncStorage = require('@react-native-async-storage/async-storage').default;
      AsyncStorage.removeItem('obdSnapshot').catch(() => {});
    } catch {}

    // Capture final values
    this.tripData.endOdometer = this.currentData.odometer || null;
    this.tripData.fuelEnd = this.currentData.fuelLevel || null;

    const summary = this.getTripSummary();
    console.log('[OBD-Data] Recording stopped', summary);
    logEvent('info', 'obd_recording_stopped', 'OBD trip recording finished', {
      max_speed: summary.max_speed,
      max_rpm: summary.max_rpm,
      hard_brakes: summary.hard_brakes,
      hard_accelerations: summary.hard_accelerations,
      had_vehicle: !!summary.vehicle,
      had_odometer: summary.odometer_miles != null,
      had_fuel: summary.fuel_used != null,
      had_dtcs: summary.diagnostic_codes?.length > 0,
    });
    return summary;
  }

  // Process a single PID reading
  // Values arrive already parsed by parsePIDResponse in BLEManager
  _processReading(data) {
    const { pid, value, timestamp } = data;

    // Log the first PID response — proves data is actually flowing from ECU
    if (!this._firstPidLogged && typeof pid === 'number') {
      this._firstPidLogged = true;
      logEvent('info', 'obd_first_pid', `First PID response received: 0x${pid.toString(16)}`,
        { pid, value });
    }

    // Handle DTC codes separately — engine codes are high-priority,
    // notify admins immediately rather than waiting for trip end
    if (pid === 'DTC') {
      this.tripData.diagnosticCodes = value;
      logEvent('warn', 'obd_dtc_received', `Diagnostic codes: ${value.join(', ')}`, { codes: value });
      if (value.length > 0) {
        this._notifyAdminsDTC(value);
      }
      this._notify();
      return;
    }

    // Handle VIN — decode via NHTSA, save to currentData
    if (pid === 'VIN') {
      const vin = value;
      logEvent('info', 'obd_vin_received', `VIN read from vehicle: ${vin}`, { vin });
      if (!this.currentData.vehicle || this.currentData.vehicle.vin !== vin) {
        const { decodeVIN } = require('./VINDecoder');
        decodeVIN(vin).then((vehicle) => {
          if (vehicle) {
            this.currentData.vehicle = vehicle;
            logEvent('info', 'obd_vehicle_decoded',
              `${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim(),
              { vin, year: vehicle.year, make: vehicle.make, model: vehicle.model });
            this._notify();
          } else {
            logEvent('warn', 'obd_vehicle_decode_failed', `NHTSA failed to decode VIN ${vin}`, { vin });
          }
        });
      }
      return;
    }

    switch (pid) {
      case PIDS.SPEED.pid: {
        const speedMph = kmhToMph(value);
        this.currentData.speed = Math.round(speedMph);
        this.currentData.speedKmh = value;

        if (speedMph > this.tripData.maxSpeed) {
          this.tripData.maxSpeed = Math.round(speedMph);
        }

        // Detect hard braking/acceleration
        if (this.lastSpeed > 0 && this.lastSpeedTime) {
          const timeDelta = (timestamp - this.lastSpeedTime) / 1000;
          if (timeDelta > 0 && timeDelta <= 3) {
            const deceleration = (this.lastSpeed - speedMph) / timeDelta;
            if (deceleration > 7.5) {
              this.tripData.hardBrakes++;
            }
            const acceleration = (speedMph - this.lastSpeed) / timeDelta;
            if (acceleration > 7.5) {
              this.tripData.hardAccelerations++;
            }
          }
        }
        this.lastSpeed = speedMph;
        this.lastSpeedTime = timestamp;
        break;
      }

      case PIDS.RPM.pid:
        this.currentData.rpm = Math.round(value);
        if (value > this.tripData.maxRPM) {
          this.tripData.maxRPM = Math.round(value);
        }
        break;

      case PIDS.FUEL_LEVEL.pid:
        this.currentData.fuelLevel = Math.round(value);
        if (this.tripData.fuelStart === null) {
          this.tripData.fuelStart = Math.round(value);
        }
        break;

      case PIDS.COOLANT_TEMP.pid:
        this.currentData.coolantTemp = Math.round(celsiusToFahrenheit(value));
        this.currentData.coolantTempC = Math.round(value);
        break;

      case PIDS.ODOMETER.pid:
        const miles = kmToMiles(value);
        this.currentData.odometer = Math.round(miles * 10) / 10;
        this.currentData.odometerKm = value;
        if (this.tripData.startOdometer === null) {
          this.tripData.startOdometer = this.currentData.odometer;
        }
        break;

      case PIDS.ENGINE_LOAD.pid:
        this.currentData.engineLoad = Math.round(value);
        break;

      case PIDS.BATTERY_VOLTAGE.pid:
        this.currentData.batteryVoltage = Math.round(value * 10) / 10;
        break;

      case PIDS.THROTTLE.pid:
        this.currentData.throttle = Math.round(value);
        break;
    }

    this.currentData.lastUpdate = timestamp;
    this._notify();
  }

  // Get current live snapshot (for UI display)
  getSnapshot() {
    return {
      connected: obdBLE.isConnected(),
      bleState: obdBLE.getState(),
      recording: this.isRecording,
      ...this.currentData,
      tripData: {
        maxSpeed: this.tripData.maxSpeed,
        maxRPM: this.tripData.maxRPM,
        hardBrakes: this.tripData.hardBrakes,
        hardAccelerations: this.tripData.hardAccelerations,
        odometerDelta: this.tripData.startOdometer && this.currentData.odometer
          ? Math.round((this.currentData.odometer - this.tripData.startOdometer) * 10) / 10
          : null,
        fuelUsed: this.tripData.fuelStart !== null && this.currentData.fuelLevel !== null
          ? this.tripData.fuelStart - this.currentData.fuelLevel
          : null,
      },
    };
  }

  // Get trip summary (for saving to database when trip ends)
  getTripSummary() {
    const odometerMiles = this.tripData.startOdometer && this.tripData.endOdometer
      ? Math.round((this.tripData.endOdometer - this.tripData.startOdometer) * 10) / 10
      : null;

    return {
      obd_connected: true,
      vehicle: this.currentData.vehicle || null,
      odometer_start: this.tripData.startOdometer,
      odometer_end: this.tripData.endOdometer,
      odometer_miles: odometerMiles,
      max_speed: this.tripData.maxSpeed,
      max_rpm: this.tripData.maxRPM,
      fuel_start: this.tripData.fuelStart,
      fuel_end: this.tripData.fuelEnd,
      fuel_used: this.tripData.fuelStart !== null && this.tripData.fuelEnd !== null
        ? this.tripData.fuelStart - this.tripData.fuelEnd
        : null,
      hard_brakes: this.tripData.hardBrakes,
      hard_accelerations: this.tripData.hardAccelerations,
      diagnostic_codes: this.tripData.diagnosticCodes,
    };
  }

  // Run a diagnostic check
  async runDiagnostics() {
    if (!obdBLE.isConnected()) return null;

    // Request DTCs (Mode 03)
    await obdBLE.sendCommand('03');

    // Read diagnostic PIDs
    const { DIAGNOSTIC_PIDS } = require('./OBDPids');
    for (const pid of DIAGNOSTIC_PIDS) {
      await obdBLE.readPID(pid);
      await new Promise(r => setTimeout(r, 300));
    }

    return this.getSnapshot();
  }
}

// Singleton
export const obdData = new OBDDataManager();
