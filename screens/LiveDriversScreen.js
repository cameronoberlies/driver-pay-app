import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, ScrollView,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { supabase } from '../lib/supabase';

export default function LiveDriversScreen() {
  const [locations, setLocations] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const webviewRef = useRef(null);

  async function load() {
    const [{ data: locs }, { data: profs }] = await Promise.all([
      supabase.from('driver_locations').select('*'),
      supabase.from('profiles').select('*').eq('role', 'driver'),
    ]);
    setLocations(locs ?? []);
    setProfiles(profs ?? []);
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

  if (loading) return <View style={s.center}><ActivityIndicator color="#f5a623" /></View>;

  return (
    <View style={s.container}>
      {/* Status bar */}
      <View style={s.statusBar}>
        <View style={s.statusLeft}>
          <View style={[s.dot, { backgroundColor: active.length > 0 ? '#4ae885' : '#555' }]} />
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
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center' },
  statusBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  statusLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 11, color: '#888', fontWeight: '700', letterSpacing: 1.5 },
  refreshBtn: { borderWidth: 1, borderColor: '#2a2a2a', paddingHorizontal: 12, paddingVertical: 5 },
  refreshText: { fontSize: 10, color: '#f5a623', fontWeight: '700', letterSpacing: 1.5 },
  pillRow: { paddingHorizontal: 20, paddingVertical: 10, flexGrow: 0 },
  pill: { backgroundColor: '#111', borderWidth: 1, borderColor: '#1e1e1e', paddingHorizontal: 12, paddingVertical: 8, marginRight: 8 },
  pillActive: { borderColor: '#4ae885', backgroundColor: 'rgba(74,232,133,0.1)' },
  pillName: { fontSize: 12, fontWeight: '700', color: '#555' },
  pillNameActive: { color: '#4ae885' },
  pillTime: { fontSize: 10, color: '#444', marginTop: 2 },
  mapContainer: { flex: 1 },
  map: { flex: 1, backgroundColor: '#0a0a0a' },
  emptyOverlay: { position: 'absolute', bottom: 40, left: 0, right: 0, alignItems: 'center' },
  emptyText: { color: '#444', fontSize: 13 },
});