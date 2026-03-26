import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, ScrollView,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { supabase } from '../lib/supabase';
import { colors, spacing, radius, typography } from '../lib/theme';

export default function LiveDriversScreen() {
  const [locations, setLocations] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [activeTrips, setActiveTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const webviewRef = useRef(null);

  async function load() {
    const [{ data: locs }, { data: profs }, { data: trips }] = await Promise.all([
      supabase.from('driver_locations').select('*'),
      supabase.from('profiles').select('*').eq('role', 'driver'),
      supabase.from('trips').select('*').eq('status', 'in_progress'),
    ]);
    setLocations(locs ?? []);
    setProfiles(profs ?? []);
    setActiveTrips(trips ?? []);
    setLoading(false);
    setLastRefresh(new Date());

    // Push updated data into WebView
    if (webviewRef.current) {
      webviewRef.current.postMessage(JSON.stringify(locs ?? []));
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  const now = new Date();
  const TWO_HOURS = 2 * 60 * 60 * 1000;
  const visibleLocations = locations.filter(l => (now - new Date(l.updated_at)) < TWO_HOURS);
  const active = visibleLocations.filter(l => (now - new Date(l.updated_at)) < 2 * 60 * 1000);

  function getDriverName(id) {
    return profiles.find(p => p.id === id)?.name ?? 'Unknown';
  }

  const mapHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body, #map { width: 100%; height: 100%; background: #0a0a0a; }
  </style>
</head>
<body>
<div id="map"></div>
<script>
  const map = L.map('map', { zoomControl: true, attributionControl: false }).setView([36.0, -80.0], 6);
  map.scrollWheelZoom.disable();
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(map);

  let markers = {};

  function updateMarkers(locations) {
    const seen = new Set();
    const now = Date.now();
    const TWO_HOURS = 2 * 60 * 60 * 1000;
    locations = locations.filter(loc => (now - new Date(loc.updated_at).getTime()) < TWO_HOURS);
    const bounds = [];

    locations.forEach(loc => {
      const age = now - new Date(loc.updated_at).getTime();
      const isActive = age < 2 * 60 * 1000;
      const color = isActive ? '#4ae885' : '#f5a623';
      const icon = L.divIcon({
        className: '',
        html: '<div style="width:14px;height:14px;border-radius:50%;background:' + color + ';border:2px solid #fff;box-shadow:0 0 8px ' + color + '"></div>',
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });

      if (markers[loc.driver_id]) {
        markers[loc.driver_id].setLatLng([loc.latitude, loc.longitude]);
        markers[loc.driver_id].setIcon(icon);
      } else {
        markers[loc.driver_id] = L.marker([loc.latitude, loc.longitude], { icon }).addTo(map);
      }
      seen.add(loc.driver_id);
      bounds.push([loc.latitude, loc.longitude]);
    });

    Object.keys(markers).forEach(id => {
      if (!seen.has(id)) { map.removeLayer(markers[id]); delete markers[id]; }
    });

    if (bounds.length > 0) {
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 12 });
    }
  }

  document.addEventListener('message', function(e) {
    try { updateMarkers(JSON.parse(e.data)); } catch(err) {}
  });
  window.addEventListener('message', function(e) {
    try { updateMarkers(JSON.parse(e.data)); } catch(err) {}
  });
</script>
</body>
</html>
`;

  if (loading) return <View style={s.center}><ActivityIndicator color={colors.primary} /></View>;

  return (
    <View style={s.container}>
      {/* Status bar */}
      <View style={s.statusBar}>
        <View style={s.statusLeft}>
          <View style={[s.dot, { backgroundColor: active.length > 0 ? colors.success : colors.textTertiary }]} />
          <Text style={s.statusText}>{active.length} ACTIVE</Text>
        </View>
        <TouchableOpacity onPress={load} style={s.refreshBtn}>
          <Text style={s.refreshText}>REFRESH</Text>
        </TouchableOpacity>
      </View>

      {/* Driver pills */}
      {visibleLocations.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.pillRow}>
          {visibleLocations.map(loc => {
            const age = now - new Date(loc.updated_at);
            const isActive = age < 2 * 60 * 1000;
            const mins = Math.floor(age / 60000);
            return (
              <View key={loc.driver_id} style={[s.pill, isActive && s.pillActive]}>
                <Text style={[s.pillName, isActive && s.pillNameActive]}>{getDriverName(loc.driver_id)}</Text>
                <Text style={s.pillTime}>{mins < 1 ? 'just now' : `${mins}m ago`}</Text>
              </View>
            );
          })}
        </ScrollView>
      )}

      {/* Map */}
      <View style={s.mapContainer}>
        <WebView
          ref={webviewRef}
          source={{ html: mapHtml }}
          style={s.map}
          onLoad={() => {
            if (webviewRef.current && locations.length > 0) {
              webviewRef.current.postMessage(JSON.stringify(locations));
            }
          }}
          javaScriptEnabled
          domStorageEnabled
          originWhitelist={['*']}
        />
      </View>

      {visibleLocations.length === 0 && (
        <View style={s.emptyOverlay}>
          <Text style={s.emptyText}>No drivers currently tracked</Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' },
  statusBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  statusLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: spacing.sm, height: spacing.sm, borderRadius: spacing.xs },
  statusText: { ...typography.label, color: colors.textSecondary },
  refreshBtn: { borderWidth: 1, borderColor: colors.borderLight, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  refreshText: { ...typography.labelSm, color: colors.primary, fontSize: 10 },
  pillRow: { paddingHorizontal: spacing.xl, paddingVertical: spacing.sm + 2, flexGrow: 0 },
  pill: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginRight: spacing.sm },
  pillActive: { borderColor: colors.success, backgroundColor: colors.successDim },
  pillName: { ...typography.caption, fontWeight: '700', color: colors.textTertiary },
  pillNameActive: { color: colors.success },
  pillTime: { ...typography.captionSm, color: colors.textMuted, marginTop: spacing.xs / 2, fontSize: 10 },
  mapContainer: { flex: 1 },
  map: { flex: 1, backgroundColor: colors.bg },
  emptyOverlay: { position: 'absolute', bottom: 40, left: 0, right: 0, alignItems: 'center' },
  emptyText: { ...typography.bodySm, color: colors.textMuted },
});