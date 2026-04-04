// OBD Trip Summary
// Displays OBD-II data for completed/finalized trips
// Used in Trip Logs modal (HISTORY mode) and finalization modal

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, radius, typography } from '../lib/theme';
import { formatVehicle } from '../lib/obd2';

export default function OBDTripSummary({ obdData }) {
  if (!obdData || !obdData.obd_connected) return null;

  const vehicle = obdData.vehicle;
  const hasDTCs = obdData.diagnostic_codes?.length > 0;

  return (
    <View style={s.container}>
      <Text style={s.sectionTitle}>VEHICLE DATA</Text>

      {/* Vehicle Info */}
      {vehicle && (
        <View style={s.vehicleCard}>
          <Text style={s.vehicleName}>{formatVehicle(vehicle)}</Text>
          {vehicle.vin && (
            <Text style={s.vehicleVin}>{vehicle.vin}</Text>
          )}
          <View style={s.vehicleDetails}>
            {vehicle.engineSize && (
              <Text style={s.vehicleDetail}>{vehicle.engineSize}L {vehicle.cylinders ? `${vehicle.cylinders}cyl` : ''}</Text>
            )}
            {vehicle.transmission && (
              <Text style={s.vehicleDetail}>{vehicle.transmission}</Text>
            )}
            {vehicle.fuelType && (
              <Text style={s.vehicleDetail}>{vehicle.fuelType}</Text>
            )}
          </View>
        </View>
      )}

      {/* Metric Cards */}
      <View style={s.metricsGrid}>
        {obdData.odometer_miles != null && (
          <View style={s.metricCard}>
            <Text style={s.metricLabel}>OBD MILES</Text>
            <Text style={s.metricValue}>{obdData.odometer_miles}</Text>
            <Text style={s.metricUnit}>miles</Text>
          </View>
        )}
        {obdData.max_speed != null && (
          <View style={s.metricCard}>
            <Text style={s.metricLabel}>MAX SPEED</Text>
            <Text style={s.metricValue}>{obdData.max_speed}</Text>
            <Text style={s.metricUnit}>mph</Text>
          </View>
        )}
        {obdData.max_rpm != null && (
          <View style={s.metricCard}>
            <Text style={s.metricLabel}>MAX RPM</Text>
            <Text style={s.metricValue}>{obdData.max_rpm.toLocaleString()}</Text>
            <Text style={s.metricUnit}>rpm</Text>
          </View>
        )}
        {obdData.fuel_used != null && (
          <View style={s.metricCard}>
            <Text style={s.metricLabel}>FUEL USED</Text>
            <Text style={s.metricValue}>{obdData.fuel_used}</Text>
            <Text style={s.metricUnit}>%</Text>
          </View>
        )}
      </View>

      {/* Safety Metrics */}
      {(obdData.hard_brakes > 0 || obdData.hard_accelerations > 0) && (
        <View style={s.safetyRow}>
          {obdData.hard_brakes > 0 && (
            <View style={[s.safetyCard, s.safetyWarn]}>
              <Text style={s.safetyValue}>{obdData.hard_brakes}</Text>
              <Text style={s.safetyLabel}>HARD BRAKES</Text>
            </View>
          )}
          {obdData.hard_accelerations > 0 && (
            <View style={[s.safetyCard, s.safetyWarn]}>
              <Text style={s.safetyValue}>{obdData.hard_accelerations}</Text>
              <Text style={s.safetyLabel}>HARD ACCELS</Text>
            </View>
          )}
        </View>
      )}

      {/* Odometer Detail */}
      {obdData.odometer_start != null && obdData.odometer_end != null && (
        <View style={s.odometerRow}>
          <View style={s.odometerPoint}>
            <Text style={s.odometerLabel}>START</Text>
            <Text style={s.odometerValue}>{obdData.odometer_start.toLocaleString()} mi</Text>
          </View>
          <Text style={s.odometerArrow}>→</Text>
          <View style={s.odometerPoint}>
            <Text style={s.odometerLabel}>END</Text>
            <Text style={s.odometerValue}>{obdData.odometer_end.toLocaleString()} mi</Text>
          </View>
        </View>
      )}

      {/* Fuel Detail */}
      {obdData.fuel_start != null && obdData.fuel_end != null && (
        <View style={s.odometerRow}>
          <View style={s.odometerPoint}>
            <Text style={s.odometerLabel}>FUEL START</Text>
            <Text style={s.odometerValue}>{obdData.fuel_start}%</Text>
          </View>
          <Text style={s.odometerArrow}>→</Text>
          <View style={s.odometerPoint}>
            <Text style={s.odometerLabel}>FUEL END</Text>
            <Text style={s.odometerValue}>{obdData.fuel_end}%</Text>
          </View>
        </View>
      )}

      {/* Diagnostic Codes */}
      {hasDTCs && (
        <View style={s.dtcSection}>
          <Text style={[s.sectionTitle, { color: colors.error }]}>
            ⚠ DIAGNOSTIC CODES ({obdData.diagnostic_codes.length})
          </Text>
          <View style={s.dtcRow}>
            {obdData.diagnostic_codes.map((code, i) => (
              <View key={i} style={s.dtcBadge}>
                <Text style={s.dtcText}>{code}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    marginTop: spacing.md,
  },
  sectionTitle: {
    ...typography.labelSm,
    color: colors.info,
    letterSpacing: 2,
    marginBottom: spacing.md,
  },

  // Vehicle card
  vehicleCard: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 3,
    borderLeftColor: colors.info,
    borderRadius: radius.sm,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  vehicleName: {
    ...typography.h3,
    color: colors.textPrimary,
    fontWeight: '900',
    marginBottom: spacing.xs,
  },
  vehicleVin: {
    ...typography.captionSm,
    color: colors.textMuted,
    fontFamily: 'Courier',
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  vehicleDetails: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  vehicleDetail: {
    ...typography.captionSm,
    color: colors.textTertiary,
  },

  // Metrics grid
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  metricCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: spacing.md,
    alignItems: 'center',
  },
  metricLabel: {
    ...typography.labelSm,
    color: colors.textMuted,
    letterSpacing: 1.5,
    marginBottom: spacing.xs,
  },
  metricValue: {
    fontSize: 22,
    fontWeight: '900',
    color: colors.textPrimary,
  },
  metricUnit: {
    ...typography.captionSm,
    color: colors.textTertiary,
  },

  // Safety metrics
  safetyRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  safetyCard: {
    flex: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
    alignItems: 'center',
  },
  safetyWarn: {
    backgroundColor: colors.warningDim,
    borderWidth: 1,
    borderColor: colors.warningBorder,
  },
  safetyValue: {
    fontSize: 20,
    fontWeight: '900',
    color: colors.warning,
  },
  safetyLabel: {
    ...typography.labelSm,
    color: colors.warning,
    letterSpacing: 1.5,
    marginTop: spacing.xs,
  },

  // Odometer / Fuel detail
  odometerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    marginBottom: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  odometerPoint: {
    alignItems: 'center',
  },
  odometerLabel: {
    ...typography.labelSm,
    color: colors.textMuted,
    letterSpacing: 1.5,
    marginBottom: spacing.xs,
  },
  odometerValue: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  odometerArrow: {
    fontSize: 18,
    color: colors.textMuted,
  },

  // DTCs
  dtcSection: {
    marginTop: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  dtcRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  dtcBadge: {
    backgroundColor: colors.errorDim,
    borderWidth: 1,
    borderColor: colors.errorBorder,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  dtcText: {
    ...typography.labelSm,
    color: colors.error,
    fontFamily: 'Courier',
    letterSpacing: 1,
  },
});
