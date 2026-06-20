-- Phase 1 of the stale-tracking audit response: provenance instrumentation.
-- Every driver_locations write will stamp these three columns so we can answer
-- (a) which code path wrote this row, (b) how old the GPS fix was at write
-- time, and (c) what app state the device was in. Without these, the four
-- tracking paths are indistinguishable on the dashboard and we can't tell
-- "iOS never woke us" from "iOS woke us but Supabase rejected the write".
ALTER TABLE driver_locations ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE driver_locations ADD COLUMN IF NOT EXISTS fix_age_ms integer;
ALTER TABLE driver_locations ADD COLUMN IF NOT EXISTS app_state text;
