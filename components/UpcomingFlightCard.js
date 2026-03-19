import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { flightAPI } from '../lib/flightAPI';

function formatDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

export default function UpcomingFlightCard({ driverName }) {
  const [flights, setFlights] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadFlights();
  }, []);

  async function loadFlights() {
    try {
      const data = await flightAPI.getDriverFlights(driverName);
      // Only show upcoming flights (not landed/completed)
      const upcoming = data.filter(f => 
        ['SCHEDULED', 'BOARDING', 'DELAYED', 'IN_AIR'].includes(f.status)
      );
      setFlights(upcoming.slice(0, 2)); // Max 2 flights
    } catch (error) {
      console.error('Failed to load flights:', error);
    } finally {
      setLoading(false);
    }
  }

  if (loading || flights.length === 0) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>✈️ YOUR UPCOMING FLIGHTS</Text>
      {flights.map(flight => (
        <View key={flight.id} style={styles.flightCard}>
          <Text style={styles.flightNumber}>
            {flight.flight_number} | {flight.departure_airport} → {flight.arrival_airport}
          </Text>
          <Text style={styles.flightTime}>
            {formatDate(flight.scheduled_date)} • {flight.departure_time} Departure
          </Text>
          <Text style={styles.flightStatus}>
            Status: {flight.status}
          </Text>
          <Text style={styles.reminder}>
            ⚠️ Remember to start trip manually
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#111',
    padding: 16,
    marginHorizontal: 24,
    marginVertical: 12,
    borderRadius: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#f5a623',
  },
  heading: {
    fontSize: 12,
    color: '#f5a623',
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 12,
  },
  flightCard: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  flightNumber: {
    fontSize: 15,
    color: '#fff',
    fontWeight: '700',
  },
  flightTime: {
    fontSize: 13,
    color: '#888',
    marginTop: 4,
  },
  flightStatus: {
    fontSize: 13,
    color: '#4a9eff',
    marginTop: 4,
  },
  reminder: {
    fontSize: 11,
    color: '#ff9500',
    marginTop: 8,
    fontStyle: 'italic',
  },
});