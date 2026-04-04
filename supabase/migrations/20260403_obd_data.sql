-- OBD-II data column on trips table
-- Stores vehicle telemetry collected during trips via Freematics ONE

alter table trips add column if not exists obd_data jsonb;

-- Example obd_data structure:
-- {
--   "obd_connected": true,
--   "vehicle": { "vin": "1HGCM82633A004352", "year": 2023, "make": "Honda", "model": "Accord" },
--   "odometer_start": 45230.5,
--   "odometer_end": 45560.2,
--   "odometer_miles": 329.7,
--   "max_speed": 87,
--   "max_rpm": 4200,
--   "fuel_start": 85,
--   "fuel_end": 42,
--   "fuel_used": 43,
--   "hard_brakes": 3,
--   "hard_accelerations": 1,
--   "diagnostic_codes": ["P0301", "P0420"]
-- }
