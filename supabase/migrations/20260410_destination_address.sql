-- Add destination address field to trips
-- Run in Supabase SQL Editor

alter table trips add column if not exists destination_address text;
