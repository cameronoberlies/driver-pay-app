import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { Alert } from 'react-native';
import * as Location from 'expo-location';
import MyTripsScreen from '../../screens/MyTripsScreen';

// ─── Mocks ────────────────────────────────────────────────────────────────────
jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

import { supabase } from '../../lib/supabase';

const SESSION = { user: { id: 'driver-abc' } };

/** Build the Supabase fluent chain for the trips query */
function mockTripsQuery(resolvedValue) {
  const terminal = jest.fn().mockResolvedValue(resolvedValue);
  const chain = {
    select: jest.fn().mockReturnThis(),
    or:     jest.fn().mockReturnThis(),
    in:     jest.fn().mockReturnThis(),
    order:  terminal,
    update: jest.fn().mockReturnThis(),
    eq:     jest.fn().mockResolvedValue({ error: null }),
    upsert: jest.fn().mockResolvedValue({ error: null }),
    delete: jest.fn().mockReturnThis(),
  };
  return chain;
}

function setupTripsMock(trips = [], error = null) {
  const chain = mockTripsQuery({ data: trips, error });
  supabase.from.mockImplementation((table) => {
    if (table === 'trips') return chain;
    // driver_locations
    return {
      upsert: jest.fn().mockResolvedValue({ error: null }),
      delete: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: null }),
      }),
    };
  });
  return chain;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  Location.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
  Location.requestBackgroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
  Location.watchPositionAsync.mockResolvedValue({ remove: jest.fn() });
});

afterEach(() => {
  Alert.alert.mockRestore();
});

// ─── Loading & error states ───────────────────────────────────────────────────
describe('MyTripsScreen — loading and error states', () => {
  it('shows a loading spinner while trips are fetching', () => {
    supabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        or: jest.fn().mockReturnValue({
          in: jest.fn().mockReturnValue({
            order: jest.fn().mockReturnValue(new Promise(() => {})),
          }),
        }),
      }),
    });
    const { UNSAFE_getByType } = render(<MyTripsScreen session={SESSION} />);
    const { ActivityIndicator } = require('react-native');
    expect(UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
  });

  it('shows error message and RETRY button when fetch fails', async () => {
    supabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        or: jest.fn().mockReturnValue({
          in: jest.fn().mockReturnValue({
            order: jest.fn().mockRejectedValue(new Error('network error')),
          }),
        }),
      }),
    });
    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    expect(await findByText('Failed to load trips')).toBeTruthy();
    expect(await findByText('RETRY')).toBeTruthy();
  });

  it('re-fetches when RETRY is pressed', async () => {
    // First call fails; second succeeds
    supabase.from
      .mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          or: jest.fn().mockReturnValue({
            in: jest.fn().mockReturnValue({
              order: jest.fn().mockRejectedValue(new Error('fail')),
            }),
          }),
        }),
      })
      .mockImplementation(() => setupTripsMock([]));

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
    expect(await findByText('Your admin will assign trips here')).toBeTruthy();
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
  const pendingDriveTrip = {
    id: 'trip-1',
    carpage_id: 'CAR-001',
    city: 'Charlotte',
    status: 'pending',
    trip_type: 'drive',
    designated_driver_id: 'driver-abc',
    scheduled_pickup: '2026-03-15T10:00:00.000Z',
    notes: null,
  };

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

  it('renders city and CRM ID on each trip card', async () => {
    setupTripsMock([pendingDriveTrip]);
    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    expect(await findByText('Charlotte')).toBeTruthy();
    expect(await findByText('CAR-001')).toBeTruthy();
  });

  it('shows PENDING status badge for a pending trip', async () => {
    setupTripsMock([pendingDriveTrip]);
    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    expect(await findByText('PENDING')).toBeTruthy();
  });

  it('shows AWAITING FINALIZATION for a completed trip', async () => {
    setupTripsMock([completedFlyTrip]);
    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    expect(await findByText('AWAITING FINALIZATION')).toBeTruthy();
  });

  it('shows 🚗 DRIVE label for drive-type trips', async () => {
    setupTripsMock([pendingDriveTrip]);
    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    expect(await findByText('🚗 DRIVE')).toBeTruthy();
  });

  it('shows ✈ FLY label for fly-type trips', async () => {
    setupTripsMock([completedFlyTrip]);
    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    expect(await findByText('✈ FLY')).toBeTruthy();
  });

  it('renders trip notes when present', async () => {
    const tripWithNotes = { ...pendingDriveTrip, notes: 'Bring extra keys' };
    setupTripsMock([tripWithNotes]);
    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    expect(await findByText('Bring extra keys')).toBeTruthy();
  });

  it('groups pending and in_progress trips under YOUR TRIPS', async () => {
    const inProgressTrip = { ...pendingDriveTrip, id: 'trip-3', status: 'in_progress' };
    setupTripsMock([pendingDriveTrip, inProgressTrip]);
    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    expect(await findByText('YOUR TRIPS')).toBeTruthy();
  });

  it('groups completed trips under COMPLETED', async () => {
    setupTripsMock([completedFlyTrip]);
    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    expect(await findByText('COMPLETED')).toBeTruthy();
  });

  it('uses crm_id as fallback when carpage_id is absent', async () => {
    const tripWithCrm = { ...pendingDriveTrip, carpage_id: null, crm_id: 'CRM-042' };
    setupTripsMock([tripWithCrm]);
    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    expect(await findByText('CRM-042')).toBeTruthy();
  });

  it('shows — when neither carpage_id nor crm_id is present', async () => {
    const tripNoId = { ...pendingDriveTrip, carpage_id: null, crm_id: null };
    setupTripsMock([tripNoId]);
    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    expect(await findByText('—')).toBeTruthy();
  });
});

