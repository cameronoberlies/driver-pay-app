import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { flightAPI } from '../lib/flightAPI';
import { colors, spacing, radius, typography } from '../lib/theme';

function formatTime(timeString) {
  if (!timeString) return 'TBD';
  if (timeString.includes('T')) {
    const date = new Date(timeString);
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }
  const [h, m] = timeString.split(':').map(Number);
  if (!isNaN(h) && !isNaN(m)) {
    const period = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 || 12;
    return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
  }
  return timeString;
}

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
            {formatDate(flight.scheduled_date)} • {formatTime(flight.departure_time)} Departure
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
    backgroundColor: colors.surface,
    padding: spacing.lg,
    marginVertical: spacing.md,
    borderRadius: radius.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  heading: {
    ...typography.label,
    color: colors.primary,
    marginBottom: spacing.md,
  },
  flightCard: {
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  flightNumber: {
    ...typography.bodyLg,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  flightTime: {
    ...typography.bodySm,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  flightStatus: {
    ...typography.bodySm,
    color: colors.info,
    marginTop: spacing.xs,
  },
  reminder: {
    ...typography.captionSm,
    color: colors.warning,
    marginTop: spacing.sm,
    fontStyle: 'italic',
  },
});
