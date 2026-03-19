import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { GeofenceManager } from '../lib/GeofenceManager';
import * as Notifications from 'expo-notifications';
 
function GeofenceDebugPanel() {
  const [debugInfo, setDebugInfo] = useState({
    isActive: false,
    distance: null,
    insideZone: false,
    lastCheck: '',
  });
 
  async function refresh() {
    const isActive = await GeofenceManager.isActive();
    const distanceData = await GeofenceManager.getDistanceFromGeofence();
    
    setDebugInfo({
      isActive,
      distance: distanceData?.distance || 'N/A',
      insideZone: distanceData?.insideZone || false,
      lastCheck: new Date().toLocaleTimeString(),
    });
  }
 
  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000); // Update every 5s
    return () => clearInterval(interval);
  }, []);
 
  async function testNotification() {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '🧪 Test Notification',
        body: 'If you see this, notifications work!',
      },
      trigger: null,
    });
  }
 
  return (
    <View style={s.debugPanel}>
      <Text style={s.debugTitle}>🔍 GEOFENCE DEBUG</Text>
      
      <View style={s.debugRow}>
        <Text style={s.debugLabel}>Geofence Active:</Text>
        <Text style={[s.debugValue, { color: debugInfo.isActive ? '#4ae885' : '#e05252' }]}>
          {debugInfo.isActive ? '✅ YES' : '❌ NO'}
        </Text>
      </View>
 
      <View style={s.debugRow}>
        <Text style={s.debugLabel}>Distance from Home:</Text>
        <Text style={s.debugValue}>
          {debugInfo.distance !== 'N/A' ? `${debugInfo.distance}m` : 'N/A'}
        </Text>
      </View>
 
      <View style={s.debugRow}>
        <Text style={s.debugLabel}>Inside Geofence:</Text>
        <Text style={[s.debugValue, { color: debugInfo.insideZone ? '#4ae885' : '#888' }]}>
          {debugInfo.insideZone ? 'YES' : 'NO'}
        </Text>
      </View>
 
      <View style={s.debugRow}>
        <Text style={s.debugLabel}>Last Check:</Text>
        <Text style={s.debugValue}>{debugInfo.lastCheck}</Text>
      </View>
 
      <View style={s.debugButtons}>
        <TouchableOpacity style={s.debugBtn} onPress={refresh}>
          <Text style={s.debugBtnText}>REFRESH</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={[s.debugBtn, { backgroundColor: '#f5a623' }]} onPress={testNotification}>
          <Text style={[s.debugBtnText, { color: '#0a0a0a' }]}>TEST NOTIFICATION</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
 
const s = StyleSheet.create({
  debugPanel: {
    margin: 20,
    padding: 16,
    backgroundColor: '#111',
    borderWidth: 2,
    borderColor: '#f5a623',
    borderRadius: 8,
  },
  debugTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: '#f5a623',
    letterSpacing: 1,
    marginBottom: 12,
    textAlign: 'center',
  },
  debugRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  debugLabel: {
    fontSize: 12,
    color: '#888',
    fontFamily: 'Courier',
  },
  debugValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
    fontFamily: 'Courier',
  },
  debugButtons: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  debugBtn: {
    flex: 1,
    padding: 10,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    borderRadius: 4,
  },
  debugBtnText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#f5a623',
    letterSpacing: 1,
  },
});
 
export default GeofenceDebugPanel;