// ─── TripCard action buttons ──────────────────────────────────────────────────
describe('MyTripsScreen — TripCard action buttons', () => {
  const pendingAsDesignated = {
    id: 'trip-1',
    carpage_id: 'CAR-001',
    city: 'Charlotte',
    status: 'pending',
    trip_type: 'drive',
    designated_driver_id: 'driver-abc', // matches SESSION.user.id
    scheduled_pickup: null,
    notes: null,
  };

  const pendingAsNonDesignated = {
    ...pendingAsDesignated,
    id: 'trip-2',
    designated_driver_id: 'someone-else',
  };

  it('shows START TRIP button when current user is the designated driver and trip is pending', async () => {
    setupTripsMock([pendingAsDesignated]);
    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    expect(await findByText('▶ START TRIP')).toBeTruthy();
  });

  it('does not show START TRIP for a non-designated driver', async () => {
    setupTripsMock([pendingAsNonDesignated]);
    const { findByText, queryByText } = render(<MyTripsScreen session={SESSION} />);
    await findByText('Charlotte');
    expect(queryByText('▶ START TRIP')).toBeNull();
  });

  it('shows "Waiting for designated driver" for non-designated drive trips', async () => {
    setupTripsMock([pendingAsNonDesignated]);
    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    expect(await findByText('Waiting for designated driver to start')).toBeTruthy();
  });

  it('does not show START TRIP for a completed trip', async () => {
    const completedTrip = { ...pendingAsDesignated, status: 'completed' };
    setupTripsMock([completedTrip]);
    const { findByText, queryByText } = render(<MyTripsScreen session={SESSION} />);
    await findByText('Charlotte');
    expect(queryByText('▶ START TRIP')).toBeNull();
  });
});

// ─── Start trip flow ──────────────────────────────────────────────────────────
describe('MyTripsScreen — start trip flow', () => {
  const pendingTrip = {
    id: 'trip-1',
    carpage_id: 'CAR-001',
    city: 'Charlotte',
    status: 'pending',
    trip_type: 'drive',
    designated_driver_id: 'driver-abc',
    scheduled_pickup: null,
    notes: null,
  };

  function setupStartMock(trips, updateError = null) {
    supabase.from.mockImplementation((table) => {
      if (table === 'trips') {
        return {
          select: jest.fn().mockReturnThis(),
          or:     jest.fn().mockReturnThis(),
          in:     jest.fn().mockReturnThis(),
          order:  jest.fn().mockResolvedValue({ data: trips, error: null }),
          update: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({ error: updateError }),
          }),
        };
      }
      return {
        upsert: jest.fn().mockResolvedValue({ error: null }),
        delete: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ error: null }),
        }),
      };
    });
  }

  it('shows a permission alert and does not start when foreground location is denied', async () => {
    setupStartMock([pendingTrip]);
    Location.requestForegroundPermissionsAsync.mockResolvedValueOnce({ status: 'denied' });
    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    fireEvent.press(await findByText('▶ START TRIP'));
    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Permission Required', expect.any(String));
    });
    expect(Location.watchPositionAsync).not.toHaveBeenCalled();
  });

  it('shows a background location alert when background permission is denied', async () => {
    setupStartMock([pendingTrip]);
    Location.requestForegroundPermissionsAsync.mockResolvedValueOnce({ status: 'granted' });
    Location.requestBackgroundPermissionsAsync.mockResolvedValueOnce({ status: 'denied' });
    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    fireEvent.press(await findByText('▶ START TRIP'));
    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Background Location Required', expect.any(String), expect.any(Array));
    });
    expect(Location.watchPositionAsync).not.toHaveBeenCalled();
  });

  it('shows an alert and does not start GPS when Supabase update fails', async () => {
    setupStartMock([pendingTrip], { message: 'DB error' });
    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    fireEvent.press(await findByText('▶ START TRIP'));
    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Failed to start trip', 'DB error');
    });
    expect(Location.watchPositionAsync).not.toHaveBeenCalled();
  });

  it('starts GPS tracking and shows TRACKING indicator on success', async () => {
    setupStartMock([pendingTrip]);
    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    fireEvent.press(await findByText('▶ START TRIP'));
    await waitFor(() => {
      expect(Location.watchPositionAsync).toHaveBeenCalled();
    });
    expect(await findByText('TRACKING')).toBeTruthy();
  });

  it('shows END TRIP button after a trip has been started', async () => {
    setupStartMock([pendingTrip]);
    const { findByText } = render(<MyTripsScreen session={SESSION} />);
    fireEvent.press(await findByText('▶ START TRIP'));
    expect(await findByText('⏹ END TRIP')).toBeTruthy();
  });

  it('shows "Another trip is currently active" on a second pending trip', async () => {
    const secondPendingTrip = {
      id: 'trip-2',
      carpage_id: 'CAR-002',
      city: 'Gastonia',
      status: 'pending',
      trip_type: 'drive',
      designated_driver_id: 'driver-abc',
      scheduled_pickup: null,
      notes: null,
    };
    setupStartMock([pendingTrip, secondPendingTrip]);
    const { findAllByText, findByText } = render(<MyTripsScreen session={SESSION} />);
    const startBtns = await findAllByText('▶ START TRIP');
    fireEvent.press(startBtns[0]);
    await waitFor(() => expect(Location.watchPositionAsync).toHaveBeenCalled());
    expect(await findByText('Another trip is currently active')).toBeTruthy();
  });
});

