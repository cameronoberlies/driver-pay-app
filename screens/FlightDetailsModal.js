import React from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from "react-native";
import { colors, spacing, radius, typography } from "../lib/theme";

export default function FlightDetailsModal({ visible, flight, onClose }) {
  if (!flight) return null;

  const statusConfig = {
    IN_AIR: { emoji: "🛫", label: "IN AIR", color: colors.info },
    DELAYED: { emoji: "⚠️", label: "DELAYED", color: colors.warning },
    SCHEDULED: { emoji: "📅", label: "SCHEDULED", color: colors.textSecondary },
    LANDED: { emoji: "✅", label: "LANDED", color: colors.success },
    BOARDING: { emoji: "🚪", label: "BOARDING", color: colors.info },
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
    const [h, m] = timeString.split(":").map(Number);
    if (!isNaN(h) && !isNaN(m)) {
      const period = h >= 12 ? "PM" : "AM";
      const hour12 = h % 12 || 12;
      return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
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
                    <Text style={[styles.infoRowValue, { color: colors.warning }]}>
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
    backgroundColor: colors.overlay,
    justifyContent: "flex-end",
  },
  modalContainer: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: "90%",
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    padding: spacing.xxl,
    paddingBottom: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  flightNumber: {
    fontSize: 28,
    fontWeight: "900",
    color: colors.textPrimary,
    letterSpacing: 0.5,
  },
  passengerName: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  closeText: {
    fontSize: 20,
    color: colors.textSecondary,
    fontWeight: "700",
  },
  content: {
    padding: spacing.xxl,
  },
  statusBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.xl,
    marginBottom: spacing.xxl,
  },
  statusText: {
    ...typography.caption,
    fontWeight: "700",
    letterSpacing: 1,
  },
  routeContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.xxxl,
    paddingHorizontal: spacing.sm,
  },
  airportBox: {
    alignItems: "center",
  },
  airportCode: {
    ...typography.displayMd,
    color: colors.textPrimary,
    letterSpacing: 1,
  },
  airportLabel: {
    ...typography.labelSm,
    color: colors.textMuted,
    marginTop: spacing.xs,
    letterSpacing: 1.5,
  },
  routeLine: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    marginHorizontal: spacing.lg,
  },
  dashedLine: {
    width: "100%",
    height: 2,
    backgroundColor: colors.border,
    borderStyle: "dashed",
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  planeDot: {
    position: "absolute",
    left: 0,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  planeIcon: {
    fontSize: 20,
    position: "absolute",
  },
  infoGrid: {
    flexDirection: "row",
    gap: spacing.md,
    marginBottom: spacing.xxl,
  },
  infoCard: {
    flex: 1,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  infoLabel: {
    ...typography.labelSm,
    color: colors.textMuted,
    letterSpacing: 2,
    marginBottom: spacing.sm,
  },
  infoValue: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  infoSubtext: {
    ...typography.captionSm,
    color: colors.textTertiary,
    marginTop: spacing.xs,
  },
  liveDataContainer: {
    marginBottom: spacing.xxl,
  },
  sectionTitle: {
    ...typography.labelSm,
    fontSize: 10,
    color: colors.primary,
    letterSpacing: 2.5,
    marginBottom: spacing.md,
  },
  liveDataGrid: {
    flexDirection: "row",
    gap: spacing.md,
  },
  liveDataCard: {
    flex: 1,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 3,
    borderLeftColor: colors.info,
  },
  liveDataLabel: {
    ...typography.labelSm,
    color: colors.textMuted,
    letterSpacing: 1.5,
    marginBottom: spacing.sm,
  },
  liveDataValue: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.info,
  },
  additionalInfo: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.xxl,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.sm,
  },
  infoRowLabel: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
  infoRowValue: {
    ...typography.body,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  reminderBox: {
    backgroundColor: colors.primaryDim,
    borderRadius: radius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    marginBottom: spacing.xxl,
  },
  reminderText: {
    ...typography.caption,
    color: colors.primary,
    lineHeight: 18,
  },
});
