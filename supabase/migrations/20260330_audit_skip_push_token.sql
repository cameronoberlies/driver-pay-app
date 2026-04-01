-- Skip audit logging for profile updates that only change push_token
-- These fire every time a driver opens the app and are pure noise

create or replace function fn_audit_log()
returns trigger as $$
begin
  if (TG_OP = 'INSERT') then
    insert into audit_log (table_name, record_id, action, new_data, changed_by)
    values (TG_TABLE_NAME, NEW.id::text, 'INSERT', to_jsonb(NEW), auth.uid());
    return NEW;
  elsif (TG_OP = 'UPDATE') then
    -- Skip if the only change is push_token on profiles
    if TG_TABLE_NAME = 'profiles' then
      declare
        old_without jsonb;
        new_without jsonb;
      begin
        old_without := to_jsonb(OLD) - 'push_token' - 'device_os' - 'app_update_id' - 'updated_at';
        new_without := to_jsonb(NEW) - 'push_token' - 'device_os' - 'app_update_id' - 'updated_at';
        if old_without = new_without then
          return NEW;
        end if;
      end;
    end if;

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
