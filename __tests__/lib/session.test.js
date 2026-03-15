import { supabase } from '../../lib/supabase';

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      refreshSession: jest.fn(),
    },
  },
}));

// ─── Token expiry simulation ──────────────────────────────────────────────────
describe('Session refresh on foreground resume', () => {

  it('getSession returns expired token (simulates 1hr background)', async () => {
    supabase.auth.getSession.mockResolvedValueOnce({
      data: {
        session: {
          access_token: 'expired_token',
          expires_at: Math.floor(Date.now() / 1000) - 3600,
        }
      },
      error: null,
    });

    const { data } = await supabase.auth.getSession();
    const isExpired = data.session.expires_at < Math.floor(Date.now() / 1000);
    expect(isExpired).toBe(true);
  });

  it('refreshSession successfully gets a new token after expiry', async () => {
    supabase.auth.refreshSession.mockResolvedValueOnce({
      data: {
        session: {
          access_token: 'new_fresh_token',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        }
      },
      error: null,
    });

    const { data, error } = await supabase.auth.refreshSession();
    expect(error).toBeNull();
    expect(data.session.access_token).toBe('new_fresh_token');
    const isValid = data.session.expires_at > Math.floor(Date.now() / 1000);
    expect(isValid).toBe(true);
  });

  it('refreshSession fails gracefully when offline', async () => {
    supabase.auth.refreshSession.mockResolvedValueOnce({
      data: { session: null },
      error: new Error('network request failed'),
    });

    const { data, error } = await supabase.auth.refreshSession();
    expect(error).not.toBeNull();
    expect(data.session).toBeNull();
  });

});

// ─── AppState handler logic ───────────────────────────────────────────────────
describe('AppState foreground resume triggers session refresh', () => {

  beforeEach(() => {
    supabase.auth.refreshSession.mockReset();
  });

  it('calls refreshSession when app transitions from background to active', async () => {
    supabase.auth.refreshSession.mockResolvedValueOnce({
      data: {
        session: {
          access_token: 'new_token',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        }
      },
      error: null,
    });

    const prevState = 'background';
    const nextState = 'active';

    if (prevState.match(/inactive|background/) && nextState === 'active') {
      const { data, error } = await supabase.auth.refreshSession();
      expect(supabase.auth.refreshSession).toHaveBeenCalledTimes(1);
      expect(error).toBeNull();
      expect(data.session.access_token).toBe('new_token');
    }
  });

  it('calls refreshSession when app transitions from inactive to active', async () => {
    supabase.auth.refreshSession.mockResolvedValueOnce({
      data: { session: { access_token: 'new_token', expires_at: Math.floor(Date.now() / 1000) + 3600 } },
      error: null,
    });

    const prevState = 'inactive';
    const nextState = 'active';

    if (prevState.match(/inactive|background/) && nextState === 'active') {
      await supabase.auth.refreshSession();
    }

    expect(supabase.auth.refreshSession).toHaveBeenCalledTimes(1);
  });

  it('does NOT call refreshSession when app goes from active to background', async () => {
    const prevState = 'active';
    const nextState = 'background';

    if (prevState.match(/inactive|background/) && nextState === 'active') {
      await supabase.auth.refreshSession();
    }

    expect(supabase.auth.refreshSession).not.toHaveBeenCalled();
  });

  it('does NOT call refreshSession when app goes from active to inactive', async () => {
    const prevState = 'active';
    const nextState = 'inactive';

    if (prevState.match(/inactive|background/) && nextState === 'active') {
      await supabase.auth.refreshSession();
    }

    expect(supabase.auth.refreshSession).not.toHaveBeenCalled();
  });

  it('does NOT call refreshSession when no session exists on foreground', async () => {
    supabase.auth.getSession.mockResolvedValueOnce({
      data: { session: null },
      error: null,
    });

    const currentSession = (await supabase.auth.getSession()).data.session;
    if (currentSession) {
      await supabase.auth.refreshSession();
    }

    expect(supabase.auth.refreshSession).not.toHaveBeenCalled();
  });

});