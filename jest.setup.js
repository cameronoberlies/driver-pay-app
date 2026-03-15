// Silence noisy console.log calls from the app during tests
jest.spyOn(console, 'log').mockImplementation(() => {});

// Mock expo-location globally — it's a native module with no JS fallback
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  requestBackgroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  watchPositionAsync: jest.fn().mockResolvedValue({ remove: jest.fn() }),
  Accuracy: { High: 5 },
}));

// Mock AsyncStorage (used by Supabase session persistence)
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
