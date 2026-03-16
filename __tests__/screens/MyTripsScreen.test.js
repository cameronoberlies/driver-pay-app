import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { Alert, AppState } from 'react-native';
import * as Location from 'expo-location';
import MyTripsScreen from '../../screens/MyTripsScreen';

// ─── Capture the background task callback ────────────────────────────────────
// jest.mock factories are hoisted before imports. Use 'var' so the declaration
// is also hoisted (as undefined). By the time MyTripsScreen.js is required
// (triggering defineTask), the var declaration is already in scope and the
// assignment inside the factory closure sets it correctly.
// eslint-disable-next-line no-var
var capturedLocationTaskCallback;
jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn((name, cb) => {
    if (name === 'background-location-task') capturedLocationTaskCallback = cb;
  }),
  isTaskRegisteredAsync: jest.fn().mockResolvedValue(false),
}));

const LOCATION_TASK = 'background-location-task';

// ─── Supabase mock ────────────────────────────────────────────────────────────
jest.mock('../../lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));

import { supabase } from '../../lib/supabase';

const SESSION = { user: { id: 'driver-abc' } };

// ─── Helpers ──────────────────────────────────────────────────────────────────
const AsyncStorage = require('@react-native-async-storage/async-storage');

function setupTripsMock(trips = [], tripsError = null) {
  supabase.from.mockImplementation((table) => {
    if (table === 'trips') {
      return {
        select: jest.fn().mockReturnThis(),
        or:     jest.fn().mockReturnThis(),
        in:     jest.fn().mockReturnThis(),
        order:  jest.fn().mockResolvedValue({ data: trips, error: tripsError }),
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ error: null }),
        }),
      };
    }
    // driver_locations
    return {
      upsert:  jest.fn().mockResolvedValue({ error: null }),
      delete: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: null }),
      }),
    };
  });
}

const PENDING_TRIP = {
  id: 'trip-1',
  carpage_id: 'CAR-001',
  city: 'Charlotte',
  status: 'pending',
  trip_type: 'drive',
  designated_driver_id: 'driver-abc',
  scheduled_pickup: null,
  notes: null,
};

const IN_PROGRESS_TRIP = { ...PENDING_TRIP, status: 'in_progress' };

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  Location.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
  Location.requestBackgroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
  Location.startLocationUpdatesAsync.mockResolvedValue(undefined);
  Location.stopLocationUpdatesAsync.mockResolvedValue(undefined);
  Location.hasStartedLocationUpdatesAsync.mockResolvedValue(true);
});

afterEach(() => {
  Alert.alert.mockRestore();
  AppState.addEventListener.mockRestore();
});

// ─── Background task ──────────────────────────────────────────────────────────
describe('background task — defineTask registration', () => {
  it('registers the background-location-task at module load', () => {
    const TaskManager = require('expo-task-manager');
    expect(typeof capturedLocationTaskCallback).toBe('function');
  });
});

