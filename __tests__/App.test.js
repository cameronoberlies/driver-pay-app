import React from 'react';
import { render, waitFor, fireEvent } from '@testing-library/react-native';
import { AppState } from 'react-native';
import App from '../App';

// ─── Mocks ────────────────────────────────────────────────────────────────────
jest.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      refreshSession: jest.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: jest.fn(),
      signOut: jest.fn().mockResolvedValue({}),
    },
    from: jest.fn(),
  },
}));

// Mock all screens so tests are fast and focused on routing logic
jest.mock('../screens/LoginScreen',       () => () => { const { Text } = require('react-native'); return <Text>LoginScreen</Text>; });
jest.mock('../screens/DriverDashboard',   () => () => { const { Text } = require('react-native'); return <Text>DriverDashboard</Text>; });
jest.mock('../screens/MyTripsScreen',     () => () => { const { Text } = require('react-native'); return <Text>MyTripsScreen</Text>; });
jest.mock('../screens/AdminOverview',     () => () => { const { Text } = require('react-native'); return <Text>AdminOverview</Text>; });
jest.mock('../screens/LogEntryScreen',    () => () => { const { Text } = require('react-native'); return <Text>LogEntryScreen</Text>; });
jest.mock('../screens/AllEntriesScreen',  () => () => { const { Text } = require('react-native'); return <Text>AllEntriesScreen</Text>; });
jest.mock('../screens/MileageCostsScreen',() => () => { const { Text } = require('react-native'); return <Text>MileageCostsScreen</Text>; });
jest.mock('../screens/AvailabilityScreen',() => () => { const { Text } = require('react-native'); return <Text>AvailabilityScreen</Text>; });
jest.mock('../screens/LiveDriversScreen', () => () => { const { Text } = require('react-native'); return <Text>LiveDriversScreen</Text>; });

import { supabase } from '../lib/supabase';

const DRIVER_SESSION = { user: { id: 'driver-1' } };
const ADMIN_SESSION  = { user: { id: 'admin-1'  } };

function makeProfileMock(role) {
  return {
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue({ data: { id: role === 'admin' ? 'admin-1' : 'driver-1', role, name: 'Test User' } }),
      }),
    }),
  };
}

function setupNoSession() {
  supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
  supabase.auth.onAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: jest.fn() } },
  });
}

function setupSession(session, role) {
  supabase.auth.getSession.mockResolvedValue({ data: { session } });
  supabase.auth.onAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: jest.fn() } },
  });
  supabase.from.mockReturnValue(makeProfileMock(role));
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
});

afterEach(() => {
  AppState.addEventListener.mockRestore();
});

// ─── Loading state ────────────────────────────────────────────────────────────
describe('App — loading state', () => {
  it('shows a loading spinner while auth state is being determined', () => {
    supabase.auth.getSession.mockReturnValue(new Promise(() => {})); // never resolves
    supabase.auth.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: jest.fn() } },
    });
    const { UNSAFE_getByType } = render(<App />);
    const { ActivityIndicator } = require('react-native');
    expect(UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
  });
});

// ─── Unauthenticated ─────────────────────────────────────────────────────────
describe('App — unauthenticated', () => {
  it('renders LoginScreen when there is no session', async () => {
    setupNoSession();
    const { findByText } = render(<App />);
    expect(await findByText('LoginScreen')).toBeTruthy();
  });
});

// ─── Driver routing ───────────────────────────────────────────────────────────
describe('App — driver routing', () => {
  it('renders DriverDashboard as the default driver tab', async () => {
    setupSession(DRIVER_SESSION, 'driver');
    const { findByText } = render(<App />);
    expect(await findByText('DriverDashboard')).toBeTruthy();
  });

  it('shows DASHBOARD and TRIPS tabs in the bottom tab bar', async () => {
    setupSession(DRIVER_SESSION, 'driver');
    const { findByText } = render(<App />);
    await findByText('DriverDashboard');
    expect(await findByText('DASHBOARD')).toBeTruthy();
    expect(await findByText('TRIPS')).toBeTruthy();
  });

  it('switches to MyTripsScreen when the TRIPS tab is pressed', async () => {
    setupSession(DRIVER_SESSION, 'driver');
    const { findByText, getByText } = render(<App />);
    await findByText('TRIPS');
    fireEvent.press(getByText('TRIPS'));
    expect(await findByText('MyTripsScreen')).toBeTruthy();
  });

  it('switches back to DriverDashboard when DASHBOARD tab is pressed', async () => {
    setupSession(DRIVER_SESSION, 'driver');
    const { findByText, getByText } = render(<App />);
    await findByText('TRIPS');
    fireEvent.press(getByText('TRIPS'));
    await findByText('MyTripsScreen');
    fireEvent.press(getByText('DASHBOARD'));
    expect(await findByText('DriverDashboard')).toBeTruthy();
  });

  it('does not render admin navigation for a driver', async () => {
    setupSession(DRIVER_SESSION, 'driver');
    const { findByText, queryByText } = render(<App />);
    await findByText('DriverDashboard');
    expect(queryByText('OVERVIEW')).toBeNull();
    expect(queryByText('MENU')).toBeNull();
  });
});

// ─── Admin routing ────────────────────────────────────────────────────────────
describe('App — admin routing', () => {
  it('renders AdminOverview as the default admin screen', async () => {
    setupSession(ADMIN_SESSION, 'admin');
    const { findByText } = render(<App />);
    expect(await findByText('AdminOverview')).toBeTruthy();
  });

  it('shows the admin header bar with the current screen title', async () => {
    setupSession(ADMIN_SESSION, 'admin');
    const { findByText } = render(<App />);
    expect(await findByText('OVERVIEW')).toBeTruthy();
  });

  it('does not render the driver bottom tab bar for an admin', async () => {
    setupSession(ADMIN_SESSION, 'admin');
    const { findByText, queryByText } = render(<App />);
    await findByText('AdminOverview');
    expect(queryByText('DASHBOARD')).toBeNull();
    expect(queryByText('TRIPS')).toBeNull();
  });
});

// ─── Sign out ─────────────────────────────────────────────────────────────────
describe('App — sign out', () => {
  it('returns to LoginScreen after signing out (driver)', async () => {
    setupSession(DRIVER_SESSION, 'driver');

    // Simulate onAuthStateChange firing a SIGNED_OUT event
    let authChangeCallback;
    supabase.auth.onAuthStateChange.mockImplementation((cb) => {
      authChangeCallback = cb;
      return { data: { subscription: { unsubscribe: jest.fn() } } };
    });
    supabase.from.mockReturnValue(makeProfileMock('driver'));

    const { findByText } = render(<App />);
    await findByText('DriverDashboard');

    // Simulate Supabase auth state change to signed out
    await waitFor(() => authChangeCallback('SIGNED_OUT', null));

    expect(await findByText('LoginScreen')).toBeTruthy();
  });
});
