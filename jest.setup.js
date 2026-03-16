// Silence noisy console.log calls from the app during tests
jest.spyOn(console, 'log').mockImplementation(() => {});

// Mock expo-location globally — it's a native module with no JS fallback
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync:  jest.fn().mockResolvedValue({ status: 'granted' }),
  requestBackgroundPermissionsAsync:  jest.fn().mockResolvedValue({ status: 'granted' }),
  // Background task API (used by MyTripsScreen)
  startLocationUpdatesAsync:          jest.fn().mockResolvedValue(undefined),
  stopLocationUpdatesAsync:           jest.fn().mockResolvedValue(undefined),
  hasStartedLocationUpdatesAsync:     jest.fn().mockResolvedValue(true),
  // Foreground watch API (kept for other screens)
  watchPositionAsync:                 jest.fn().mockResolvedValue({ remove: jest.fn() }),
  Accuracy: { High: 5 },
}));

// Mock expo-task-manager globally — it's a native module with no JS fallback
jest.mock('expo-task-manager', () => ({
  defineTask:            jest.fn(),
  isTaskRegisteredAsync: jest.fn().mockResolvedValue(false),
}));

// Mock AsyncStorage (used by Supabase session persistence and background task state)
// Wrap with __esModule + default so that both require(...).default and import ... work
jest.mock('@react-native-async-storage/async-storage', () => {
  const mock = require('@react-native-async-storage/async-storage/jest/async-storage-mock');
  return { __esModule: true, default: mock, ...mock };
});

// Mock expo-notifications globally — uses native modules not available in Jest
jest.mock('expo-notifications', () => ({
  setNotificationHandler:                    jest.fn(),
  addNotificationReceivedListener:           jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener:   jest.fn(() => ({ remove: jest.fn() })),
  removeNotificationSubscription:            jest.fn(),
  getPermissionsAsync:                       jest.fn().mockResolvedValue({ status: 'granted' }),
  requestPermissionsAsync:                   jest.fn().mockResolvedValue({ status: 'granted' }),
  getExpoPushTokenAsync:                     jest.fn().mockResolvedValue({ data: 'ExponentPushToken[test]' }),
  setNotificationChannelAsync:               jest.fn().mockResolvedValue(null),
  AndroidImportance:                         { MAX: 5 },
}));

// Place holder 