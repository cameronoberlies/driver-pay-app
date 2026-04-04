// OBD-II Integration Module
// Entry point for all OBD2 functionality

export { PIDS, TRIP_PIDS, DIAGNOSTIC_PIDS, parsePIDResponse, kmhToMph, kmToMiles, celsiusToFahrenheit } from './OBDPids';
export { obdBLE, BLE_STATE } from './BLEManager';
export { obdData } from './OBDDataManager';
export { decodeVIN, formatVehicle } from './VINDecoder';
export { mockOBD } from './MockOBD';
