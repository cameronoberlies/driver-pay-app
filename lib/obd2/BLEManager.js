// BLE Connection Manager for ELM327 OBD-II Adapters (Veepeak BLE+)
// Handles scan, connect, disconnect, reconnect, and data streaming
// Protocol: ELM327 AT commands, standard OBD-II hex responses

import { BleManager } from 'react-native-ble-plx';
import { Buffer } from 'buffer';
import { parsePIDResponse } from './OBDPids';
import { logEvent } from '../systemLog';

// Veepeak BLE+ OBD-II Adapter identifiers
const OBD_SERVICE_UUID = '0000fff0-0000-1000-8000-00805f9b34fb';
const OBD_WRITE_UUID = '0000fff2-0000-1000-8000-00805f9b34fb';   // Send commands
const OBD_NOTIFY_UUID = '0000fff1-0000-1000-8000-00805f9b34fb';  // Receive responses
const OBD_DEVICE_PREFIX = 'VEEPEAK'; // Can also match other ELM327 adapters

// Connection states
export const BLE_STATE = {
  DISCONNECTED: 'disconnected',
  SCANNING: 'scanning',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  INITIALIZING: 'initializing',
  READY: 'ready',
  ERROR: 'error',
};

class OBDBLEManager {
  constructor() {
    this.state = BLE_STATE.DISCONNECTED;
    this.device = null;
    this.writeChar = null;
    this.notifyChar = null;
    this.listeners = [];
    this.dataBuffer = '';
    this.onDataCallback = null;
    this.reconnectTimer = null;
    this.bleManager = null;
    this.monitorSubscription = null;
    this.disconnectSubscription = null;
    this.pollingInterval = null;
    this.initialized = false;
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

      return new Promise((resolve) => {
        const sub = this.bleManager.onStateChange((state) => {
          if (state === 'PoweredOn') {
            sub.remove();
            console.log('[OBD-BLE] Initialized — BLE powered on');
            resolve(true);
          }
        }, true);

        setTimeout(() => {
          sub.remove();
          resolve(false);
        }, 5000);
      });
    } catch (e) {
      console.log('[OBD-BLE] Init error:', e.message);
      return false;
    }
  }

  // Scan for ELM327 OBD-II adapters
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
          null,
          { allowDuplicates: false },
          (error, device) => {
            if (error) {
              console.log('[OBD-BLE] Scan error:', error.message);
              return;
            }
            // Match known OBD adapter names
            const name = device.name || device.localName || '';
            const isOBD = name.startsWith(OBD_DEVICE_PREFIX) ||
                          name.includes('OBD') ||
                          name.includes('ELM') ||
                          name.includes('Vlink');
            if (isOBD && !seen.has(device.id)) {
              seen.add(device.id);
              devices.push({ id: device.id, name, rssi: device.rssi });
              console.log('[OBD-BLE] Found:', name, device.id, 'RSSI:', device.rssi);
            }
          }
        );

        setTimeout(() => {
          this.bleManager.stopDeviceScan();
          this._setState(BLE_STATE.DISCONNECTED);
          console.log('[OBD-BLE] Scan complete — found', devices.length, 'device(s)');
          logEvent(devices.length > 0 ? 'info' : 'warn', 'obd_scan_complete',
            `OBD scan found ${devices.length} device(s)`,
            { device_count: devices.length, devices: devices.map(d => ({ name: d.name, rssi: d.rssi })) });
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

      // Find write and notify characteristics
      const services = await device.services();
      let writeChar = null;
      let notifyChar = null;

      for (const service of services) {
        const chars = await service.characteristics();
        for (const char of chars) {
          const uuid = char.uuid.toLowerCase();
          // Match FFF2 (write) and FFF1 (notify) by short UUID
          if (uuid.includes('fff2') && (char.isWritableWithResponse || char.isWritableWithoutResponse)) {
            writeChar = char;
          }
          if (uuid.includes('fff1') && (char.isNotifiable || char.isIndicatable)) {
            notifyChar = char;
          }
        }
      }

      if (!writeChar || !notifyChar) {
        // Fallback: find any writable + notifiable pair
        for (const service of services) {
          const chars = await service.characteristics();
          for (const char of chars) {
            if (!writeChar && (char.isWritableWithResponse || char.isWritableWithoutResponse)) {
              writeChar = char;
            }
            if (!notifyChar && (char.isNotifiable || char.isIndicatable)) {
              notifyChar = char;
            }
          }
          if (writeChar && notifyChar) break;
        }
      }

      if (!writeChar || !notifyChar) throw new Error('Required characteristics not found');

      this.writeChar = writeChar;
      this.notifyChar = notifyChar;
      this.device = device;

      // Monitor incoming data on notify characteristic
      this.monitorSubscription = notifyChar.monitor((error, char) => {
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
      this.disconnectSubscription = this.bleManager.onDeviceDisconnected(deviceId, () => {
        console.log('[OBD-BLE] Device disconnected');
        logEvent('warn', 'obd_disconnected', 'OBD device disconnected unexpectedly', { device_id: deviceId });
        this._cleanup();
        this._setState(BLE_STATE.DISCONNECTED);
        this._attemptReconnect(deviceId);
      });

      this._setState(BLE_STATE.CONNECTED);
      console.log('[OBD-BLE] Connected to', device.name || deviceId);
      logEvent('info', 'obd_connected', `OBD connected to ${device.name || deviceId}`,
        { device_id: deviceId, device_name: device.name });

      // Initialize ELM327
      await this._initELM327();

      return true;
    } catch (e) {
      console.log('[OBD-BLE] Connect error:', e.message);
      logEvent('error', 'obd_connect_failed', `OBD connection failed: ${e.message}`,
        { device_id: deviceId, error: e.message });
      this._setState(BLE_STATE.ERROR);
      return false;
    }
  }

  // Initialize ELM327 adapter with AT commands
  async _initELM327() {
    this._setState(BLE_STATE.INITIALIZING);
    console.log('[OBD-BLE] Initializing ELM327...');

    // Reset adapter
    await this._sendAndWait('ATZ', 2000);
    // Echo off
    await this._sendAndWait('ATE0', 500);
    // Line feeds off
    await this._sendAndWait('ATL0', 500);
    // Spaces off (compact responses)
    await this._sendAndWait('ATS0', 500);
    // Auto-detect protocol
    await this._sendAndWait('ATSP0', 500);
    // Set timeout to max (longer search before STOPPED)
    await this._sendAndWait('ATST FF', 500);
    // Adaptive timing on (auto-adjusts once protocol is found)
    await this._sendAndWait('ATAT2', 500);
    // Headers off
    await this._sendAndWait('ATH0', 500);

    this.initialized = true;
    this._setState(BLE_STATE.READY);
    logEvent('info', 'obd_elm327_ready', 'ELM327 initialized and ready for PID requests');
    console.log('[OBD-BLE] ELM327 ready');
  }

  // Send command and wait for > prompt
  async _sendAndWait(command, timeoutMs = 1000) {
    return new Promise((resolve) => {
      let response = '';
      const origCallback = this.onDataCallback;

      // Temporarily capture response
      const timer = setTimeout(() => {
        this.onDataCallback = origCallback;
        resolve(response);
      }, timeoutMs);

      this.onDataCallback = (data) => {
        response += data.raw || '';
      };

      this.sendCommand(command);

      // Also check for prompt in _handleData
      const checkPrompt = setInterval(() => {
        if (response.includes('>')) {
          clearTimeout(timer);
          clearInterval(checkPrompt);
          this.onDataCallback = origCallback;
          resolve(response);
        }
      }, 50);
    });
  }

  // Disconnect from the current device
  async disconnect() {
    try {
      this.stopPolling();
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this._cleanup();
      if (this.device) {
        await this.bleManager.cancelDeviceConnection(this.device.id);
      }
      this.device = null;
      this._setState(BLE_STATE.DISCONNECTED);
      console.log('[OBD-BLE] Disconnected');
    } catch (e) {
      console.log('[OBD-BLE] Disconnect error:', e.message);
      this.device = null;
      this._setState(BLE_STATE.DISCONNECTED);
    }
  }

  _cleanup() {
    if (this.monitorSubscription) {
      this.monitorSubscription.remove();
      this.monitorSubscription = null;
    }
    if (this.disconnectSubscription) {
      this.disconnectSubscription.remove();
      this.disconnectSubscription = null;
    }
    this.writeChar = null;
    this.notifyChar = null;
    this.initialized = false;
  }

  // Send a command to the device
  async sendCommand(command) {
    if (!this.writeChar) return null;
    try {
      const encoded = Buffer.from(command + '\r').toString('base64');
      if (this.writeChar.isWritableWithResponse) {
        await this.writeChar.writeWithResponse(encoded);
      } else {
        await this.writeChar.writeWithoutResponse(encoded);
      }
      return true;
    } catch (e) {
      console.log('[OBD-BLE] Send error:', e.message);
      return false;
    }
  }

  // Request a specific OBD PID (Mode 01)
  async readPID(pidDef) {
    const modeHex = pidDef.mode.toString(16).padStart(2, '0');
    const pidHex = pidDef.pid.toString(16).padStart(2, '0');
    const command = `${modeHex}${pidHex}`;
    return this.sendCommand(command);
  }

  // Start polling PIDs at regular interval
  startPolling(pids, intervalMs = 2000) {
    this.stopPolling();
    let pidIndex = 0;

    this.pollingInterval = setInterval(async () => {
      if (!this.initialized || this.state !== BLE_STATE.READY) return;

      const pid = pids[pidIndex];
      await this.readPID(pid);
      pidIndex = (pidIndex + 1) % pids.length;
    }, intervalMs);

    console.log('[OBD-BLE] Polling started —', pids.length, 'PIDs every', intervalMs, 'ms');
  }

  // Stop polling
  stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  // Handle incoming data from BLE
  _handleData(data) {
    this.dataBuffer += data;

    // Process complete responses (terminated by > prompt)
    while (this.dataBuffer.includes('>')) {
      const promptIdx = this.dataBuffer.indexOf('>');
      const response = this.dataBuffer.substring(0, promptIdx).trim();
      this.dataBuffer = this.dataBuffer.substring(promptIdx + 1);

      if (!response) continue;

      // Split multi-line responses
      const lines = response.split('\r').filter(l => l.trim());
      for (const line of lines) {
        this._parseLine(line.trim());
      }
    }
  }

  // Parse a single line — standard OBD-II hex response
  // Format: 41 0D XX (Mode 01 response for PID 0D = speed)
  // With ATS0 (spaces off): 410DXX
  _parseLine(line) {
    // Skip AT command echoes, errors, and status messages
    if (!line || line.startsWith('AT') || line === 'OK' || line === 'SEARCHING...' ||
        line === 'UNABLE TO CONNECT' || line === 'NO DATA' || line === 'ERROR' ||
        line === 'STOPPED' || line.startsWith('ELM') || line === '?') {
      return;
    }

    // Parse hex response — with or without spaces
    const hex = line.replace(/\s/g, '');

    // Mode 01 response starts with '41'
    if (hex.startsWith('41') && hex.length >= 6) {
      const pid = parseInt(hex.substring(2, 4), 16);
      // Extract data bytes
      const dataHex = hex.substring(4);
      const bytes = [];
      for (let i = 0; i < dataHex.length; i += 2) {
        bytes.push(parseInt(dataHex.substring(i, i + 2), 16));
      }

      const value = parsePIDResponse(pid, bytes);

      if (this.onDataCallback && value !== null) {
        this.onDataCallback({ pid, value, raw: line, timestamp: Date.now() });
      }
      return;
    }

    // Mode 09 response (VIN) — multi-frame ISO-TP response
    // Format: line 1 starts "49020135..." (49=mode, 02=PID, 01=msg count, 35='5' first VIN char)
    // Subsequent lines start with frame number (0:..., 1:..., 2:...) followed by hex chars
    if (hex.startsWith('4902')) {
      // First frame: skip "4902" + 2 chars (msg count) + 6 chars (3 padding bytes 0x00)
      // Then ASCII chars start
      this._vinBuffer = hex.substring(10); // chars after "490201000000"
      return;
    }
    // Continuation frames (line starts with "0:", "1:", "2:" etc, but spaces stripped)
    // After ATS0 these come as raw hex without the frame prefix in some cases
    if (this._vinBuffer && /^[0-9A-Fa-f]+$/.test(hex) && hex.length >= 2 && !hex.startsWith('41') && !hex.startsWith('43')) {
      this._vinBuffer += hex;
      // VIN is 17 chars = 34 hex chars. First frame has 4-7 chars, remaining ~10-13 in continuations
      if (this._vinBuffer.length >= 34) {
        const vinChars = [];
        for (let i = 0; i < this._vinBuffer.length && vinChars.length < 17; i += 2) {
          const code = parseInt(this._vinBuffer.substring(i, i + 2), 16);
          if (code >= 32 && code <= 126) vinChars.push(String.fromCharCode(code));
        }
        const vin = vinChars.join('');
        if (vin.length === 17 && this.onDataCallback) {
          this.onDataCallback({ pid: 'VIN', value: vin, raw: line, timestamp: Date.now() });
        }
        this._vinBuffer = null;
      }
      return;
    }

    // Mode 03 response (DTCs) starts with '43'
    if (hex.startsWith('43')) {
      const dtcHex = hex.substring(2);
      const codes = [];
      for (let i = 0; i < dtcHex.length; i += 4) {
        if (i + 4 > dtcHex.length) break;
        const dtcRaw = parseInt(dtcHex.substring(i, i + 4), 16);
        if (dtcRaw === 0) continue;
        const firstChar = ['P', 'C', 'B', 'U'][(dtcRaw >> 14) & 0x03];
        const code = firstChar + ((dtcRaw >> 12) & 0x03).toString() +
                     ((dtcRaw >> 8) & 0x0F).toString(16).toUpperCase() +
                     ((dtcRaw >> 4) & 0x0F).toString(16).toUpperCase() +
                     (dtcRaw & 0x0F).toString(16).toUpperCase();
        codes.push(code);
      }
      if (codes.length > 0 && this.onDataCallback) {
        this.onDataCallback({ pid: 'DTC', value: codes, raw: line, timestamp: Date.now() });
      }
      return;
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

  // Check if connected and initialized
  isConnected() {
    return this.state === BLE_STATE.READY || this.state === BLE_STATE.CONNECTED;
  }

  // Destroy the BLE manager
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
