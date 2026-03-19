// API client for flight monitor
const FLIGHT_API_BASE = 'https://afternoon-nyc-britannica-hugh.trycloudflare.com';

export const flightAPI = {
  // Get all flights for today
  getTodaysFlights: async () => {
    const response = await fetch(`${FLIGHT_API_BASE}/flights/today`);
    return response.json();
  },

  // Get flights for specific driver
  getDriverFlights: async (driverName) => {
    const response = await fetch(
      `${FLIGHT_API_BASE}/flights/driver/${encodeURIComponent(driverName)}`
    );
    return response.json();
  },

  // Get flight stats
  getFlightStats: async () => {
    const response = await fetch(`${FLIGHT_API_BASE}/flights/stats`);
    return response.json();
  }
};