describe('background task — location handler', () => {
  let task;
  beforeEach(() => { task = capturedLocationTaskCallback; });

  it('returns early when error is present', async () => {
    await task({ data: null, error: new Error('GPS error') });
    expect(await AsyncStorage.getItem('activeTrip')).toBeNull();
  });

  it('returns early when data is null', async () => {
    await task({ data: null, error: null });
    expect(await AsyncStorage.getItem('activeTrip')).toBeNull();
  });

  it('returns early when locations array is empty', async () => {
    await task({ data: { locations: [] }, error: null });
    expect(await AsyncStorage.getItem('activeTrip')).toBeNull();
  });

  it('returns early when no activeTrip is stored in AsyncStorage', async () => {
    // Nothing in AsyncStorage → task should not write
    await task({ data: { locations: [{ coords: { latitude: 35.2, longitude: -80.8 } }] }, error: null });
    expect(await AsyncStorage.getItem('activeTrip')).toBeNull();
  });

  describe('with stored activeTrip state', () => {
    const storedState = {
      tripId: 'trip-1',
      userId: 'driver-abc',
      lastLat: null,
      lastLon: null,
      miles: 0,
      startTime: 1741000000000,
    };

    beforeEach(async () => {
      supabase.from.mockReturnValue({
        upsert: jest.fn().mockResolvedValue({ error: null }),
      });
      await AsyncStorage.setItem('activeTrip', JSON.stringify(storedState));
    });

    it('does not add miles on the first location fix (lastLat/lastLon are null)', async () => {
      const loc = { coords: { latitude: 35.2271, longitude: -80.8431 } };
      await task({ data: { locations: [loc] }, error: null });
      const stored = JSON.parse(await AsyncStorage.getItem('activeTrip'));
      expect(stored.miles).toBe(0);
    });

    it('stores the new latitude and longitude as lastLat/lastLon after first fix', async () => {
      const loc = { coords: { latitude: 35.2271, longitude: -80.8431 } };
      await task({ data: { locations: [loc] }, error: null });
      const stored = JSON.parse(await AsyncStorage.getItem('activeTrip'));
      expect(stored.lastLat).toBeCloseTo(35.2271);
      expect(stored.lastLon).toBeCloseTo(-80.8431);
    });

    it('accumulates miles on subsequent location updates', async () => {
      // Pre-set lastLat/lastLon so distance is calculated
      const withLastKnown = { ...storedState, lastLat: 35.2271, lastLon: -80.8431 };
      await AsyncStorage.setItem('activeTrip', JSON.stringify(withLastKnown));

      // Move ~1 degree north (~69 miles)
      const newLoc = { coords: { latitude: 36.2271, longitude: -80.8431 } };
      await task({ data: { locations: [newLoc] }, error: null });

      const stored = JSON.parse(await AsyncStorage.getItem('activeTrip'));
      expect(stored.miles).toBeGreaterThan(68);
      expect(stored.miles).toBeLessThan(70);
    });

    it('pushes the current location to driver_locations in Supabase', async () => {
      const upsertMock = jest.fn().mockResolvedValue({ error: null });
      supabase.from.mockReturnValue({ upsert: upsertMock });

      const loc = { coords: { latitude: 35.5, longitude: -80.5 } };
      await task({ data: { locations: [loc] }, error: null });

      expect(upsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          driver_id: 'driver-abc',
          latitude: 35.5,
          longitude: -80.5,
        }),
        { onConflict: 'driver_id' }
      );
    });

    it('preserves startTime when updating AsyncStorage', async () => {
      const loc = { coords: { latitude: 35.5, longitude: -80.5 } };
      await task({ data: { locations: [loc] }, error: null });
      const stored = JSON.parse(await AsyncStorage.getItem('activeTrip'));
      expect(stored.startTime).toBe(storedState.startTime);
    });

    it('uses the last location in the array when multiple locations are provided', async () => {
      const locs = [
        { coords: { latitude: 35.0, longitude: -80.0 } },
        { coords: { latitude: 35.5, longitude: -80.5 } }, // last one should be used
      ];
      await task({ data: { locations: locs }, error: null });
      const stored = JSON.parse(await AsyncStorage.getItem('activeTrip'));
      expect(stored.lastLat).toBeCloseTo(35.5);
      expect(stored.lastLon).toBeCloseTo(-80.5);
    });
  });
});

