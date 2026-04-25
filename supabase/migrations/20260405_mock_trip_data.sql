-- ============================================================================
-- MOCK TRIP DATA — Run in Supabase SQL Editor to visualize new trip types
--
-- To clean up later:
--   DELETE FROM trips WHERE notes LIKE '[MOCK]%';
-- ============================================================================

DO $$
DECLARE
  driver_ids uuid[];
  d1 uuid;
  d2 uuid;
  d3 uuid;
  aa_group_1 uuid := gen_random_uuid();
  aa_group_2 uuid := gen_random_uuid();
  aa_group_3 uuid := gen_random_uuid();
  fly_trip_id uuid;
BEGIN
  -- Grab up to 3 real driver IDs
  SELECT array_agg(id ORDER BY name) INTO driver_ids
  FROM (SELECT id, name FROM profiles WHERE role = 'driver' LIMIT 3) sub;

  IF driver_ids IS NULL OR array_length(driver_ids, 1) < 1 THEN
    RAISE EXCEPTION 'No driver profiles found — create drivers first.';
  END IF;

  d1 := driver_ids[1];
  d2 := COALESCE(driver_ids[2], d1);
  d3 := COALESCE(driver_ids[3], d1);

  -- ═══════════════════════════════════════════════════════════════════════════
  -- AA GROUP 1: 3 drivers, ALL completed → ready for "Finalize Group"
  -- ═══════════════════════════════════════════════════════════════════════════
  INSERT INTO trips (driver_id, designated_driver_id, trip_type, city, crm_id, status,
    scheduled_pickup, actual_start, actual_end, notes, group_id, stock_numbers)
  VALUES
    (d1, d1, 'aa', 'Manheim, PA', 'AA-001', 'completed',
     NOW() - interval '2 hours', NOW() - interval '2 hours', NOW() - interval '30 minutes',
     '[MOCK] AA group 1 - driver 1', aa_group_1, 'STK-1001, STK-1002, STK-1003'),
    (d2, d2, 'aa', 'Manheim, PA', 'AA-001', 'completed',
     NOW() - interval '2 hours', NOW() - interval '2 hours', NOW() - interval '25 minutes',
     '[MOCK] AA group 1 - driver 2', aa_group_1, 'STK-1001, STK-1002, STK-1003'),
    (d3, d3, 'aa', 'Manheim, PA', 'AA-001', 'completed',
     NOW() - interval '2 hours', NOW() - interval '110 minutes', NOW() - interval '20 minutes',
     '[MOCK] AA group 1 - driver 3', aa_group_1, 'STK-1001, STK-1002, STK-1003');

  -- ═══════════════════════════════════════════════════════════════════════════
  -- AA GROUP 2: 2 drivers, mixed (1 in_progress + 1 completed)
  -- ═══════════════════════════════════════════════════════════════════════════
  INSERT INTO trips (driver_id, designated_driver_id, trip_type, city, crm_id, status,
    scheduled_pickup, actual_start, actual_end, notes, group_id, stock_numbers)
  VALUES
    (d1, d1, 'aa', 'Manheim, PA', 'AA-002', 'in_progress',
     NOW() - interval '1 hour', NOW() - interval '1 hour', NULL,
     '[MOCK] AA group 2 - still driving', aa_group_2, 'STK-2001, STK-2002'),
    (d2, d2, 'aa', 'Manheim, PA', 'AA-002', 'completed',
     NOW() - interval '1 hour', NOW() - interval '1 hour', NOW() - interval '10 minutes',
     '[MOCK] AA group 2 - finished', aa_group_2, 'STK-2001, STK-2002');

  -- ═══════════════════════════════════════════════════════════════════════════
  -- AA GROUP 3: 2 drivers, both pending (scheduled for tomorrow)
  -- ═══════════════════════════════════════════════════════════════════════════
  INSERT INTO trips (driver_id, designated_driver_id, trip_type, city, crm_id, status,
    scheduled_pickup, notes, group_id, stock_numbers)
  VALUES
    (d1, d1, 'aa', 'Manheim, PA', 'AA-003', 'pending',
     NOW() + interval '1 day',
     '[MOCK] AA group 3 - tomorrow run', aa_group_3, 'STK-3001, STK-3002'),
    (d2, d2, 'aa', 'Manheim, PA', 'AA-003', 'pending',
     NOW() + interval '1 day',
     '[MOCK] AA group 3 - tomorrow run', aa_group_3, 'STK-3001, STK-3002');

  -- ═══════════════════════════════════════════════════════════════════════════
  -- COURIER: 1 completed (ready to finalize), 1 pending
  -- ═══════════════════════════════════════════════════════════════════════════
  INSERT INTO trips (driver_id, designated_driver_id, trip_type, city, crm_id, status,
    scheduled_pickup, actual_start, actual_end, notes)
  VALUES
    (d1, d1, 'courier', 'Parts Pickup - AutoZone', 'CRR-001', 'completed',
     NOW() - interval '3 hours', NOW() - interval '3 hours', NOW() - interval '2 hours',
     '[MOCK] Courier — brake pads and rotors for shop');

  INSERT INTO trips (driver_id, designated_driver_id, trip_type, city, crm_id, status,
    scheduled_pickup, notes)
  VALUES
    (d2, d2, 'courier', 'Title Office Run', 'CRR-002', 'pending',
     NOW() + interval '2 hours',
     '[MOCK] Courier — drop off title paperwork at DMV');

  -- ═══════════════════════════════════════════════════════════════════════════
  -- FLY + AIRPORT DRIVER: both completed, ready to finalize
  -- ═══════════════════════════════════════════════════════════════════════════
  fly_trip_id := gen_random_uuid();

  INSERT INTO trips (id, driver_id, designated_driver_id, trip_type, city, crm_id, status,
    scheduled_pickup, actual_start, actual_end, notes)
  VALUES
    (fly_trip_id, d1, d1, 'fly', 'Charlotte, NC', 'CP-5501', 'completed',
     NOW() - interval '6 hours', NOW() - interval '5 hours', NOW() - interval '1 hour',
     '[MOCK] Fly trip — BMW from private seller');

  INSERT INTO trips (driver_id, designated_driver_id, trip_type, city, crm_id, status,
    scheduled_pickup, actual_start, actual_end, notes, parent_trip_id)
  VALUES
    (d2, d2, 'airport', 'Charlotte, NC', 'CP-5501', 'completed',
     NOW() - interval '6 hours', NOW() - interval '6 hours', NOW() - interval '5 hours 30 minutes',
     '[MOCK] Airport driver — dropped off flyer at CLT', fly_trip_id);

  RAISE NOTICE 'Mock data inserted! % drivers used: d1=%, d2=%, d3=%',
    array_length(driver_ids, 1), d1, d2, d3;
END $$;
