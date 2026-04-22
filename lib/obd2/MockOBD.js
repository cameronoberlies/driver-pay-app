// Mock OBD Data Generator
// Simulates a Freematics ONE device for UI testing without BLE hardware
// Enable by calling mockOBD.start() — disable with mockOBD.stop()

import { obdBLE, BLE_STATE } from './BLEManager';
import { obdData } from './OBDDataManager';
import { PIDS } from './OBDPids';
import { decodeVIN } from './VINDecoder';

const MOCK_VIN = '1HGCM82633A004352'; // 2003 Honda Accord (for testing)

class MockOBDGenerator {
  constructor() {
    this.running = false;
    this.interval = null;
    this.speed = 0;
    this.rpm = 800;
    this.fuel = 78;
    this.coolant = 85; // °C
    this.odometer = 45230.5; // km
    this.throttle = 0;
    this.batteryV = 14.2;
    this.phase = 'idle'; // idle, accelerating, cruising, decelerating, stopped
    this.phaseTimer = 0;
  }

  async start() {
    if (this.running) return;
    this.running = true;

    console.log('[MockOBD] Starting simulation');

    // Simulate connection
    obdBLE._setState(BLE_STATE.CONNECTED);
    obdBLE.device = { id: 'mock-freematics-001', name: 'Freematics ONE (Mock)' };

    // Start recording
    obdData.startRecording();

    // Decode mock VIN
    const vehicle = await decodeVIN(MOCK_VIN);
    if (vehicle) {
      // Store vehicle info for UI
      obdData.currentData.vehicle = vehicle;
    }

    // Set up the data callback
    obdBLE.onData((data) => {
      if (!this.running) return;
      // OBDDataManager processes this automatically
    });

    // Simulate data at 1Hz (every second)
    this.interval = setInterval(() => {
      if (!this.running) return;
      this._tick();
    }, 1000);
  }

  stop() {
    this.running = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    const summary = obdData.stopRecording();
    obdBLE._setState(BLE_STATE.DISCONNECTED);
    obdBLE.device = null;

    console.log('[MockOBD] Stopped. Summary:', summary);
    return summary;
  }

  _tick() {
    this.phaseTimer++;

    // Simulate driving phases
    switch (this.phase) {
      case 'idle':
        if (this.phaseTimer > 5) {
          this.phase = 'accelerating';
          this.phaseTimer = 0;
        }
        break;

      case 'accelerating':
        this.speed = Math.min(this.speed + 3 + Math.random() * 4, 75);
        this.rpm = 800 + (this.speed * 35);
        this.throttle = 40 + Math.random() * 30;
        if (this.phaseTimer > 15) {
          this.phase = 'cruising';
          this.phaseTimer = 0;
        }
        break;

      case 'cruising':
        this.speed = 65 + (Math.random() - 0.5) * 10;
        this.rpm = 2200 + (Math.random() - 0.5) * 400;
        this.throttle = 15 + Math.random() * 10;
        if (this.phaseTimer > 30) {
          this.phase = Math.random() > 0.5 ? 'decelerating' : 'speeding';
          this.phaseTimer = 0;
        }
        break;

      case 'speeding':
        this.speed = Math.min(this.speed + 2 + Math.random() * 3, 95);
        this.rpm = 3000 + (this.speed * 20);
        this.throttle = 60 + Math.random() * 30;
        if (this.phaseTimer > 10) {
          this.phase = 'cruising';
          this.phaseTimer = 0;
        }
        break;

      case 'decelerating':
        this.speed = Math.max(this.speed - 5 - Math.random() * 5, 0);
        this.rpm = Math.max(800, 800 + (this.speed * 30));
        this.throttle = Math.max(0, this.throttle - 5);
        if (this.speed <= 0) {
          this.phase = 'stopped';
          this.phaseTimer = 0;
        }
        break;

      case 'stopped':
        this.speed = 0;
        this.rpm = 750 + Math.random() * 100;
        this.throttle = 0;
        if (this.phaseTimer > 10) {
          this.phase = 'accelerating';
          this.phaseTimer = 0;
        }
        break;
    }

    // Update continuous values
    this.coolant = Math.min(95, this.coolant + 0.05);
    this.fuel = Math.max(0, this.fuel - 0.002);
    this.odometer += (this.speed / 3600); // km traveled this second
    this.batteryV = 13.8 + Math.random() * 0.8;

    // Feed data to OBDDataManager via the BLE callback
    const now = Date.now();
    // ELM327 format: values already parsed (as if parsePIDResponse ran)
    const readings = [
      { pid: PIDS.SPEED.pid, value: Math.round(this.speed / 0.621371), timestamp: now },
      { pid: PIDS.RPM.pid, value: Math.round(this.rpm), timestamp: now },
      { pid: PIDS.FUEL_LEVEL.pid, value: Math.round(this.fuel), timestamp: now },
      { pid: PIDS.COOLANT_TEMP.pid, value: Math.round(this.coolant), timestamp: now },
      { pid: PIDS.THROTTLE.pid, value: Math.round(this.throttle), timestamp: now },
      { pid: PIDS.BATTERY_VOLTAGE.pid, value: this.batteryV, timestamp: now },
      { pid: PIDS.ENGINE_LOAD.pid, value: Math.round(this.throttle * 0.7), timestamp: now },
      { pid: PIDS.ODOMETER.pid, value: this.odometer, timestamp: now },
    ];

    // Send each reading through the data callback
    for (const reading of readings) {
      if (obdBLE.onDataCallback) {
        obdBLE.onDataCallback(reading);
      }
    }
  }

  isRunning() {
    return this.running;
  }
}

export const mockOBD = new MockOBDGenerator();
