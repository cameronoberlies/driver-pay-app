-- Add Radar columns to trips table
ALTER TABLE trips 
ADD COLUMN IF NOT EXISTS radar_trip_id TEXT,
ADD COLUMN IF NOT EXISTS radar_external_id TEXT,
ADD COLUMN IF NOT EXISTS route_geojson JSONB,
ADD COLUMN IF NOT EXISTS actual_distance_miles NUMERIC,
ADD COLUMN IF NOT EXISTS actual_duration_minutes INTEGER,
ADD COLUMN IF NOT EXISTS radar_events JSONB;

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_trips_radar_trip_id ON trips(radar_trip_id);
CREATE INDEX IF NOT EXISTS idx_trips_radar_external_id ON trips(radar_external_id);

-- Create webhook logs table for debugging
CREATE TABLE IF NOT EXISTS radar_webhook_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id),
  trip_id UUID REFERENCES trips(id),
  payload JSONB NOT NULL,
  processed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for webhook logs
CREATE INDEX IF NOT EXISTS idx_radar_logs_event_type ON radar_webhook_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_radar_logs_user_id ON radar_webhook_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_radar_logs_created_at ON radar_webhook_logs(created_at);

-- Enable RLS on webhook logs (only admins can read)
ALTER TABLE radar_webhook_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view webhook logs" ON radar_webhook_logs 
FOR SELECT USING (
  (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
);

-- Grant permissions
GRANT ALL ON TABLE radar_webhook_logs TO anon, authenticated, service_role;