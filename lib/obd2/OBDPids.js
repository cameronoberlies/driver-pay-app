// OBD-II PID definitions and response parsing
// For ELM327 adapters (Veepeak BLE+)
// Responses arrive as hex: 410DXX (Mode 01 response for PID 0D)
// Values need formula parsing from raw bytes

export const PIDS = {
  // Mode 01 - Current Data
  SPEED:            { mode: 0x01, pid: 0x0D, name: 'Vehicle Speed', unit: 'km/h' },
  RPM:              { mode: 0x01, pid: 0x0C, name: 'Engine RPM', unit: 'rpm' },
  FUEL_LEVEL:       { mode: 0x01, pid: 0x2F, name: 'Fuel Tank Level', unit: '%' },
  COOLANT_TEMP:     { mode: 0x01, pid: 0x05, name: 'Coolant Temperature', unit: '°C' },
  THROTTLE:         { mode: 0x01, pid: 0x11, name: 'Throttle Position', unit: '%' },
  ENGINE_LOAD:      { mode: 0x01, pid: 0x04, name: 'Engine Load', unit: '%' },
  INTAKE_TEMP:      { mode: 0x01, pid: 0x0F, name: 'Intake Air Temperature', unit: '°C' },
  MAF_RATE:         { mode: 0x01, pid: 0x10, name: 'MAF Air Flow Rate', unit: 'g/s' },
  TIMING_ADVANCE:   { mode: 0x01, pid: 0x0E, name: 'Timing Advance', unit: '°' },
  BATTERY_VOLTAGE:  { mode: 0x01, pid: 0x42, name: 'Control Module Voltage', unit: 'V' },
  ODOMETER:         { mode: 0x01, pid: 0xA6, name: 'Odometer', unit: 'km' },
  RUN_TIME:         { mode: 0x01, pid: 0x1F, name: 'Run Time Since Start', unit: 's' },
  DISTANCE_WITH_MIL:{ mode: 0x01, pid: 0x21, name: 'Distance with MIL On', unit: 'km' },
  OIL_TEMP:         { mode: 0x01, pid: 0x5C, name: 'Engine Oil Temperature', unit: '°C' },
  // Mode 09 - Vehicle Information
  VIN:              { mode: 0x09, pid: 0x02, name: 'VIN', unit: '' },
};

// Parse raw OBD response bytes into human-readable values
// pid = the PID number (e.g. 0x0D for speed)
// bytes = array of data bytes after the mode+pid in the response
export function parsePIDResponse(pid, bytes) {
  const A = bytes[0] ?? 0;
  const B = bytes[1] ?? 0;
  const C = bytes[2] ?? 0;
  const D = bytes[3] ?? 0;

  switch (pid) {
    case 0x0D: return A;                              // Speed: km/h
    case 0x0C: return ((A * 256) + B) / 4;            // RPM
    case 0x2F: return (A * 100) / 255;                // Fuel Level: %
    case 0x05: return A - 40;                         // Coolant Temp: °C
    case 0x11: return (A * 100) / 255;                // Throttle: %
    case 0x04: return (A * 100) / 255;                // Engine Load: %
    case 0x0F: return A - 40;                         // Intake Temp: °C
    case 0x10: return ((A * 256) + B) / 100;          // MAF Rate: g/s
    case 0x0E: return (A / 2) - 64;                   // Timing Advance: degrees
    case 0x42: return ((A * 256) + B) / 1000;         // Battery Voltage: V
    case 0xA6: return ((A * 16777216) + (B * 65536) + (C * 256) + D) / 10; // Odometer: km
    case 0x1F: return (A * 256) + B;                  // Run Time: seconds
    case 0x21: return (A * 256) + B;                  // Distance with MIL: km
    case 0x5C: return A - 40;                         // Oil Temp: °C
    default:   return A;
  }
}

// Convert km/h to mph
export function kmhToMph(kmh) {
  return kmh * 0.621371;
}

// Convert km to miles
export function kmToMiles(km) {
  return km * 0.621371;
}

// Convert °C to °F
export function celsiusToFahrenheit(c) {
  return (c * 9 / 5) + 32;
}

// PIDs to poll during a trip (in priority order)
export const TRIP_PIDS = [
  PIDS.SPEED,
  PIDS.RPM,
  PIDS.FUEL_LEVEL,
  PIDS.COOLANT_TEMP,
  PIDS.ODOMETER,
];

// PIDs for diagnostic check
export const DIAGNOSTIC_PIDS = [
  PIDS.COOLANT_TEMP,
  PIDS.ENGINE_LOAD,
  PIDS.BATTERY_VOLTAGE,
  PIDS.FUEL_LEVEL,
  PIDS.DISTANCE_WITH_MIL,
  PIDS.THROTTLE,
];