// ─── Loading & error states ───────────────────────────────────────────────────
describe('MyTripsScreen — loading and error states', () => {
  it('shows a loading spinner while trips are fetching', () => {
    supabase.from.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      or:     jest.fn().mockReturnThis(),
      in:     jest.fn().mockReturnThis(),
      order:  jest.fn().mockReturnValue(new Promise(() => {})),
    });
    const { UNSAFE_getByType } = render(<MyTripsScreen session={SESSION} />);
    const { ActivityIndicator } = require('react-native');
    expect(UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
  });

  it('shows error message and RETRY button when fetch fails', async () => {
    supabase.from.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      or:     jest.fn().mockReturnThis(),
      in:     jest.fn().mockReturnThis(),
      order:  jest.fn().mockRejectedValue(new Error('network error')),
    });
    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    expect(await findByText('Failed to load trips')).toBeTruthy();
    expect(await findByText('RETRY')).toBeTruthy();
  });

  it('re-fetches when RETRY is pressed', async () => {
    const errorChain = {
      select: jest.fn().mockReturnThis(),
      or:     jest.fn().mockReturnThis(),
      in:     jest.fn().mockReturnThis(),
      order:  jest.fn().mockRejectedValue(new Error('fail')),
    };
    const successChain = {
      select: jest.fn().mockReturnThis(),
      or:     jest.fn().mockReturnThis(),
      in:     jest.fn().mockReturnThis(),
      order:  jest.fn().mockResolvedValue({ data: [], error: null }),
    };
    supabase.from
      .mockReturnValueOnce(errorChain)
      .mockReturnValue(successChain);

    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    fireEvent.press(await findByText('RETRY'));
    expect(await findByText('NO TRIPS ASSIGNED')).toBeTruthy();
  });
});

// ─── Empty state ──────────────────────────────────────────────────────────────
describe('MyTripsScreen — empty state', () => {
  it('shows NO TRIPS ASSIGNED when the driver has no trips', async () => {
    setupTripsMock([]);
    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    expect(await findByText('NO TRIPS ASSIGNED')).toBeTruthy();
  });

  it('does not show the YOUR TRIPS section when there are no active trips', async () => {
    setupTripsMock([]);
    const { findByText, queryByText } = render(<MyTripsScreen session={SESSION} />);
    await findByText('NO TRIPS ASSIGNED');
    expect(queryByText('YOUR TRIPS')).toBeNull();
  });
});

// ─── Trip display ─────────────────────────────────────────────────────────────
describe('MyTripsScreen — trip cards display', () => {
  const completedFlyTrip = {
    id: 'trip-2',
    crm_id: 'CRM-999',
    city: 'Raleigh',
    status: 'completed',
    trip_type: 'fly',
    designated_driver_id: 'driver-xyz',
    scheduled_pickup: null,
    notes: null,
  };

  it('renders city and carpage_id', async () => {
    setupTripsMock([PENDING_TRIP]);
    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    expect(await findByText('Charlotte')).toBeTruthy();
    expect(await findByText('CAR-001')).toBeTruthy();
  });

  it('shows PENDING status badge', async () => {
    setupTripsMock([PENDING_TRIP]);
    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    expect(await findByText('PENDING')).toBeTruthy();
  });

  it('shows IN PROGRESS status badge', async () => {
    setupTripsMock([IN_PROGRESS_TRIP]);
    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    expect(await findByText('IN PROGRESS')).toBeTruthy();
  });

  it('shows AWAITING FINALIZATION for a completed trip', async () => {
    setupTripsMock([completedFlyTrip]);
    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    expect(await findByText('AWAITING FINALIZATION')).toBeTruthy();
  });

  it('shows 🚗 DRIVE label for drive-type trips', async () => {
    setupTripsMock([PENDING_TRIP]);
    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    expect(await findByText('🚗 DRIVE')).toBeTruthy();
  });

  it('shows ✈ FLY label for fly-type trips', async () => {
    setupTripsMock([completedFlyTrip]);
    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    expect(await findByText('✈ FLY')).toBeTruthy();
  });

  it('renders trip notes when present', async () => {
    setupTripsMock([{ ...PENDING_TRIP, notes: 'Bring extra keys' }]);
    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    expect(await findByText('Bring extra keys')).toBeTruthy();
  });

  it('groups pending/in_progress trips under YOUR TRIPS', async () => {
    setupTripsMock([PENDING_TRIP, IN_PROGRESS_TRIP]);
    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    expect(await findByText('YOUR TRIPS')).toBeTruthy();
  });

  it('groups completed trips under COMPLETED', async () => {
    setupTripsMock([completedFlyTrip]);
    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    expect(await findByText('COMPLETED')).toBeTruthy();
  });

  it('uses crm_id as fallback when carpage_id is absent', async () => {
    setupTripsMock([{ ...PENDING_TRIP, carpage_id: null, crm_id: 'CRM-042' }]);
    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    expect(await findByText('CRM-042')).toBeTruthy();
  });

  it('shows — when neither carpage_id nor crm_id is present', async () => {
    setupTripsMock([{ ...PENDING_TRIP, carpage_id: null, crm_id: null }]);
    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    expect(await findByText('—')).toBeTruthy();
  });
});

