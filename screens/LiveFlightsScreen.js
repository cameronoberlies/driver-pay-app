import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { flightAPI } from "../lib/flightAPI";
import FlightDetailsModal from "./FlightDetailsModal";
import { colors, spacing, radius, typography } from "../lib/theme";

export default function LiveFlightsScreen() {
  const [flights, setFlights] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedFlight, setSelectedFlight] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [expandedSections, setExpandedSections] = useState({
    IN_AIR: true,
    DELAYED: true,
    SCHEDULED: false,
    LANDED: false,
  });

  useEffect(() => {
    loadFlights();
    const interval = setInterval(loadFlights, 60000); // Auto-refresh every 60s
    return () => clearInterval(interval);
  }, []);

  async function loadFlights() {
    try {
      const [flightData, statsData] = await Promise.all([
        flightAPI.getTodaysFlights(),
        flightAPI.getFlightStats(),
      ]);
      setFlights(flightData);
      setStats(statsData);
    } catch (error) {
      console.error("Failed to load flights:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  function onRefresh() {
    setRefreshing(true);
    loadFlights();
  }

  function toggleSection(status) {
    setExpandedSections((prev) => ({
      ...prev,
      [status]: !prev[status],
    }));
  }

  function groupFlightsByStatus() {
    return {
      IN_AIR: flights.filter((f) => f.status === "IN_AIR"),
      DELAYED: flights.filter(
        (f) => f.delay_minutes > 0 && f.status !== "LANDED",
      ),
      SCHEDULED: flights.filter((f) => f.status === "SCHEDULED"),
      LANDED: flights.filter((f) => f.status === "LANDED"),
    };
  }

  if (loading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  const groupedFlights = groupFlightsByStatus();

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.primary}
        />
      }
    >
      {/* Stats Bar */}
      <View style={styles.statsBar}>
        <Text style={styles.statText}>
          📊 {stats.in_air || 0} IN AIR • {stats.delayed || 0} DELAYED
        </Text>
      </View>

      {/* Flight Groups */}
      {Object.entries(groupedFlights).map(([status, statusFlights]) => (
        <FlightGroup
          key={status}
          status={status}
          flights={statusFlights}
          expanded={expandedSections[status]}
          onToggle={() => toggleSection(status)}
          onFlightPress={(flight) => {
            setSelectedFlight(flight);
            setModalVisible(true);
          }}
        />
      ))}

      <FlightDetailsModal
        visible={modalVisible}
        flight={selectedFlight}
        onClose={() => setModalVisible(false)}
      />

      {flights.length === 0 && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>✈️</Text>
          <Text style={styles.emptySubtext}>
            No flights scheduled for today
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

function FlightGroup({ status, flights, expanded, onToggle, onFlightPress }) {
  if (flights.length === 0) return null;

  const statusConfig = {
    IN_AIR: { emoji: "🛫", label: "IN AIR", color: colors.info },
    DELAYED: { emoji: "⚠️", label: "DELAYED", color: colors.warning },
    SCHEDULED: { emoji: "📅", label: "SCHEDULED", color: colors.textSecondary },
    LANDED: { emoji: "✅", label: "LANDED", color: colors.success },
  };

  const config = statusConfig[status];

  return (
    <View style={styles.group}>
      <TouchableOpacity style={styles.groupHeader} onPress={onToggle}>
        <Text style={styles.groupTitle}>
          {config.emoji} {config.label} ({flights.length})
        </Text>
        <Text style={styles.expandIcon}>{expanded ? "▼" : "▶"}</Text>
      </TouchableOpacity>

      {expanded &&
        flights.map((flight) => (
          <TouchableOpacity
            key={flight.id}
            onPress={() => onFlightPress(flight)}
          >
            <FlightCard flight={flight} statusColor={config.color} />
          </TouchableOpacity>
        ))}
    </View>
  );
}

function formatTime(timeString) {
  if (!timeString) return 'TBD';
  if (timeString.includes('T')) {
    const date = new Date(timeString);
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }
  // Convert plain "HH:MM" (24h) to 12h AM/PM
  const [h, m] = timeString.split(':').map(Number);
  if (!isNaN(h) && !isNaN(m)) {
    const period = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 || 12;
    return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
  }
  return timeString;
}

function FlightCard({ flight, statusColor }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardFlight}>
        {flight.flight_number} • {flight.passenger_name}
      </Text>
      <Text style={styles.cardRoute}>
        {flight.departure_airport} → {flight.arrival_airport}
      </Text>
      {flight.altitude > 0 && (
        <Text style={styles.cardDetails}>
          ✈️ {flight.altitude.toLocaleString()} ft • {flight.speed} mph
        </Text>
      )}
      {flight.estimated_arrival && (
        <Text style={styles.cardEta}>
          ETA: {formatTime(flight.estimated_arrival)}
        </Text>
      )}
    </View>
  );
}

// Styles...
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  loader: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.bg,
  },
  statsBar: {
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    borderRadius: radius.md,
  },
  statText: { ...typography.body, fontWeight: "700", color: colors.primary },
  group: { marginBottom: spacing.lg },
  groupHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: spacing.lg,
    backgroundColor: colors.surface,
  },
  groupTitle: {
    ...typography.body,
    fontWeight: "700",
    color: colors.textPrimary,
    letterSpacing: 1,
  },
  expandIcon: { ...typography.caption, color: colors.textSecondary },
  card: {
    backgroundColor: colors.surface,
    padding: spacing.lg,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
    borderRadius: radius.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  cardFlight: { ...typography.bodyLg, fontWeight: "700", color: colors.textPrimary, fontSize: 15 },
  cardRoute: { ...typography.bodySm, color: colors.textSecondary, marginTop: spacing.xs },
  cardDetails: { ...typography.caption, color: colors.info, marginTop: spacing.xs },
  cardEta: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  emptyState: { alignItems: "center", marginTop: 100 },
  emptyText: { fontSize: 60 },
  emptySubtext: { ...typography.body, color: colors.textTertiary, marginTop: spacing.md },
});