// ─── End trip flow ────────────────────────────────────────────────────────────
describe('MyTripsScreen — end trip flow', () => {
  const pendingTrip = {
    id: 'trip-1',
    carpage_id: 'CAR-001',
    city: 'Charlotte',
    status: 'pending',
    trip_type: 'drive',
    designated_driver_id: 'driver-abc',
    scheduled_pickup: null,
    notes: null,
  };

  function setupEndMock(endUpdateError = null) {
    // start-trip update must always succeed; only the end-trip update uses endUpdateError
    const mockEq = jest.fn()
      .mockResolvedValueOnce({ error: null })       // first call: start trip update → success
      .mockResolvedValue({ error: endUpdateError }); // subsequent calls: end trip update

    supabase.from.mockImplementation((table) => {
      if (table === 'trips') {
        return {
          select: jest.fn().mockReturnThis(),
          or:     jest.fn().mockReturnThis(),
          in:     jest.fn().mockReturnThis(),
          order:  jest.fn().mockResolvedValue({ data: [pendingTrip], error: null }),
          update: jest.fn().mockReturnValue({ eq: mockEq }),
        };
      }
      return {
        upsert: jest.fn().mockResolvedValue({ error: null }),
        delete: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ error: null }),
        }),
      };
    });
  }

  async function startTrip(utils) {
    fireEvent.press(await utils.findByText('▶ START TRIP'));
    await waitFor(() => expect(Location.watchPositionAsync).toHaveBeenCalled());
    await utils.findByText('⏹ END TRIP');
  }

  it('shows a confirmation alert when END TRIP is pressed', async () => {
    setupEndMock();
    const utils = render(<MyTripsScreen session={SESSION} />);
    await startTrip(utils);
    fireEvent.press(utils.getByText('⏹ END TRIP'));
    expect(Alert.alert).toHaveBeenCalledWith('End Trip?', expect.any(String), expect.any(Array));
  });

  it('confirms the alert has Cancel and End Trip buttons', async () => {
    setupEndMock();
    const utils = render(<MyTripsScreen session={SESSION} />);
    await startTrip(utils);
    fireEvent.press(utils.getByText('⏹ END TRIP'));
    const alertArgs = Alert.alert.mock.calls.find(c => c[0] === 'End Trip?');
    const buttons = alertArgs[2];
    expect(buttons.find(b => b.text === 'Cancel')).toBeTruthy();
    expect(buttons.find(b => b.text === 'End Trip')).toBeTruthy();
  });

  it('stops GPS and clears the active trip after confirming End Trip', async () => {
    setupEndMock();
    const locationSub = { remove: jest.fn() };
    Location.watchPositionAsync.mockResolvedValueOnce(locationSub);

    const utils = render(<MyTripsScreen session={SESSION} />);
    await startTrip(utils);
    fireEvent.press(utils.getByText('⏹ END TRIP'));

    // Invoke the "End Trip" button's onPress from the Alert
    const alertArgs = Alert.alert.mock.calls.find(c => c[0] === 'End Trip?');
    const endButton = alertArgs[2].find(b => b.text === 'End Trip');
    await act(async () => { await endButton.onPress(); });

    expect(locationSub.remove).toHaveBeenCalled();
    expect(utils.queryByText('⏹ END TRIP')).toBeNull();
    expect(utils.queryByText('TRACKING')).toBeNull();
  });

  it('shows a Failed to end trip alert when Supabase update fails on end', async () => {
    setupEndMock({ message: 'update failed' });
    const utils = render(<MyTripsScreen session={SESSION} />);
    await startTrip(utils);
    fireEvent.press(utils.getByText('⏹ END TRIP'));

    const alertArgs = Alert.alert.mock.calls.find(c => c[0] === 'End Trip?');
    const endButton = alertArgs[2].find(b => b.text === 'End Trip');
    await act(async () => { await endButton.onPress(); });

    expect(Alert.alert).toHaveBeenCalledWith('Failed to end trip', 'update failed');
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

    const fromCallsAfter = supabase.from.mock.calls.filter(c => c[0] === 'trips').length;
    expect(fromCallsAfter).toBeGreaterThan(fromCallsBefore);
  });
});
