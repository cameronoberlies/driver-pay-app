-- Track when obd_speed/rpm/fuel were last refreshed by an actual BLE PID
-- response. The row's `updated_at` reflects any location-only write, so we need
-- a separate timestamp to detect stale OBD values (e.g. BLE silently died but
-- the foreground location task keeps writing lat/lng).
ALTER TABLE driver_locations ADD COLUMN IF NOT EXISTS obd_updated_at timestamptz;
