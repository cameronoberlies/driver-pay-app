-- Add real ETA columns to driver_locations (populated by update-driver-etas edge function)
ALTER TABLE driver_locations ADD COLUMN IF NOT EXISTS eta_minutes integer;
ALTER TABLE driver_locations ADD COLUMN IF NOT EXISTS eta_miles integer;
ALTER TABLE driver_locations ADD COLUMN IF NOT EXISTS eta_updated_at timestamptz;
