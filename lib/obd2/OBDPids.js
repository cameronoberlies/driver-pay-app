// OBD-II PID definitions and response parsing
// Reference: SAE J1979 / ISO 15031-5

export const PIDS = {
  // Mode 01 - Current Data
  SPEED: { mode: 0x01, pid: 0x0D, name: 'Vehicle Speed', unit: 'km/h', bytes: 1 },
  RPM: { mode: 0x01, pid: 0x0C, name: 'Engine RPM', unit: 'rpm', bytes: 2 },
  FUEL_LEVEL: { mode: 0x01, pid: 0x2F, name: 'Fuel Tank Level', unit: '%', bytes: 1 },
  COOLANT_TEMP: { mode: 0x01, pid: 0x05, name: 'Coolant Temperature', unit: '°C', bytes: 1 },
  THROTTLE: { mode: 0x01, pid: 0x11, name: 'Throttle Position', unit: '%', bytes: 1 },
  ENGINE_LOAD: { mode: 0x01, pid: 0x04, name: 'Engine Load', unit: '%', bytes: 1 },
  INTAKE_TEMP: { mode: 0x01, pid: 0x0F, name: 'Intake Air Temperature', unit: '°C', bytes: 1 },
  MAF_RATE: { mode: 0x01, pid: 0x10, name: 'MAF Air Flow Rate', unit: 'g/s', bytes: 2 },
  TIMING_ADVANCE: { mode: 0x01, pid: 0x0E, name: 'Timing Advance', unit: '°', bytes: 1 },
  BATTERY_VOLTAGE: { mode: 0x01, pid: 0x42, name: 'Control Module Voltage', unit: 'V', bytes: 2 },
  ODOMETER: { mode: 0x01, pid: 0xA6, name: 'Odometer', unit: 'km', bytes: 4 },
  RUN_TIME: { mode: 0x01, pid: 0x1F, name: 'Run Time Since Start', unit: 's', bytes: 2 },
  DISTANCE_WITH_MIL: { mode: 0x01, pid: 0x21, name: 'Distance with MIL On', unit: 'km', bytes: 2 },
  VIN: { mode: 0x09, pid: 0x02, name: 'VIN', unit: '', bytes: 17 },
};

// Parse raw OBD response bytes into human-readable values
export function parsePIDResponse(pid, bytes) {
  const A = bytes[0] || 0;
  const B = bytes[1] || 0;
  const C = bytes[2] || 0;
  const D = bytes[3] || 0;

  switch (pid) {
    case PIDS.SPEED.pid:
      return A; // km/h

    case PIDS.RPM.pid:
      return ((A * 256) + B) / 4; // rpm

    case PIDS.FUEL_LEVEL.pid:
      return (A * 100) / 255; // %

    case PIDS.COOLANT_TEMP.pid:
      return A - 40; // °C

    case PIDS.THROTTLE.pid:
      return (A * 100) / 255; // %

    case PIDS.ENGINE_LOAD.pid:
      return (A * 100) / 255; // %

    case PIDS.INTAKE_TEMP.pid:
      return A - 40; // °C

    case PIDS.MAF_RATE.pid:
      return ((A * 256) + B) / 100; // g/s

    case PIDS.TIMING_ADVANCE.pid:
      return (A / 2) - 64; // degrees

    case PIDS.BATTERY_VOLTAGE.pid:
      return ((A * 256) + B) / 1000; // V

    case PIDS.ODOMETER.pid:
      return ((A * 16777216) + (B * 65536) + (C * 256) + D) / 10; // km

    case PIDS.RUN_TIME.pid:
      return (A * 256) + B; // seconds

    case PIDS.DISTANCE_WITH_MIL.pid:
      return (A * 256) + B; // km

    default:
      return A;
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

// The PIDs we want to poll during a trip (in order of priority)
export const TRIP_PIDS = [
  PIDS.SPEED,
  PIDS.RPM,
  PIDS.FUEL_LEVEL,
  PIDS.COOLANT_TEMP,
  PIDS.ODOMETER,
];

// The PIDs for a vehicle diagnostic check
export const DIAGNOSTIC_PIDS = [
  PIDS.COOLANT_TEMP,
  PIDS.ENGINE_LOAD,
  PIDS.BATTERY_VOLTAGE,
  PIDS.FUEL_LEVEL,
  PIDS.DISTANCE_WITH_MIL,
  PIDS.THROTTLE,
];
