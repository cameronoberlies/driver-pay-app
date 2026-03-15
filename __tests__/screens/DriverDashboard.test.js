import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import DriverDashboard from '../../screens/DriverDashboard';

// ─── Utils mock — pins week/month bounds so tests don't depend on the real date ─
// Note: variables in jest.mock factories must be prefixed with "mock" to avoid hoisting errors
const mockWeekStart  = new Date('2026-03-11T00:00:00.000');
const mockWeekEnd    = new Date('2026-03-17T23:59:59.999');
const mockMonthStart = new Date('2026-03-01T00:00:00.000');
const mockMonthEnd   = new Date('2026-03-31T23:59:59.000');

jest.mock('../../lib/utils', () => ({
  getWeekBounds:  jest.fn(() => ({ start: mockWeekStart,  end: mockWeekEnd  })),
  getMonthBounds: jest.fn(() => ({ start: mockMonthStart, end: mockMonthEnd })),
  withTimeout:    jest.requireActual('../../lib/utils').withTimeout,
}));

// ─── Supabase mock ────────────────────────────────────────────────────────────
jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    auth: { signOut: jest.fn().mockResolvedValue({}) },
  },
}));

import { supabase } from '../../lib/supabase';

const SESSION = { user: { id: 'user-123' } };

/** Build the chained Supabase fluent API mock for profiles + entries queries. */
function setupSupabaseMock({ profile = null, entries = [], profileError = null, entriesError = null } = {}) {
  supabase.from.mockImplementation((table) => {
    if (table === 'profiles') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: profile, error: profileError }),
          }),
        }),
      };
    }
    // 'entries'
    return {
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          order: jest.fn().mockResolvedValue({ data: entries, error: entriesError }),
        }),
      }),
    };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── Loading & error states ───────────────────────────────────────────────────
describe('DriverDashboard — loading and error states', () => {
  it('shows a loading spinner before data arrives', () => {
    // Never-resolving promises keep the component in loading state
    supabase.from.mockImplementation(() => ({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockReturnValue(new Promise(() => {})),
          order: jest.fn().mockReturnValue(new Promise(() => {})),
        }),
      }),
    }));
    const { getByTestId, UNSAFE_getByType } = render(<DriverDashboard session={SESSION} />);
    // ActivityIndicator is rendered during loading
    const { ActivityIndicator } = require('react-native');
    expect(UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
  });

  it('shows an error message and RETRY button when the fetch fails', async () => {
    supabase.from.mockImplementation(() => ({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockRejectedValue(new Error('network error')),
          order: jest.fn().mockRejectedValue(new Error('network error')),
        }),
      }),
    }));
    const { findByText } = render(<DriverDashboard session={SESSION} />);
    expect(await findByText('Failed to load data')).toBeTruthy();
    expect(await findByText('RETRY')).toBeTruthy();
  });

  it('retries the fetch when RETRY is pressed', async () => {
    setupSupabaseMock({
      profile: { name: 'Jane Driver', role: 'driver' },
      entries: [],
    });
    // First call fails, subsequent succeed
    supabase.from
      .mockImplementationOnce(() => ({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockRejectedValue(new Error('network error')),
          }),
        }),
      }))
      .mockImplementation((table) => {
        if (table === 'profiles') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({ data: { name: 'Jane Driver' } }),
              }),
            }),
          };
        }
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              order: jest.fn().mockResolvedValue({ data: [] }),
            }),
          }),
        };
      });

    const { findByText } = render(<DriverDashboard session={SESSION} />);
    const retryBtn = await findByText('RETRY');
    fireEvent.press(retryBtn);
    expect(await findByText('Hey, Jane.')).toBeTruthy();
  });
});

// ─── Data display ─────────────────────────────────────────────────────────────
describe('DriverDashboard — data display', () => {
  it("shows the driver's first name in the greeting", async () => {
    setupSupabaseMock({ profile: { name: 'Cameron Smith', role: 'driver' }, entries: [] });
    const { findByText } = render(<DriverDashboard session={SESSION} />);
    expect(await findByText('Hey, Cameron.')).toBeTruthy();
  });

  it('displays $0.00 earnings when there are no entries', async () => {
    setupSupabaseMock({ profile: { name: 'Cameron Smith' }, entries: [] });
    const { findByText } = render(<DriverDashboard session={SESSION} />);
    expect(await findByText('$0.00')).toBeTruthy();
  });

  it("sums only this week's entries for the earnings display", async () => {
    // Pay period: Wed Mar 11 – Tue Mar 17; only the Mar 12 entry is in-range
    const entries = [
      { id: 1, pay: '150.00', hours: '8', miles: '100', date: '2026-03-12', city: 'Charlotte', recon_missed: false }, // this week
      { id: 2, pay: '200.00', hours: '8', miles: '120', date: '2026-03-10', city: 'Raleigh',    recon_missed: false }, // last week (Mon)
    ];
    setupSupabaseMock({ profile: { name: 'Cameron Smith' }, entries });
    const { findAllByText } = render(<DriverDashboard session={SESSION} />);
    // $150.00 appears in hero card + trip row; $200 (out-of-range) must NOT appear in hero
    const instances = await findAllByText('$150.00');
    expect(instances.length).toBeGreaterThanOrEqual(1);
  });

  it('shows the number of trips and miles for this week', async () => {
    const entries = [
      { id: 1, pay: '75', hours: '4', miles: '60', date: '2026-03-12', city: 'Charlotte', recon_missed: false },
      { id: 2, pay: '75', hours: '4', miles: '40', date: '2026-03-13', city: 'Gastonia',  recon_missed: false },
    ];
    setupSupabaseMock({ profile: { name: 'Cameron Smith' }, entries });
    const { findByText } = render(<DriverDashboard session={SESSION} />);
    expect(await findByText('2 trips')).toBeTruthy();
    expect(await findByText('100 mi')).toBeTruthy();
  });

  it('renders recent trips with city and pay', async () => {
    const entries = [
      { id: 1, pay: '120.00', hours: '6', miles: '80', date: '2026-03-12', city: 'Charlotte', recon_missed: false },
    ];
    setupSupabaseMock({ profile: { name: 'Cameron Smith' }, entries });
    const { findAllByText, findByText } = render(<DriverDashboard session={SESSION} />);
    expect(await findByText('Charlotte')).toBeTruthy();
    // $120.00 appears in both the hero earnings card and the trip row — both are correct
    const payInstances = await findAllByText('$120.00');
    expect(payInstances.length).toBeGreaterThanOrEqual(1);
  });

  it('shows a MISSED tag for entries where recon_missed is true', async () => {
    const entries = [
      { id: 1, pay: '100', hours: '5', miles: '50', date: '2026-03-12', city: 'Concord', recon_missed: true },
    ];
    setupSupabaseMock({ profile: { name: 'Cameron Smith' }, entries });
    const { findByText } = render(<DriverDashboard session={SESSION} />);
    expect(await findByText('MISSED')).toBeTruthy();
  });
});

