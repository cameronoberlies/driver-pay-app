-- Turned Down + Additional Recon Cost
-- Run in Supabase SQL Editor

-- Trips table
alter table trips add column if not exists turned_down boolean default false;
alter table trips add column if not exists has_additional_recon boolean default false;
alter table trips add column if not exists additional_recon_cost numeric;

-- Entries table
alter table entries add column if not exists turned_down boolean default false;
alter table entries add column if not exists has_additional_recon boolean default false;
alter table entries add column if not exists additional_recon_cost numeric;
