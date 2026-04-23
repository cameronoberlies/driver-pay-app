// OBD-II Status Card
// Shows on driver trip card when OBD device is available
// Displays: connection status, vehicle info, live metrics

import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors, spacing, radius, typography } from '../lib/theme';
import { obdBLE, obdData, BLE_STATE, formatVehicle } from '../lib/obd2';

export default function OBDStatusCard({ trip, compact = false }) {
  const [data, setData] = useState(obdData.getSnapshot());
  const [bleState, setBleState] = useState(obdBLE.getState());
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const unsubData = obdData.onUpdate(setData);
    const unsubBLE = obdBLE.onStateChange((state) => {
      setBleState(state);
      setData(obdData.getSnapshot());
    });
    return () => { unsubData(); unsubBLE(); };
  }, []);

  // Don't render if OBD is not available at all
  if (!obdBLE.isAvailable()) return null;

  const connected = data.connected;
  const isConnecting = bleState === BLE_STATE.SCANNING || bleState === BLE_STATE.CONNECTING || bleState === BLE_STATE.INITIALIZING;
  const vehicle = trip?.obd_data?.vehicle;

  if (compact) {
    // Minimal indicator for trip card
    return (
      <View style={s.compactRow}>
        <View style={[s.statusDot, connected ? s.dotConnected : isConnecting ? s.dotConnecting : s.dotDisconnected]} />
        <Text style={[s.compactText, connected && s.compactTextConnected]}>
          {connected ? 'OBD' : isConnecting ? 'CONNECTING...' : 'OBD OFF'}
        </Text>
        {connected && data.speed != null && (
          <Text style={s.compactMetric}>{data.speed} mph</Text>
        )}
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={s.card}
      activeOpacity={0.7}
      onPress={() => setExpanded(!expanded)}
    >
      {/* Vehicle Info */}
      {vehicle && (
        <View style={s.vehicleRow}>
          <Text style={s.vehicleText}>{formatVehicle(vehicle)}</Text>
          {vehicle.vin && (
            <Text style={s.vinText}>VIN: {vehicle.vin.slice(-6)}</Text>
          )}
        </View>
      )}

      {/* Connection Status + Key Metrics */}
      <View style={s.statusRow}>
        <View style={s.statusLeft}>
          <View style={[s.statusDot, connected ? s.dotConnected : isConnecting ? s.dotConnecting : s.dotDisconnected]} />
          <Text style={[s.statusText, connected ? s.statusConnected : isConnecting ? s.statusConnecting : s.statusDisconnected]}>
            {connected ? 'OBD CONNECTED' : isConnecting ? 'CONNECTING...' : 'OBD DISCONNECTED'}
          </Text>
        </View>
        <Text style={s.expandIcon}>{expanded ? '▲' : '▼'}</Text>
      </View>

      {/* Live Metrics Line */}
      {connected && (
        <View style={s.metricsRow}>
          {data.speed != null && (
            <View style={s.metric}>
              <Text style={s.metricValue}>{data.speed}</Text>
              <Text style={s.metricUnit}>mph</Text>
            </View>
          )}
          {data.rpm != null && (
            <View style={s.metric}>
              <Text style={s.metricValue}>{data.rpm.toLocaleString()}</Text>
              <Text style={s.metricUnit}>rpm</Text>
            </View>
          )}
          {data.fuelLevel != null && (
            <View style={s.metric}>
              <Text style={s.metricValue}>{data.fuelLevel}</Text>
              <Text style={s.metricUnit}>% fuel</Text>
            </View>
          )}
          {data.coolantTemp != null && (
            <View style={s.metric}>
              <Text style={[s.metricValue, data.coolantTemp > 220 && { color: colors.error }]}>
                {data.coolantTemp}°
              </Text>
              <Text style={s.metricUnit}>F</Text>
            </View>
          )}
        </View>
      )}

      {/* Expanded Detail */}
      {expanded && connected && (
        <View style={s.expandedSection}>
          {data.odometer != null && (
            <View style={s.detailRow}>
              <Text style={s.detailLabel}>ODOMETER</Text>
              <Text style={s.detailValue}>{data.odometer.toLocaleString()} mi</Text>
            </View>
          )}
          {data.tripData?.odometerDelta != null && (
            <View style={s.detailRow}>
              <Text style={s.detailLabel}>TRIP MILES (OBD)</Text>
              <Text style={s.detailValue}>{data.tripData.odometerDelta} mi</Text>
            </View>
          )}
          {data.batteryVoltage != null && (
            <View style={s.detailRow}>
              <Text style={s.detailLabel}>BATTERY</Text>
              <Text style={[s.detailValue, data.batteryVoltage < 12 && { color: colors.error }]}>
                {data.batteryVoltage}V
              </Text>
            </View>
          )}
          {data.engineLoad != null && (
            <View style={s.detailRow}>
              <Text style={s.detailLabel}>ENGINE LOAD</Text>
              <Text style={s.detailValue}>{data.engineLoad}%</Text>
            </View>
          )}
          {data.throttle != null && (
            <View style={s.detailRow}>
              <Text style={s.detailLabel}>THROTTLE</Text>
              <Text style={s.detailValue}>{data.throttle}%</Text>
            </View>
          )}
          {data.tripData?.hardBrakes > 0 && (
            <View style={s.detailRow}>
              <Text style={s.detailLabel}>HARD BRAKES</Text>
              <Text style={[s.detailValue, { color: colors.warning }]}>{data.tripData.hardBrakes}</Text>
            </View>
          )}
          {data.tripData?.hardAccelerations > 0 && (
            <View style={s.detailRow}>
              <Text style={s.detailLabel}>HARD ACCELS</Text>
              <Text style={[s.detailValue, { color: colors.warning }]}>{data.tripData.hardAccelerations}</Text>
            </View>
          )}
          {data.tripData?.fuelUsed != null && data.tripData.fuelUsed > 0 && (
            <View style={s.detailRow}>
              <Text style={s.detailLabel}>FUEL USED</Text>
              <Text style={s.detailValue}>{data.tripData.fuelUsed}%</Text>
            </View>
          )}
        </View>
      )}

      {/* Disconnected — show scan button */}
      {!connected && obdBLE.isAvailable() && (
        <TouchableOpacity
          style={s.scanBtn}
          onPress={async () => {
            const devices = await obdBLE.scan();
            if (devices.length > 0) {
              await obdBLE.connect(devices[0].id);
            }
          }}
        >
          <Text style={s.scanBtnText}>SCAN FOR DEVICE</Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 3,
    borderLeftColor: colors.info,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginTop: spacing.sm,
  },

  // Vehicle info
  vehicleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  vehicleText: {
    ...typography.h3,
    fontSize: 14,
    color: colors.textPrimary,
    fontWeight: '800',
  },
  vinText: {
    ...typography.captionSm,
    color: colors.textMuted,
    fontFamily: 'Courier',
  },

  // Status row
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotConnected: {
    backgroundColor: colors.info,
    shadowColor: colors.info,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 4,
  },
  dotDisconnected: {
    backgroundColor: colors.textMuted,
  },
  dotConnecting: {
    backgroundColor: colors.warning,
    shadowColor: colors.warning,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 3,
  },
  statusText: {
    ...typography.labelSm,
    letterSpacing: 2,
  },
  statusConnected: {
    color: colors.info,
  },
  statusDisconnected: {
    color: colors.textMuted,
  },
  statusConnecting: {
    color: colors.warning,
  },
  expandIcon: {
    fontSize: 10,
    color: colors.info,
  },

  // Metrics row
  metricsRow: {
    flexDirection: 'row',
    gap: spacing.xl,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  metric: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.xs,
  },
  metricValue: {
    fontSize: 18,
    fontWeight: '900',
    color: colors.textPrimary,
  },
  metricUnit: {
    ...typography.captionSm,
    color: colors.textTertiary,
  },

  // Expanded detail
  expandedSection: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  detailLabel: {
    ...typography.labelSm,
    color: colors.textMuted,
    letterSpacing: 1.5,
  },
  detailValue: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '700',
  },

  // Scan button
  scanBtn: {
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.info,
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  scanBtnText: {
    ...typography.labelSm,
    color: colors.info,
    letterSpacing: 2,
  },

  // Compact mode
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  compactText: {
    ...typography.captionSm,
    color: colors.textMuted,
    letterSpacing: 1,
  },
  compactTextConnected: {
    color: colors.info,
  },
  compactMetric: {
    ...typography.captionSm,
    color: colors.textSecondary,
    fontWeight: '700',
  },
});
