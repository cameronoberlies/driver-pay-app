// BLE Connection Manager for Freematics ONE
// Handles scan, connect, disconnect, reconnect, and data streaming

import { BleManager } from 'react-native-ble-plx';
import { Platform } from 'react-native';
import { PIDS, parsePIDResponse } from './OBDPids';
import { Buffer } from 'buffer';

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
    this.bleManager = null;
    this.monitorSubscription = null;
    this.disconnectSubscription = null;
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
      if (!this.bleManager) {
        this.bleManager = new BleManager();
      }

      // Wait for BLE to be powered on
      return new Promise((resolve) => {
        const sub = this.bleManager.onStateChange((state) => {
          if (state === 'PoweredOn') {
            sub.remove();
            console.log('[OBD-BLE] Initialized — BLE powered on');
            resolve(true);
          }
        }, true);

        // Timeout after 5 seconds
        setTimeout(() => {
          sub.remove();
          if (this.bleManager.state() !== 'PoweredOn') {
            console.log('[OBD-BLE] BLE not powered on after 5s');
            resolve(false);
          }
        }, 5000);
      });
    } catch (e) {
      console.log('[OBD-BLE] Init error:', e.message);
      return false;
    }
  }

  // Scan for Freematics ONE devices
  async scan(timeoutMs = 10000) {
    if (!this.bleManager) {
      console.log('[OBD-BLE] Not initialized — call init() first');
      return [];
    }

    this._setState(BLE_STATE.SCANNING);

    try {
      return new Promise((resolve) => {
        const devices = [];
        const seen = new Set();

        this.bleManager.startDeviceScan(
          null, // Scan all services — some Freematics firmware may not advertise the UART service UUID
          { allowDuplicates: false },
          (error, device) => {
            if (error) {
              console.log('[OBD-BLE] Scan error:', error.message);
              return;
            }
            if (device.name?.startsWith(FREEMATICS_DEVICE_PREFIX) && !seen.has(device.id)) {
              seen.add(device.id);
              devices.push({ id: device.id, name: device.name, rssi: device.rssi });
              console.log('[OBD-BLE] Found:', device.name, device.id, 'RSSI:', device.rssi);
            }
          }
        );

        setTimeout(() => {
          this.bleManager.stopDeviceScan();
          this._setState(BLE_STATE.DISCONNECTED);
          console.log('[OBD-BLE] Scan complete — found', devices.length, 'device(s)');
          resolve(devices);
        }, timeoutMs);
      });
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
      const device = await this.bleManager.connectToDevice(deviceId, {
        requestMTU: 512,
        timeout: 10000,
      });
      await device.discoverAllServicesAndCharacteristics();

      // Find the UART characteristic
      const services = await device.services();
      let foundChar = null;
      for (const service of services) {
        const chars = await service.characteristics();
        for (const char of chars) {
          if (char.uuid === FREEMATICS_CHAR_UUID) {
            foundChar = char;
            break;
          }
        }
        if (foundChar) break;
      }

      if (!foundChar) {
        // Some Freematics devices use a different UUID scheme — try the first writable characteristic
        for (const service of services) {
          const chars = await service.characteristics();
          for (const char of chars) {
            if (char.isWritableWithResponse || char.isWritableWithoutResponse) {
              if (char.isNotifiable || char.isIndicatable) {
                foundChar = char;
                console.log('[OBD-BLE] Using fallback characteristic:', char.uuid);
                break;
              }
            }
          }
          if (foundChar) break;
        }
      }

      if (!foundChar) throw new Error('No suitable UART characteristic found');

      this.characteristic = foundChar;
      this.device = device;

      // Monitor incoming data
      this.monitorSubscription = foundChar.monitor((error, char) => {
        if (error) {
          console.log('[OBD-BLE] Monitor error:', error.message);
          return;
        }
        if (char?.value) {
          const data = Buffer.from(char.value, 'base64').toString('utf8');
          this._handleData(data);
        }
      });

      // Listen for disconnect
      this.disconnectSubscription = this.bleManager.onDeviceDisconnected(deviceId, (error, dev) => {
        console.log('[OBD-BLE] Device disconnected', error?.message || '');
        this.device = null;
        this.characteristic = null;
        if (this.monitorSubscription) {
          this.monitorSubscription.remove();
          this.monitorSubscription = null;
        }
        this._setState(BLE_STATE.DISCONNECTED);
        this._attemptReconnect(deviceId);
      });

      this._setState(BLE_STATE.CONNECTED);
      console.log('[OBD-BLE] Connected to', device.name || deviceId);
      return true;
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
      if (this.monitorSubscription) {
        this.monitorSubscription.remove();
        this.monitorSubscription = null;
      }
      if (this.disconnectSubscription) {
        this.disconnectSubscription.remove();
        this.disconnectSubscription = null;
      }
      if (this.device) {
        await this.bleManager.cancelDeviceConnection(this.device.id);
      }
      this.device = null;
      this.characteristic = null;
      this._setState(BLE_STATE.DISCONNECTED);
      console.log('[OBD-BLE] Disconnected');
    } catch (e) {
      console.log('[OBD-BLE] Disconnect error:', e.message);
      this.device = null;
      this.characteristic = null;
      this._setState(BLE_STATE.DISCONNECTED);
    }
  }

  // Send a command to the device
  async sendCommand(command) {
    if (!this.characteristic) return null;
    try {
      const encoded = Buffer.from(command + '\r').toString('base64');
      if (this.characteristic.isWritableWithResponse) {
        await this.characteristic.writeWithResponse(encoded);
      } else {
        await this.characteristic.writeWithoutResponse(encoded);
      }
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
      if (!trimmed || trimmed === '>' || trimmed === 'OK' || trimmed === 'SEARCHING...') continue;
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

  // Check if BLE is available
  isAvailable() {
    return !!this.bleManager;
  }

  // Get current connection state
  getState() {
    return this.state;
  }

  // Check if connected
  isConnected() {
    return this.state === BLE_STATE.CONNECTED;
  }

  // Destroy the BLE manager (cleanup on app unmount)
  destroy() {
    this.disconnect();
    if (this.bleManager) {
      this.bleManager.destroy();
      this.bleManager = null;
    }
  }
}

// Singleton instance
export const obdBLE = new OBDBLEManager();