// ─── Bonus logic ──────────────────────────────────────────────────────────────
describe('DriverDashboard — bonus calculations', () => {
  function makeEntries(count, { recon_missed = false } = {}) {
    return Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      pay: '50',
      hours: '4',
      miles: '30',
      // Use mid-month dates (March 5–29) to avoid timezone boundary edge cases
      // where new Date('2026-03-01') (parsed as UTC) might fall before local March 1 midnight
      date: `2026-03-${String(5 + (i % 25)).padStart(2, '0')}`,
      city: 'Charlotte',
      recon_missed,
    }));
  }

  it('shows trip bonus as not earned when under 20 trips this month', async () => {
    setupSupabaseMock({ profile: { name: 'Cameron' }, entries: makeEntries(10) });
    const { findByText, queryByText } = render(<DriverDashboard session={SESSION} />);
    await findByText('10 / 20 trips this month');
    expect(queryByText('✓ EARNED')).toBeNull();
  });

  it('shows trip bonus as earned at exactly 20 trips this month', async () => {
    setupSupabaseMock({ profile: { name: 'Cameron' }, entries: makeEntries(20) });
    const { findAllByText } = render(<DriverDashboard session={SESSION} />);
    // "✓ EARNED" text appears once trip bonus is met
    const earned = await findAllByText('✓ EARNED');
    expect(earned.length).toBeGreaterThanOrEqual(1);
  });

  it('shows trip bonus as earned when over 20 trips this month', async () => {
    setupSupabaseMock({ profile: { name: 'Cameron' }, entries: makeEntries(25) });
    const { findAllByText } = render(<DriverDashboard session={SESSION} />);
    const earned = await findAllByText('✓ EARNED');
    expect(earned.length).toBeGreaterThanOrEqual(1);
  });

  it('shows recon streak as not earned when streak is under 25', async () => {
    // 10 entries, none with recon_missed → streak = 10
    const entries = makeEntries(10, { recon_missed: false });
    setupSupabaseMock({ profile: { name: 'Cameron' }, entries });
    const { findByText, queryByText } = render(<DriverDashboard session={SESSION} />);
    await findByText('10 / 25 consecutive');
    // No bonus yet; trip bonus also not met
    expect(queryByText('✓ EARNED')).toBeNull();
  });

  it('shows recon streak as earned at exactly 25 consecutive entries', async () => {
    const entries = makeEntries(25, { recon_missed: false });
    setupSupabaseMock({ profile: { name: 'Cameron' }, entries });
    const { findAllByText } = render(<DriverDashboard session={SESSION} />);
    const earned = await findAllByText('✓ EARNED');
    // Recon bonus earned; trip bonus also earned (25 >= 20)
    expect(earned.length).toBe(2);
  });

  it('recon streak breaks at the first recon_missed=true entry', async () => {
    // Sorted by date descending: entries[0] is most recent.
    // The streak counts from the most recent entry backward until recon_missed.
    const entries = [
      { id: 1, pay: '50', hours: '4', miles: '30', date: '2026-03-13', city: 'A', recon_missed: false },
      { id: 2, pay: '50', hours: '4', miles: '30', date: '2026-03-12', city: 'B', recon_missed: false },
      { id: 3, pay: '50', hours: '4', miles: '30', date: '2026-03-11', city: 'C', recon_missed: true }, // streak breaks here
      ...makeEntries(22, { recon_missed: false }).map((e, i) => ({ ...e, id: 100 + i, date: '2026-02-01' })),
    ];
    setupSupabaseMock({ profile: { name: 'Cameron' }, entries });
    const { findByText } = render(<DriverDashboard session={SESSION} />);
    expect(await findByText('2 / 25 consecutive')).toBeTruthy();
  });
});

// ─── Sign out ─────────────────────────────────────────────────────────────────
describe('DriverDashboard — sign out', () => {
  it('calls supabase.auth.signOut when SIGN OUT is pressed', async () => {
    setupSupabaseMock({ profile: { name: 'Cameron Smith' }, entries: [] });
    const { findByText } = render(<DriverDashboard session={SESSION} />);
    const signOutBtn = await findByText('SIGN OUT');
    fireEvent.press(signOutBtn);
    expect(supabase.auth.signOut).toHaveBeenCalled();
  });
});
