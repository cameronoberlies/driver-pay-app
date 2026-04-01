-- System Logs Migration
-- Purpose: Centralized logging for errors, activity, and system events across all projects
-- Sources: mobile app, web app, flight-monitor, edge functions

create table system_logs (
  id bigint generated always as identity primary key,
  source text not null check (source in ('mobile', 'web', 'flight_monitor', 'edge_function')),
  level text not null check (level in ('info', 'warn', 'error')),
  event text not null,
  message text,
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

-- Indexes for common dashboard queries
create index idx_system_logs_source_time on system_logs(source, created_at desc);
create index idx_system_logs_level_time on system_logs(level, created_at desc);
create index idx_system_logs_event on system_logs(event, created_at desc);

-- RLS: service role can write, only admin users can read via API
alter table system_logs enable row level security;

-- Allow any authenticated user to insert (the app clients need this)
create policy "Authenticated users can insert logs"
  on system_logs for insert
  to authenticated
  with check (true);

-- Allow anonymous inserts too (for edge functions and flight-monitor using anon key)
create policy "Anon can insert logs"
  on system_logs for insert
  to anon
  with check (true);

-- Only admins can read logs
create policy "Admins can read system logs"
  on system_logs for select
  to authenticated
  using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
    )
  );

-- Auto-cleanup: remove logs older than 90 days (run via pg_cron or manual)
-- To enable: select cron.schedule('cleanup-system-logs', '0 3 * * *', $$delete from system_logs where created_at < now() - interval '90 days'$$);
