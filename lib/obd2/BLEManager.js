// BLE Connection Manager for Freematics ONE
// Handles scan, connect, disconnect, reconnect, and data streaming
//
// NOTE: This module requires react-native-ble-plx which is a native dependency.
// Until the next native build, BLE calls are stubbed with a mock interface.
// Replace the mock with real BLE calls when react-native-ble-plx is installed.

import { PIDS, parsePIDResponse } from './OBDPids';

// Freematics ONE BLE identifiers
const FREEMATICS_SERVICE_UUID = '0000ffe0-0000-1000-8000-00805f9b34fb'; // TI CC2541 UART service
const FREEMATICS_CHAR_UUID = '0000ffe1-0000-1000-8000-00805f9b34fb'; // TI CC2541 UART characteristic
const FREEMATICS_DEVICE_PREFIX = 'Freematics';

// Connection states
export const BLE_STATE = {
  DISCONNECTED: 'disconnected',
  SCANNING: 'scanning',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  ERROR: 'error',
};

class OBDBLEManager {
  constructor() {
    this.state = BLE_STATE.DISCONNECTED;
    this.device = null;
    this.characteristic = null;
    this.listeners = [];
    this.dataBuffer = '';
    this.onDataCallback = null;
    this.reconnectTimer = null;
    this.bleManager = null; // Will be set when react-native-ble-plx is available
  }

  // Register a state change listener
  onStateChange(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }

  // Notify all listeners of state change
  _setState(newState) {
    this.state = newState;
    this.listeners.forEach(cb => cb(newState));
  }

  // Initialize the BLE manager
  async init() {
    try {
      // TODO: Replace with real BLE manager when react-native-ble-plx is installed
      // const { BleManager } = require('react-native-ble-plx');
      // this.bleManager = new BleManager();
      console.log('[OBD-BLE] Initialized (stub mode - awaiting native build)');
      return true;
    } catch (e) {
      console.log('[OBD-BLE] Init error:', e.message);
      return false;
    }
  }

  // Scan for Freematics ONE devices
  async scan(timeoutMs = 10000) {
    this._setState(BLE_STATE.SCANNING);

    try {
      // TODO: Replace with real BLE scan
      // return new Promise((resolve, reject) => {
      //   const devices = [];
      //   this.bleManager.startDeviceScan(
      //     [FREEMATICS_SERVICE_UUID],
      //     { allowDuplicates: false },
      //     (error, device) => {
      //       if (error) { reject(error); return; }
      //       if (device.name?.startsWith(FREEMATICS_DEVICE_PREFIX)) {
      //         devices.push({ id: device.id, name: device.name, rssi: device.rssi });
      //       }
      //     }
      //   );
      //   setTimeout(() => {
      //     this.bleManager.stopDeviceScan();
      //     this._setState(BLE_STATE.DISCONNECTED);
      //     resolve(devices);
      //   }, timeoutMs);
      // });

      console.log('[OBD-BLE] Scan started (stub)');
      this._setState(BLE_STATE.DISCONNECTED);
      return []; // Stub: return empty array until native build
    } catch (e) {
      console.log('[OBD-BLE] Scan error:', e.message);
      this._setState(BLE_STATE.ERROR);
      return [];
    }
  }

  // Connect to a specific device
  async connect(deviceId) {
    this._setState(BLE_STATE.CONNECTING);

    try {
      // TODO: Replace with real BLE connection
      // const device = await this.bleManager.connectToDevice(deviceId);
      // await device.discoverAllServicesAndCharacteristics();
      // const services = await device.services();
      // for (const service of services) {
      //   const chars = await service.characteristics();
      //   for (const char of chars) {
      //     if (char.uuid === FREEMATICS_CHAR_UUID) {
      //       this.characteristic = char;
      //       break;
      //     }
      //   }
      // }
      // if (!this.characteristic) throw new Error('UART characteristic not found');
      //
      // // Listen for data
      // this.characteristic.monitor((error, char) => {
      //   if (error) { console.log('[OBD-BLE] Monitor error:', error); return; }
      //   const data = Buffer.from(char.value, 'base64').toString('utf8');
      //   this._handleData(data);
      // });
      //
      // // Listen for disconnect
      // this.bleManager.onDeviceDisconnected(deviceId, () => {
      //   this._setState(BLE_STATE.DISCONNECTED);
      //   this._attemptReconnect(deviceId);
      // });
      //
      // this.device = device;
      // this._setState(BLE_STATE.CONNECTED);

      console.log('[OBD-BLE] Connect to', deviceId, '(stub)');
      this._setState(BLE_STATE.DISCONNECTED);
      return false; // Stub
    } catch (e) {
      console.log('[OBD-BLE] Connect error:', e.message);
      this._setState(BLE_STATE.ERROR);
      return false;
    }
  }

