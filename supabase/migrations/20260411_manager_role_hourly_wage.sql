-- Manager Role + Hourly Wage
-- Run in Supabase SQL Editor

-- Add hourly_wage to driver profiles
alter table profiles add column if not exists hourly_wage numeric;

-- No constraint changes needed — role is a text column that accepts any value
-- New valid roles: 'admin', 'manager', 'caller', 'driver'
-- Manager = admin access without pay visibility + can be assigned as a driver
