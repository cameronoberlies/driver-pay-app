-- Track whether the "remember to leave 1/4 tank" push has already fired for
-- this trip so the detect-stops cron only sends it once. Flipped true by the
-- cron when the driver crosses ~13mi from the dealership on the inbound leg.
ALTER TABLE trips ADD COLUMN IF NOT EXISTS fuel_reminder_sent boolean DEFAULT false;
