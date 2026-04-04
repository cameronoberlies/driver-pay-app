// OBD Data Manager
// Collects, processes, and stores vehicle data during trips
// Sits between BLEManager (raw data) and the trip tracking system

import { PIDS, kmhToMph, kmToMiles, celsiusToFahrenheit } from './OBDPids';
import { obdBLE } from './BLEManager';

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
      readings: [],
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
      readings: [],
    };

    // Listen for OBD data
    obdBLE.onData((data) => {
      if (!this.isRecording) return;
      this._processReading(data);
    });

    console.log('[OBD-Data] Recording started');
  }

  // Stop recording and return trip summary
  stopRecording() {
    this.isRecording = false;
    obdBLE.onData(null);

    // Capture final values
    this.tripData.endOdometer = this.currentData.odometer || null;
    this.tripData.fuelEnd = this.currentData.fuelLevel || null;

    const summary = this.getTripSummary();
    console.log('[OBD-Data] Recording stopped', summary);
    return summary;
  }

  // Process a single PID reading
  _processReading(data) {
    const { pid, value, timestamp } = data;

    switch (pid) {
      case PIDS.SPEED.pid: {
        const speedMph = kmhToMph(value);
        this.currentData.speed = Math.round(speedMph);
        this.currentData.speedKmh = value;

        // Track max speed
        if (speedMph > this.tripData.maxSpeed) {
          this.tripData.maxSpeed = Math.round(speedMph);
        }

        // Detect hard braking (speed drop > 15 mph in 2 seconds)
        if (this.lastSpeed > 0 && this.lastSpeedTime) {
          const timeDelta = (timestamp - this.lastSpeedTime) / 1000;
          if (timeDelta > 0 && timeDelta <= 3) {
            const deceleration = (this.lastSpeed - speedMph) / timeDelta;
            if (deceleration > 7.5) { // ~15 mph drop in 2s
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

  // Run a diagnostic check (when plugging into a new vehicle)
  async runDiagnostics() {
    if (!obdBLE.isConnected()) return null;

    // Request VIN
    await obdBLE.readPID(PIDS.VIN);

    // Request DTCs (Mode 03)
    await obdBLE.sendCommand('03');

    // Read diagnostic PIDs
    for (const pid of [PIDS.COOLANT_TEMP, PIDS.ENGINE_LOAD, PIDS.BATTERY_VOLTAGE, PIDS.FUEL_LEVEL]) {
      await obdBLE.readPID(pid);
      await new Promise(r => setTimeout(r, 200)); // Small delay between requests
    }

    return this.getSnapshot();
  }
}

// Singleton
export const obdData = new OBDDataManager();