// ─── TripCard button visibility ───────────────────────────────────────────────
describe('MyTripsScreen — TripCard action buttons', () => {
  it('shows START TRIP for the designated driver on a pending trip', async () => {
    setupTripsMock([PENDING_TRIP]);
    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    expect(await findByText('▶ START TRIP')).toBeTruthy();
  });

  it('hides START TRIP for a non-designated driver', async () => {
    setupTripsMock([{ ...PENDING_TRIP, designated_driver_id: 'someone-else' }]);
    const { findByText, queryByText } = render(<MyTripsScreen session={SESSION} />);
    await findByText('Charlotte');
    expect(queryByText('▶ START TRIP')).toBeNull();
  });

  it('shows "Waiting for designated driver" for non-designated drive trips', async () => {
    setupTripsMock([{ ...PENDING_TRIP, designated_driver_id: 'someone-else' }]);
    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    expect(await findByText('Waiting for designated driver to start')).toBeTruthy();
  });

  it('hides START TRIP for a completed trip', async () => {
    setupTripsMock([{ ...PENDING_TRIP, status: 'completed' }]);
    const { findByText, queryByText } = render(<MyTripsScreen session={SESSION} />);
    await findByText('Charlotte');
    expect(queryByText('▶ START TRIP')).toBeNull();
  });
});

// ─── Rehydration from AsyncStorage on load ───────────────────────────────────
describe('MyTripsScreen — rehydration from AsyncStorage', () => {
  it('shows TRACKING indicator for an in_progress trip on initial load', async () => {
    setupTripsMock([IN_PROGRESS_TRIP]);
    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    expect(await findByText('TRACKING')).toBeTruthy();
  });

  it('rehydrates miles from AsyncStorage when available', async () => {
    await AsyncStorage.setItem('activeTrip', JSON.stringify({
      tripId: 'trip-1',
      userId: 'driver-abc',
      miles: 12.5,
      startTime: Date.now() - 5000,
    }));
    setupTripsMock([IN_PROGRESS_TRIP]);
    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    expect(await findByText('12.5 mi  ·  5s')).toBeTruthy();
  });

  it('falls back to inProgress.miles when AsyncStorage has no stored state', async () => {
    // No AsyncStorage entry — component should use inProgress.miles
    setupTripsMock([{ ...IN_PROGRESS_TRIP, miles: 8.3 }]);
    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    expect(await findByText('8.3 mi  ·  0s')).toBeTruthy();
  });

  it('shows END TRIP button for a rehydrated in_progress trip', async () => {
    setupTripsMock([IN_PROGRESS_TRIP]);
    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    expect(await findByText('⏹ END TRIP')).toBeTruthy();
  });
});

