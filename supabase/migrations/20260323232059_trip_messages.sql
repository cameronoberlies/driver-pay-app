-- Trip Messages Migration
-- Purpose: Enable trip-scoped messaging between drivers and admins
-- Created: March 23, 2026

-- Create trip_messages table
create table trip_messages (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  sender_id uuid not null references profiles(id) on delete cascade,
  content text not null,
  created_at timestamptz default now()
);

-- Enable RLS
alter table trip_messages enable row level security;

-- RLS policy: Users can read messages for trips they're involved in
create policy "Users can read messages for trips they're involved in"
on trip_messages for select
to authenticated
using (
  trip_id in (
    select id from trips 
    where driver_id = auth.uid() 
       or second_driver_id = auth.uid() 
       or exists (
         select 1 from profiles 
         where id = auth.uid() and role = 'admin'
       )
  )
);

-- RLS policy: Users can send messages for trips they're involved in
create policy "Users can send messages for trips they're involved in"
on trip_messages for insert
to authenticated
with check (
  trip_id in (
    select id from trips 
    where driver_id = auth.uid() 
       or second_driver_id = auth.uid() 
       or exists (
         select 1 from profiles 
         where id = auth.uid() and role = 'admin'
       )
  )
);

-- Create index for faster queries
create index trip_messages_trip_id_idx on trip_messages(trip_id);
create index trip_messages_created_at_idx on trip_messages(created_at desc);

-- Success message
select 'trip_messages table created successfully' as status;