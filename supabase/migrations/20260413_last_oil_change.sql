-- Add oil change due mileage tracking to chase vehicles
ALTER TABLE chase_vehicles ADD COLUMN IF NOT EXISTS oil_change_due_mileage numeric;
