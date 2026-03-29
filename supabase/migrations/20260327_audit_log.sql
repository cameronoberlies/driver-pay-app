-- Audit Log Migration
-- Purpose: Automatically track all changes to key tables (trips, profiles, entries)
-- View in Supabase dashboard: Table Editor → audit_log

-- Create audit_log table
create table audit_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  record_id text not null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_data jsonb,
  new_data jsonb,
  changed_by uuid references auth.users(id),
  created_at timestamptz default now()
);

-- Index for common queries
create index idx_audit_log_table on audit_log(table_name, created_at desc);
create index idx_audit_log_record on audit_log(record_id, table_name);
create index idx_audit_log_user on audit_log(changed_by, created_at desc);

-- Generic trigger function
create or replace function fn_audit_log()
returns trigger as $$
begin
  if (TG_OP = 'INSERT') then
    insert into audit_log (table_name, record_id, action, new_data, changed_by)
    values (TG_TABLE_NAME, NEW.id::text, 'INSERT', to_jsonb(NEW), auth.uid());
    return NEW;
  elsif (TG_OP = 'UPDATE') then
    insert into audit_log (table_name, record_id, action, old_data, new_data, changed_by)
    values (TG_TABLE_NAME, NEW.id::text, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW), auth.uid());
    return NEW;
  elsif (TG_OP = 'DELETE') then
    insert into audit_log (table_name, record_id, action, old_data, changed_by)
    values (TG_TABLE_NAME, OLD.id::text, 'DELETE', to_jsonb(OLD), auth.uid());
    return OLD;
  end if;
  return null;
end;
$$ language plpgsql security definer;

-- Attach triggers to key tables
create trigger trg_audit_trips
  after insert or update or delete on trips
  for each row execute function fn_audit_log();

create trigger trg_audit_profiles
  after insert or update or delete on profiles
  for each row execute function fn_audit_log();

create trigger trg_audit_entries
  after insert or update or delete on entries
  for each row execute function fn_audit_log();

-- RLS: only admins can read the audit log (if accessed via API)
alter table audit_log enable row level security;

create policy "Admins can read audit log"
  on audit_log for select
  to authenticated
  using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
    )
  );

-- No insert/update/delete policies — writes happen via the trigger (security definer)
