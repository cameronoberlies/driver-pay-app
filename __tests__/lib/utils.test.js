import {
  getWeekBounds,
  getMonthBounds,
  withTimeout,
  getDistanceMiles,
  formatDuration,
} from '../../lib/utils';

// ─── getWeekBounds ────────────────────────────────────────────────────────────
// Pay period runs Wednesday–Tuesday.
describe('getWeekBounds', () => {
  afterEach(() => jest.useRealTimers());

  const cases = [
    // [description, isoDate, expectedStartDate, expectedEndDate]
    ['Wednesday → stays on same Wednesday', '2026-03-11T10:00:00', 'Wed Mar 11 2026', 'Tue Mar 17 2026'],
    ['Thursday → back 1 day to Wednesday',  '2026-03-12T10:00:00', 'Wed Mar 11 2026', 'Tue Mar 17 2026'],
    ['Friday → back 2 days to Wednesday',   '2026-03-13T10:00:00', 'Wed Mar 11 2026', 'Tue Mar 17 2026'],
    ['Saturday → back 3 days to Wednesday', '2026-03-14T10:00:00', 'Wed Mar 11 2026', 'Tue Mar 17 2026'],
    ['Sunday → back 4 days to Wednesday',   '2026-03-15T10:00:00', 'Wed Mar 11 2026', 'Tue Mar 17 2026'],
    ['Monday → back 5 days to Wednesday',   '2026-03-16T10:00:00', 'Wed Mar 11 2026', 'Tue Mar 17 2026'],
    ['Tuesday → back 6 days to Wednesday',  '2026-03-17T10:00:00', 'Wed Mar 11 2026', 'Tue Mar 17 2026'],
  ];

  test.each(cases)('%s', (_, isoDate, expectedStart, expectedEnd) => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(isoDate));
    const { start, end } = getWeekBounds();
    expect(start.toDateString()).toBe(expectedStart);
    expect(end.toDateString()).toBe(expectedEnd);
  });

  it('sets start to midnight (00:00:00.000)', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-13T15:30:00'));
    const { start } = getWeekBounds();
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(start.getSeconds()).toBe(0);
    expect(start.getMilliseconds()).toBe(0);
  });

  it('sets end to end-of-day (23:59:59.999)', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-13T15:30:00'));
    const { end } = getWeekBounds();
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
    expect(end.getSeconds()).toBe(59);
    expect(end.getMilliseconds()).toBe(999);
  });

  it('span covers 7 consecutive days (Wed midnight to Tue end-of-day)', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-13T10:00:00'));
    const { start, end } = getWeekBounds();
    // From Wed 00:00:00.000 to Tue 23:59:59.999 is just under 7 full days
    const diffMs = end - start;
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThan(6.9);
    expect(diffDays).toBeLessThan(7);
  });
});

// ─── getMonthBounds ───────────────────────────────────────────────────────────
describe('getMonthBounds', () => {
  afterEach(() => jest.useRealTimers());

  it('start is the 1st of the current month at midnight', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-13T10:00:00'));
    const { start } = getMonthBounds();
    expect(start.getDate()).toBe(1);
    expect(start.getMonth()).toBe(2); // March (0-indexed)
    expect(start.getFullYear()).toBe(2026);
    expect(start.getHours()).toBe(0);
  });

  it('end is the last day of the current month', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-13T10:00:00'));
    const { end } = getMonthBounds();
    expect(end.getDate()).toBe(31); // March has 31 days
    expect(end.getMonth()).toBe(2);
    expect(end.getHours()).toBe(23);
    expect(end.getSeconds()).toBe(59);
  });

  it('handles February in a non-leap year (28 days)', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-02-15T10:00:00'));
    const { end } = getMonthBounds();
    expect(end.getDate()).toBe(28);
  });

  it('handles February in a leap year (29 days)', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-02-15T10:00:00'));
    const { end } = getMonthBounds();
    expect(end.getDate()).toBe(29);
  });
});

// ─── withTimeout ─────────────────────────────────────────────────────────────
describe('withTimeout', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('resolves with the promise value when it settles before the timeout', async () => {
    const p = Promise.resolve('hello');
    const result = await withTimeout(p, 1000);
    expect(result).toBe('hello');
  });

  it('rejects with a timeout error when the promise is too slow', async () => {
    const hanging = new Promise(() => {}); // never resolves
    const racePromise = withTimeout(hanging, 500);
    jest.advanceTimersByTime(600);
    await expect(racePromise).rejects.toThrow('timeout');
  });

  it('propagates the original rejection if the promise rejects first', async () => {
    const failing = Promise.reject(new Error('network error'));
    await expect(withTimeout(failing, 1000)).rejects.toThrow('network error');
  });
});

// ─── getDistanceMiles ─────────────────────────────────────────────────────────
describe('getDistanceMiles', () => {
  it('returns 0 for the same coordinates', () => {
    expect(getDistanceMiles(35.2271, -80.8431, 35.2271, -80.8431)).toBe(0);
  });

  it('is roughly 69 miles per degree of latitude', () => {
    const dist = getDistanceMiles(0, 0, 1, 0);
    expect(dist).toBeGreaterThan(68);
    expect(dist).toBeLessThan(70);
  });

  it('is symmetric (A→B equals B→A)', () => {
    const d1 = getDistanceMiles(35.2, -80.8, 36.0, -81.2);
    const d2 = getDistanceMiles(36.0, -81.2, 35.2, -80.8);
    expect(d1).toBeCloseTo(d2, 5);
  });

  it('Charlotte, NC to Raleigh, NC straight-line is approximately 130 miles', () => {
    // Charlotte: 35.2271° N, 80.8431° W  |  Raleigh: 35.7796° N, 78.6382° W
    // Straight-line (haversine) distance is ~130 miles; driving distance is longer (~165 mi)
    const dist = getDistanceMiles(35.2271, -80.8431, 35.7796, -78.6382);
    expect(dist).toBeGreaterThan(125);
    expect(dist).toBeLessThan(135);
  });

  it('returns a positive value for any distinct coordinates', () => {
    expect(getDistanceMiles(33.749, -84.388, 34.0, -84.0)).toBeGreaterThan(0);
  });
});

// ─── formatDuration ───────────────────────────────────────────────────────────
describe('formatDuration', () => {
  it('formats seconds-only durations', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(1)).toBe('1s');
    expect(formatDuration(59)).toBe('59s');
  });

  it('formats minute + second durations', () => {
    expect(formatDuration(60)).toBe('1m 0s');
    expect(formatDuration(90)).toBe('1m 30s');
    expect(formatDuration(3599)).toBe('59m 59s');
  });

  it('formats hour + minute durations (drops seconds)', () => {
    expect(formatDuration(3600)).toBe('1h 0m');
    expect(formatDuration(3661)).toBe('1h 1m');
    expect(formatDuration(7200)).toBe('2h 0m');
    expect(formatDuration(7380)).toBe('2h 3m');
  });

  it('shows 0m when hours are whole', () => {
    expect(formatDuration(3600)).toBe('1h 0m');
  });
});
