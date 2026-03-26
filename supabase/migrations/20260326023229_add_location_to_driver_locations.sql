-- Add location column to driver_locations table for reverse geocoding
-- This stores city/state like "Charlotte, NC" or "Gaston County, NC"

ALTER TABLE driver_locations 
ADD COLUMN IF NOT EXISTS location TEXT;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_driver_locations_location 
ON driver_locations(location);

-- Add comment
COMMENT ON COLUMN driver_locations.location IS 'Reverse geocoded location (city, state) from GPS coordinates';