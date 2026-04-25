-- Chase Vehicles Fleet Management
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS chase_vehicles (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  stock_number text NOT NULL UNIQUE,
  vin text,
  year integer,
  make text,
  model text,
  current_mileage numeric DEFAULT 0,
  status text DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'sold')),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Log of mileage additions from trips
CREATE TABLE IF NOT EXISTS chase_vehicle_mileage_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vehicle_id uuid REFERENCES chase_vehicles(id) ON DELETE CASCADE,
  trip_id uuid REFERENCES trips(id) ON DELETE SET NULL,
  miles_added numeric NOT NULL,
  trip_city text,
  trip_date text,
  driver_name text,
  created_at timestamptz DEFAULT now()
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_chase_vehicles_stock ON chase_vehicles(stock_number);
CREATE INDEX IF NOT EXISTS idx_mileage_log_vehicle ON chase_vehicle_mileage_log(vehicle_id);

-- RLS: admins and managers can read/write
ALTER TABLE chase_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE chase_vehicle_mileage_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read chase_vehicles"
  ON chase_vehicles FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert chase_vehicles"
  ON chase_vehicles FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update chase_vehicles"
  ON chase_vehicles FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete chase_vehicles"
  ON chase_vehicles FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can read mileage_log"
  ON chase_vehicle_mileage_log FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert mileage_log"
  ON chase_vehicle_mileage_log FOR INSERT TO authenticated WITH CHECK (true);
