// API client for flight monitor
const FLIGHT_API_BASE = 'https://yincjogkjvotupzgetqg.supabase.co/functions/v1/flight-proxy/api';

export const flightAPI = {
  // Get all flights for today
  getTodaysFlights: async () => {
    try {
      const response = await fetch(`${FLIGHT_API_BASE}/flights/today`);
      if (!response.ok) return [];
      const data = await response.json();
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  },

  // Get flights for specific driver
  getDriverFlights: async (driverName) => {
    try {
      const response = await fetch(
        `${FLIGHT_API_BASE}/flights/driver/${encodeURIComponent(driverName)}`
      );
      if (!response.ok) return [];
      const data = await response.json();
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  },

  // Get flight stats
  getFlightStats: async () => {
    try {
      const response = await fetch(`${FLIGHT_API_BASE}/flights/stats`);
      if (!response.ok) return {};
      const data = await response.json();
      return data || {};
    } catch {
      return {};
    }
  }
};