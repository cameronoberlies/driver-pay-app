import React from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from "react-native";

export default function FlightDetailsModal({ visible, flight, onClose }) {
  if (!flight) return null;

  const statusConfig = {
    IN_AIR: { emoji: "🛫", label: "IN AIR", color: "#4a9eff" },
    DELAYED: { emoji: "⚠️", label: "DELAYED", color: "#ff9500" },
    SCHEDULED: { emoji: "📅", label: "SCHEDULED", color: "#888" },
    LANDED: { emoji: "✅", label: "LANDED", color: "#4cd964" },
    BOARDING: { emoji: "🚪", label: "BOARDING", color: "#4a9eff" },
  };

  const config = statusConfig[flight.status] || statusConfig["SCHEDULED"];

  function formatTime(timeString) {
    if (!timeString) return "TBD";
    // Handle both ISO strings and simple time strings
    if (timeString.includes("T")) {
      const date = new Date(timeString);
      return date.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
    }
    return timeString;
  }

  function formatDate(dateString) {
    if (!dateString) return "";
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.modalContainer}>
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.flightNumber}>{flight.flight_number}</Text>
              <Text style={styles.passengerName}>{flight.passenger_name}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.content}
            showsVerticalScrollIndicator={false}
          >
            {/* Status Badge */}
            <View
              style={[
                styles.statusBadge,
                { backgroundColor: config.color + "20" },
              ]}
            >
              <Text style={[styles.statusText, { color: config.color }]}>
                {config.emoji} {config.label}
              </Text>
            </View>

            {/* Route */}
            <View style={styles.routeContainer}>
              <View style={styles.airportBox}>
                <Text style={styles.airportCode}>
                  {flight.departure_airport}
                </Text>
                <Text style={styles.airportLabel}>Departure</Text>
              </View>

              <View style={styles.routeLine}>
                <View style={styles.planeDot} />
                <View style={styles.dashedLine} />
                <Text style={styles.planeIcon}>✈️</Text>
              </View>

              <View style={styles.airportBox}>
                <Text style={styles.airportCode}>{flight.arrival_airport}</Text>
                <Text style={styles.airportLabel}>Arrival</Text>
              </View>
            </View>

            {/* Flight Info Grid */}
            <View style={styles.infoGrid}>
              {/* Departure Time */}
              <View style={styles.infoCard}>
                <Text style={styles.infoLabel}>DEPARTURE</Text>
                <Text style={styles.infoValue}>
                  {flight.departure_time
                    ? formatTime(flight.departure_time)
                    : "TBD"}
                </Text>
                {flight.scheduled_date && (
                  <Text style={styles.infoSubtext}>
                    {formatDate(flight.scheduled_date)}
                  </Text>
                )}
              </View>

              {/* Arrival Time */}
              <View style={styles.infoCard}>
                <Text style={styles.infoLabel}>ARRIVAL</Text>
                <Text style={styles.infoValue}>
                  {flight.estimated_arrival
                    ? formatTime(flight.estimated_arrival)
                    : "TBD"}
                </Text>
                {flight.arrival_time && (
                  <Text style={styles.infoSubtext}>
                    {formatTime(flight.arrival_time)}
                  </Text>
                )}
              </View>
            </View>

            {/* Live Data (if in air) */}
            {flight.status === "IN_AIR" && (
              <View style={styles.liveDataContainer}>
                <Text style={styles.sectionTitle}>LIVE DATA</Text>

                <View style={styles.liveDataGrid}>
                  {flight.altitude > 0 && (
                    <View style={styles.liveDataCard}>
                      <Text style={styles.liveDataLabel}>Altitude</Text>
                      <Text style={styles.liveDataValue}>
                        {flight.altitude.toLocaleString()} ft
                      </Text>
                    </View>
                  )}

                  {flight.speed > 0 && (
                    <View style={styles.liveDataCard}>
                      <Text style={styles.liveDataLabel}>Speed</Text>
                      <Text style={styles.liveDataValue}>
                        {flight.speed} mph
                      </Text>
                    </View>
                  )}

                  {flight.heading && (
                    <View style={styles.liveDataCard}>
                      <Text style={styles.liveDataLabel}>Heading</Text>
                      <Text style={styles.liveDataValue}>
                        {flight.heading}°
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            )}

            {/* Additional Info */}
            {(flight.gate || flight.delay_minutes > 0) && (
              <View style={styles.additionalInfo}>
                {flight.gate && (
                  <View style={styles.infoRow}>
                    <Text style={styles.infoRowLabel}>Gate</Text>
                    <Text style={styles.infoRowValue}>{flight.gate}</Text>
                  </View>
                )}

                {flight.delay_minutes > 0 && (
                  <View style={styles.infoRow}>
                    <Text style={styles.infoRowLabel}>Delay</Text>
                    <Text style={[styles.infoRowValue, { color: "#ff9500" }]}>
                      {flight.delay_minutes} min
                    </Text>
                  </View>
                )}
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.85)",
    justifyContent: "flex-end",
  },
  modalContainer: {
    backgroundColor: "#0a0a0a",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "90%",
    borderTopWidth: 1,
    borderTopColor: "#1a1a1a",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    padding: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a1a",
  },
  flightNumber: {
    fontSize: 28,
    fontWeight: "900",
    color: "#fff",
    letterSpacing: 0.5,
  },
  passengerName: {
    fontSize: 14,
    color: "#888",
    marginTop: 4,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#1a1a1a",
    alignItems: "center",
    justifyContent: "center",
  },
  closeText: {
    fontSize: 20,
    color: "#888",
    fontWeight: "700",
  },
  content: {
    padding: 24,
  },
  statusBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginBottom: 24,
  },
  statusText: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
  },
  routeContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 32,
    paddingHorizontal: 8,
  },
  airportBox: {
    alignItems: "center",
  },
  airportCode: {
    fontSize: 32,
    fontWeight: "900",
    color: "#fff",
    letterSpacing: 1,
  },
  airportLabel: {
    fontSize: 10,
    color: "#555",
    marginTop: 4,
    letterSpacing: 1.5,
  },
  routeLine: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    marginHorizontal: 16,
  },
  dashedLine: {
    width: "100%",
    height: 2,
    backgroundColor: "#1a1a1a",
    borderStyle: "dashed",
    borderWidth: 1,
    borderColor: "#333",
  },
  planeDot: {
    position: "absolute",
    left: 0,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#f5a623",
  },
  planeIcon: {
    fontSize: 20,
    position: "absolute",
  },
  infoGrid: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 24,
  },
  infoCard: {
    flex: 1,
    backgroundColor: "#111",
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1a1a1a",
  },
  infoLabel: {
    fontSize: 9,
    color: "#555",
    letterSpacing: 2,
    marginBottom: 8,
  },
  infoValue: {
    fontSize: 20,
    fontWeight: "700",
    color: "#fff",
  },
  infoSubtext: {
    fontSize: 11,
    color: "#666",
    marginTop: 4,
  },
  liveDataContainer: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 10,
    color: "#f5a623",
    letterSpacing: 2.5,
    marginBottom: 12,
    fontWeight: "700",
  },
  liveDataGrid: {
    flexDirection: "row",
    gap: 12,
  },
  liveDataCard: {
    flex: 1,
    backgroundColor: "#111",
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1a1a1a",
    borderLeftWidth: 3,
    borderLeftColor: "#4a9eff",
  },
  liveDataLabel: {
    fontSize: 9,
    color: "#555",
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  liveDataValue: {
    fontSize: 18,
    fontWeight: "700",
    color: "#4a9eff",
  },
  additionalInfo: {
    backgroundColor: "#111",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1a1a1a",
    padding: 16,
    marginBottom: 24,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
  },
  infoRowLabel: {
    fontSize: 13,
    color: "#888",
  },
  infoRowValue: {
    fontSize: 14,
    fontWeight: "700",
    color: "#fff",
  },
  reminderBox: {
    backgroundColor: "rgba(245, 166, 35, 0.1)",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(245, 166, 35, 0.2)",
    marginBottom: 24,
  },
  reminderText: {
    fontSize: 12,
    color: "#f5a623",
    lineHeight: 18,
  },
});