  // Disconnect from the current device
  async disconnect() {
    try {
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      // TODO: Replace with real disconnect
      // if (this.device) {
      //   await this.bleManager.cancelDeviceConnection(this.device.id);
      // }
      this.device = null;
      this.characteristic = null;
      this._setState(BLE_STATE.DISCONNECTED);
      console.log('[OBD-BLE] Disconnected');
    } catch (e) {
      console.log('[OBD-BLE] Disconnect error:', e.message);
    }
  }

  // Send a command to the device
  async sendCommand(command) {
    if (!this.characteristic) return null;
    try {
      // TODO: Replace with real BLE write
      // const encoded = Buffer.from(command + '\r').toString('base64');
      // await this.characteristic.writeWithResponse(encoded);
      console.log('[OBD-BLE] Send:', command, '(stub)');
      return true;
    } catch (e) {
      console.log('[OBD-BLE] Send error:', e.message);
      return false;
    }
  }

  // Request a specific OBD PID
  async readPID(pidDef) {
    const modeHex = pidDef.mode.toString(16).padStart(2, '0');
    const pidHex = pidDef.pid.toString(16).padStart(2, '0');
    const command = `${modeHex}${pidHex}`;
    return this.sendCommand(command);
  }

  // Handle incoming data from BLE
  _handleData(data) {
    this.dataBuffer += data;

    // Process complete lines
    const lines = this.dataBuffer.split('\n');
    this.dataBuffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      this._parseLine(trimmed);
    }
  }

  // Parse a single line of data from the Freematics datalogger
  _parseLine(line) {
    // Freematics datalogger format varies by firmware
    // Common formats:
    // CSV: timestamp,pid,value
    // or hex response: 41 0D XX (Mode 01 response for PID 0D)

    // Try hex response format (standard OBD-II response)
    if (line.includes('41')) {
      const parts = line.split(/\s+/).filter(p => /^[0-9A-Fa-f]{2}$/.test(p));
      if (parts.length >= 3 && parts[0] === '41') {
        const pid = parseInt(parts[1], 16);
        const bytes = parts.slice(2).map(b => parseInt(b, 16));
        const value = parsePIDResponse({ pid }, bytes);

        if (this.onDataCallback) {
          this.onDataCallback({ pid, value, raw: line, timestamp: Date.now() });
        }
        return;
      }
    }

    // Try CSV format: timestamp,pid_hex,value
    const csvParts = line.split(',');
    if (csvParts.length >= 3) {
      const pid = parseInt(csvParts[1], 16);
      const value = parseFloat(csvParts[2]);
      if (!isNaN(pid) && !isNaN(value)) {
        if (this.onDataCallback) {
          this.onDataCallback({ pid, value, raw: line, timestamp: Date.now() });
        }
      }
    }
  }

  // Set callback for incoming data
  onData(callback) {
    this.onDataCallback = callback;
  }

  // Auto-reconnect on disconnect
  _attemptReconnect(deviceId) {
    if (this.reconnectTimer) return;
    console.log('[OBD-BLE] Attempting reconnect in 5s...');
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      const success = await this.connect(deviceId);
      if (!success) {
        this._attemptReconnect(deviceId);
      }
    }, 5000);
  }

  // Check if BLE is available (will be real check after native build)
  isAvailable() {
    return false; // Stub until react-native-ble-plx is installed
  }

  // Get current connection state
  getState() {
    return this.state;
  }

  // Check if connected
  isConnected() {
    return this.state === BLE_STATE.CONNECTED;
  }
}

// Singleton instance
export const obdBLE = new OBDBLEManager();
