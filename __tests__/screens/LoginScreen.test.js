import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import LoginScreen from '../../screens/LoginScreen';

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: jest.fn(),
    },
  },
}));

import { supabase } from '../../lib/supabase';

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  Alert.alert.mockRestore();
});

describe('LoginScreen', () => {
  it('renders email and password inputs plus sign-in button', () => {
    const { getByPlaceholderText, getByText } = render(<LoginScreen />);
    expect(getByPlaceholderText('you@driverportal.live')).toBeTruthy();
    expect(getByPlaceholderText('••••••••')).toBeTruthy();
    expect(getByText('SIGN IN →')).toBeTruthy();
  });

  it('renders the DRIVERPAY branding', () => {
    const { getByText } = render(<LoginScreen />);
    expect(getByText('Driver Portal')).toBeTruthy();
  });

  it('shows an alert when submitting with empty fields', async () => {
    const { getByText } = render(<LoginScreen />);
    fireEvent.press(getByText('SIGN IN →'));
    expect(Alert.alert).toHaveBeenCalledWith('Error', 'Please enter your email and password.');
    expect(supabase.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('shows an alert when submitting with only email filled in', async () => {
    const { getByPlaceholderText, getByText } = render(<LoginScreen />);
    fireEvent.changeText(getByPlaceholderText('you@driverportal.live'), 'test@example.com');
    fireEvent.press(getByText('SIGN IN →'));
    expect(Alert.alert).toHaveBeenCalledWith('Error', 'Please enter your email and password.');
  });

  it('calls signInWithPassword with the entered credentials', async () => {
    supabase.auth.signInWithPassword.mockResolvedValueOnce({ error: null });
    const { getByPlaceholderText, getByText } = render(<LoginScreen />);

    fireEvent.changeText(getByPlaceholderText('you@driverportal.live'), 'driver@example.com');
    fireEvent.changeText(getByPlaceholderText('••••••••'), 'password123');
    fireEvent.press(getByText('SIGN IN →'));

    await waitFor(() => {
      expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
        email: 'driver@example.com',
        password: 'password123',
      });
    });
  });

  it('shows a Login Failed alert when Supabase returns an error', async () => {
    supabase.auth.signInWithPassword.mockResolvedValueOnce({
      error: { message: 'Invalid login credentials' },
    });
    const { getByPlaceholderText, getByText } = render(<LoginScreen />);

    fireEvent.changeText(getByPlaceholderText('you@driverportal.live'), 'bad@example.com');
    fireEvent.changeText(getByPlaceholderText('••••••••'), 'wrongpassword');
    fireEvent.press(getByText('SIGN IN →'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Login Failed', 'Invalid login credentials');
    });
  });

  it('does not show an error alert on successful login', async () => {
    supabase.auth.signInWithPassword.mockResolvedValueOnce({ error: null });
    const { getByPlaceholderText, getByText } = render(<LoginScreen />);

    fireEvent.changeText(getByPlaceholderText('you@driverportal.live'), 'driver@example.com');
    fireEvent.changeText(getByPlaceholderText('••••••••'), 'correct');
    fireEvent.press(getByText('SIGN IN →'));

    await waitFor(() => {
      expect(supabase.auth.signInWithPassword).toHaveBeenCalled();
    });
    expect(Alert.alert).not.toHaveBeenCalledWith('Login Failed', expect.anything());
  });
});
