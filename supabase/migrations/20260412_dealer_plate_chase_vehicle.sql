-- Dealer Plate + Chase Vehicle Stock Number
-- Run in Supabase SQL Editor

alter table trips add column if not exists dealer_plate text;
alter table trips add column if not exists chase_vehicle_stock text;
alter table trips add column if not exists purchased_vehicle_mileage numeric;

-- Vehicle photos table
CREATE TABLE IF NOT EXISTS vehicle_photos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_id uuid REFERENCES trips(id) ON DELETE CASCADE,
  driver_id uuid REFERENCES profiles(id),
  storage_path text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_photos_trip ON vehicle_photos(trip_id);

ALTER TABLE vehicle_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read vehicle_photos"
  ON vehicle_photos FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert vehicle_photos"
  ON vehicle_photos FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can delete vehicle_photos"
  ON vehicle_photos FOR DELETE TO authenticated USING (true);
