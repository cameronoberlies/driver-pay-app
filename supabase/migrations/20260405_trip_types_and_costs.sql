-- Trip Types Expansion & Itemized Cost Breakdown
-- Adds: AA, Courier, Airport trip types + group linking + stock numbers + cost itemization
-- Run in Supabase SQL Editor

-- ─── TRIPS TABLE ─────────────────────────────────────────────────────────────

-- Update trip_type check constraint to allow new types
alter table trips drop constraint if exists trips_trip_type_check;
alter table trips add constraint trips_trip_type_check
  check (trip_type in ('drive', 'fly', 'aa', 'courier', 'airport'));

-- Allow null crm_id (courier/airport trips won't always have one)
alter table trips alter column crm_id drop not null;

-- Group ID for AA convoy trips (all trips in same convoy share this UUID)
alter table trips add column if not exists group_id uuid;

-- Parent trip link for airport driver trips (points to the flyer's trip)
alter table trips add column if not exists parent_trip_id uuid references trips(id) on delete set null;

-- Stock numbers for AA trips (comma-separated, shared across group)
alter table trips add column if not exists stock_numbers text;

-- Itemized cost breakdown (replaces single actual_cost for new trips)
alter table trips add column if not exists flight_cost numeric;
alter table trips add column if not exists rideshare_cost numeric;
alter table trips add column if not exists fuel_cost numeric;
alter table trips add column if not exists other_cost numeric;

-- Indexes for new query patterns
create index if not exists idx_trips_group_id on trips(group_id) where group_id is not null;
create index if not exists idx_trips_parent_trip_id on trips(parent_trip_id) where parent_trip_id is not null;

-- ─── ENTRIES TABLE ───────────────────────────────────────────────────────────

-- Itemized cost columns on entries (mirrors trips for historical record)
alter table entries add column if not exists flight_cost numeric;
alter table entries add column if not exists rideshare_cost numeric;
alter table entries add column if not exists fuel_cost numeric;
alter table entries add column if not exists other_cost numeric;
alter table entries add column if not exists stock_numbers text;
alter table entries add column if not exists trip_type text;

-- ─── NOTES ───────────────────────────────────────────────────────────────────
-- actual_cost is KEPT on both tables for backward compatibility.
-- For new trips, actual_cost = flight_cost + rideshare_cost + fuel_cost + driver_pay + other_cost
-- This is computed in app code during finalization, not via DB trigger.