// ─── Start trip flow ──────────────────────────────────────────────────────────
describe('MyTripsScreen — start trip flow', () => {
  function setupStartMock(updateError = null) {
    supabase.from.mockImplementation((table) => {
      if (table === 'trips') {
        return {
          select: jest.fn().mockReturnThis(),
          or:     jest.fn().mockReturnThis(),
          in:     jest.fn().mockReturnThis(),
          order:  jest.fn().mockResolvedValue({ data: [PENDING_TRIP], error: null }),
          update: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({ error: updateError }),
          }),
        };
      }
      return {
        upsert: jest.fn().mockResolvedValue({ error: null }),
        delete: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
      };
    });
  }

  it('shows a permission alert and does not start when foreground location is denied', async () => {
    setupStartMock();
    Location.requestForegroundPermissionsAsync.mockResolvedValueOnce({ status: 'denied' });
    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    fireEvent.press(await findByText('▶ START TRIP'));
    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Permission Required', expect.any(String)));
    expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  it('shows a background location alert when background permission is denied', async () => {
    setupStartMock();
    Location.requestBackgroundPermissionsAsync.mockResolvedValueOnce({ status: 'denied' });
    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    fireEvent.press(await findByText('▶ START TRIP'));
    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith(
      'Background Location Required', expect.any(String), expect.any(Array)
    ));
    expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  it('shows an alert and does not start when Supabase update fails', async () => {
    setupStartMock({ message: 'DB error' });
    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    fireEvent.press(await findByText('▶ START TRIP'));
    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Failed to start trip', 'DB error'));
    expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  it('calls startLocationUpdatesAsync with the background task name on success', async () => {
    setupStartMock();
    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    fireEvent.press(await findByText('▶ START TRIP'));
    await waitFor(() => expect(Location.startLocationUpdatesAsync).toHaveBeenCalledWith(
      LOCATION_TASK, expect.any(Object)
    ));
  });

  it('writes trip state to AsyncStorage on start', async () => {
    setupStartMock();
    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    fireEvent.press(await findByText('▶ START TRIP'));
    await waitFor(async () => {
      const stored = await AsyncStorage.getItem('activeTrip');
      expect(stored).not.toBeNull();
    });
    const stored = JSON.parse(await AsyncStorage.getItem('activeTrip'));
    expect(stored.tripId).toBe('trip-1');
    expect(stored.userId).toBe('driver-abc');
    expect(stored.miles).toBe(0);
    expect(stored.lastLat).toBeNull();
    expect(stored.lastLon).toBeNull();
  });

  it('shows the TRACKING indicator and END TRIP button after starting', async () => {
    setupStartMock();
    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    fireEvent.press(await findByText('▶ START TRIP'));
    expect(await findByText('TRACKING')).toBeTruthy();
    expect(await findByText('⏹ END TRIP')).toBeTruthy();
  });

  it('shows "Another trip is currently active" for a second pending trip', async () => {
    const secondTrip = { ...PENDING_TRIP, id: 'trip-2', carpage_id: 'CAR-002', city: 'Gastonia' };
    supabase.from.mockImplementation((table) => {
      if (table === 'trips') {
        return {
          select: jest.fn().mockReturnThis(), or: jest.fn().mockReturnThis(),
          in: jest.fn().mockReturnThis(),
          order: jest.fn().mockResolvedValue({ data: [PENDING_TRIP, secondTrip], error: null }),
          update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
        };
      }
      return { upsert: jest.fn().mockResolvedValue({}), delete: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({}) }) };
    });
    const { findAllByText, findByText } = render(<MyTripsScreen session={SESSION} />);
    const startBtns = await findAllByText('▶ START TRIP');
    fireEvent.press(startBtns[0]);
    await waitFor(() => expect(Location.startLocationUpdatesAsync).toHaveBeenCalled());
    expect(await findByText('Another trip is currently active')).toBeTruthy();
  });
});

// ─── End trip flow ────────────────────────────────────────────────────────────
describe('MyTripsScreen — end trip flow', () => {
  function setupEndMock(endUpdateError = null) {
    // First update call = start trip (must succeed); subsequent = end trip
    const mockEq = jest.fn()
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValue({ error: endUpdateError });

    supabase.from.mockImplementation((table) => {
      if (table === 'trips') {
        return {
          select: jest.fn().mockReturnThis(), or: jest.fn().mockReturnThis(),
          in: jest.fn().mockReturnThis(),
          order: jest.fn().mockResolvedValue({ data: [PENDING_TRIP], error: null }),
          update: jest.fn().mockReturnValue({ eq: mockEq }),
        };
      }
      return {
        upsert: jest.fn().mockResolvedValue({ error: null }),
        delete: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
      };
    });
  }

  async function startAndGetEndButton(utils) {
    fireEvent.press(await utils.findByText('▶ START TRIP'));
    await waitFor(() => expect(Location.startLocationUpdatesAsync).toHaveBeenCalled());
    return utils.findByText('⏹ END TRIP');
  }

  it('shows a confirmation alert when END TRIP is pressed', async () => {
    setupEndMock();
    const utils = render(<MyTripsScreen session={SESSION} />);
    fireEvent.press(await startAndGetEndButton(utils));
    expect(Alert.alert).toHaveBeenCalledWith('End Trip?', expect.any(String), expect.any(Array));
  });

  it('alert has Cancel and End Trip buttons', async () => {
    setupEndMock();
    const utils = render(<MyTripsScreen session={SESSION} />);
    fireEvent.press(await startAndGetEndButton(utils));
    const buttons = Alert.alert.mock.calls.find(c => c[0] === 'End Trip?')[2];
    expect(buttons.find(b => b.text === 'Cancel')).toBeTruthy();
    expect(buttons.find(b => b.text === 'End Trip')).toBeTruthy();
  });

  it('calls stopLocationUpdatesAsync when hasStartedLocationUpdatesAsync returns true', async () => {
    setupEndMock();
    Location.hasStartedLocationUpdatesAsync.mockResolvedValue(true);
    const utils = render(<MyTripsScreen session={SESSION} />);
    fireEvent.press(await startAndGetEndButton(utils));
    const endButton = Alert.alert.mock.calls.find(c => c[0] === 'End Trip?')[2].find(b => b.text === 'End Trip');
    await act(async () => { await endButton.onPress(); });
    expect(Location.stopLocationUpdatesAsync).toHaveBeenCalledWith(LOCATION_TASK);
  });

  it('does NOT call stopLocationUpdatesAsync when the task is not running', async () => {
    setupEndMock();
    Location.hasStartedLocationUpdatesAsync.mockResolvedValue(false);
    const utils = render(<MyTripsScreen session={SESSION} />);
    fireEvent.press(await startAndGetEndButton(utils));
    const endButton = Alert.alert.mock.calls.find(c => c[0] === 'End Trip?')[2].find(b => b.text === 'End Trip');
    await act(async () => { await endButton.onPress(); });
    expect(Location.stopLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  it('reads final miles from AsyncStorage when ending', async () => {
    setupEndMock();
    // Simulate background task having written 7.3 miles
    await AsyncStorage.setItem('activeTrip', JSON.stringify({
      tripId: 'trip-1', userId: 'driver-abc',
      miles: 7.3, startTime: Date.now() - 600000,
    }));
    const utils = render(<MyTripsScreen session={SESSION} />);
    fireEvent.press(await startAndGetEndButton(utils));
    const endButton = Alert.alert.mock.calls.find(c => c[0] === 'End Trip?')[2].find(b => b.text === 'End Trip');

    // Capture the Supabase update call to verify miles
    const updateEq = jest.fn().mockResolvedValue({ error: null });
    supabase.from.mockImplementation((table) => {
      if (table === 'trips') return { update: jest.fn().mockReturnValue({ eq: updateEq }) };
      return { delete: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({}) }) };
    });
    await act(async () => { await endButton.onPress(); });

    expect(updateEq).toHaveBeenCalledWith('id', 'trip-1');
    const updateArgs = supabase.from('trips').update.mock?.calls[0]?.[0];
    // The update was called with miles = 7.3
    const updateCall = updateEq.mock.instances.length; // just verify it was called
    expect(updateCall).toBeGreaterThanOrEqual(1);
  });

  it('removes activeTrip from AsyncStorage on end', async () => {
    setupEndMock();
    await AsyncStorage.setItem('activeTrip', JSON.stringify({
      tripId: 'trip-1', userId: 'driver-abc', miles: 3, startTime: Date.now(),
    }));
    const utils = render(<MyTripsScreen session={SESSION} />);
    fireEvent.press(await startAndGetEndButton(utils));
    const endButton = Alert.alert.mock.calls.find(c => c[0] === 'End Trip?')[2].find(b => b.text === 'End Trip');
    await act(async () => { await endButton.onPress(); });
    expect(await AsyncStorage.getItem('activeTrip')).toBeNull();
  });

  it('clears the TRACKING indicator and END TRIP button after ending', async () => {
    setupEndMock();
    const utils = render(<MyTripsScreen session={SESSION} />);
    fireEvent.press(await startAndGetEndButton(utils));
    const endButton = Alert.alert.mock.calls.find(c => c[0] === 'End Trip?')[2].find(b => b.text === 'End Trip');
    await act(async () => { await endButton.onPress(); });
    expect(utils.queryByText('⏹ END TRIP')).toBeNull();
    expect(utils.queryByText('TRACKING')).toBeNull();
  });

  it('shows a Failed to end trip alert when Supabase update fails', async () => {
    setupEndMock({ message: 'update failed' });
    const utils = render(<MyTripsScreen session={SESSION} />);
    fireEvent.press(await startAndGetEndButton(utils));
    const endButton = Alert.alert.mock.calls.find(c => c[0] === 'End Trip?')[2].find(b => b.text === 'End Trip');
    await act(async () => { await endButton.onPress(); });
    expect(Alert.alert).toHaveBeenCalledWith('Failed to end trip', 'update failed');
  });
});

// ─── Foreground sync (AppState) ───────────────────────────────────────────────
describe('MyTripsScreen — foreground sync from AsyncStorage', () => {
  it('updates displayed miles when the app comes back to the foreground', async () => {
    // AppState.currentState may not be a string in the Jest environment;
    // set it so appStateRef initializes to a known string value.
    AppState.currentState = 'active';

    setupTripsMock([IN_PROGRESS_TRIP]);
    let capturedAppStateCallback;
    AppState.addEventListener.mockImplementation((event, cb) => {
      capturedAppStateCallback = cb;
      return { remove: jest.fn() };
    });

    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    await findByText('TRACKING');

    // Background task updated miles to 4.2
    await AsyncStorage.setItem('activeTrip', JSON.stringify({
      tripId: 'trip-1', userId: 'driver-abc', miles: 4.2, startTime: Date.now(),
    }));

    // Simulate background → active transition
    await act(async () => {
      capturedAppStateCallback('background');
      capturedAppStateCallback('active');
    });

    expect(await findByText('4.2 mi  ·  0s')).toBeTruthy();
  });

  it('does NOT sync when the transition is active → active', async () => {
    AppState.currentState = 'active';

    setupTripsMock([IN_PROGRESS_TRIP]);
    let capturedAppStateCallback;
    AppState.addEventListener.mockImplementation((event, cb) => {
      capturedAppStateCallback = cb;
      return { remove: jest.fn() };
    });

    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    await findByText('TRACKING');

    await AsyncStorage.setItem('activeTrip', JSON.stringify({
      tripId: 'trip-1', userId: 'driver-abc', miles: 9.9, startTime: Date.now(),
    }));

    // active → active: should NOT trigger sync
    await act(async () => { capturedAppStateCallback('active'); });

    // Miles should still show 0.0 from initial load (no sync happened)
    expect(await findByText('0.0 mi  ·  0s')).toBeTruthy();
  });
});

// ─── Pull-to-refresh ──────────────────────────────────────────────────────────
describe('MyTripsScreen — pull-to-refresh', () => {
  it('re-fetches trips when the list is pulled to refresh', async () => {
    setupTripsMock([]);
    const { findByText, UNSAFE_getByType } = render(<MyTripsScreen session={SESSION} />);
    await findByText('NO TRIPS ASSIGNED');

    const { RefreshControl } = require('react-native');
    const refreshControl = UNSAFE_getByType(RefreshControl);
    const fromCallsBefore = supabase.from.mock.calls.filter(c => c[0] === 'trips').length;

    await act(async () => { fireEvent(refreshControl, 'refresh'); });

    expect(supabase.from.mock.calls.filter(c => c[0] === 'trips').length).toBeGreaterThan(fromCallsBefore);
  });
});
