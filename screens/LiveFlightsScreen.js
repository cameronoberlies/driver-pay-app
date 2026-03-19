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
import FlightDetailsModal from "./Flightdetailsmodal";

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
        <ActivityIndicator color="#f5a623" size="large" />
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
          tintColor="#f5a623"
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
    IN_AIR: { emoji: "🛫", label: "IN AIR", color: "#4a9eff" },
    DELAYED: { emoji: "⚠️", label: "DELAYED", color: "#ff9500" },
    SCHEDULED: { emoji: "📅", label: "SCHEDULED", color: "#888" },
    LANDED: { emoji: "✅", label: "LANDED", color: "#4cd964" },
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
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  loader: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#0a0a0a",
  },
  statsBar: {
    padding: 16,
    backgroundColor: "#111",
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a1a",
  },
  statText: { fontSize: 14, color: "#f5a623", fontWeight: "700" },
  group: { marginBottom: 16 },
  groupHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    backgroundColor: "#111",
  },
  groupTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#fff",
    letterSpacing: 1,
  },
  expandIcon: { fontSize: 12, color: "#888" },
  card: {
    backgroundColor: "#111",
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 8,
    marginTop: 8,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: "#f5a623",
  },
  cardFlight: { fontSize: 15, fontWeight: "700", color: "#fff" },
  cardRoute: { fontSize: 13, color: "#888", marginTop: 4 },
  cardDetails: { fontSize: 12, color: "#4a9eff", marginTop: 4 },
  cardEta: { fontSize: 12, color: "#888", marginTop: 4 },
  emptyState: { alignItems: "center", marginTop: 100 },
  emptyText: { fontSize: 60 },
  emptySubtext: { fontSize: 14, color: "#555", marginTop: 12 },
});
