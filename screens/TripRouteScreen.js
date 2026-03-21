import React, { useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Dimensions, ScrollView } from 'react-native';
import { WebView } from 'react-native-webview';

const { width, height } = Dimensions.get('window');

export default function TripRouteScreen({ route }) {
  const { trip } = route.params;
  const webviewRef = useRef(null);

  // Parse route from trip data
  const routeCoords = trip.route_geojson?.coordinates?.map(coord => ({
    lat: coord[1],
    lon: coord[0]
  })) || [];

  // Detect offline gaps (e.g., flights)
  const hasOfflineGap = trip.trip_type === 'fly';

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
    .info-box {
      position: absolute;
      top: 20px;
      left: 20px;
      right: 20px;
      background: rgba(0,0,0,0.9);
      border: 1px solid #1e1e1e;
      padding: 16px;
      color: #fff;
      z-index: 1000;
    }
    .trip-title { font-size: 16px; font-weight: 900; margin-bottom: 8px; }
    .trip-stats { font-size: 12px; color: #888; }
    .trip-stats span { margin-right: 16px; }
  </style>
</head>
<body>
  <div class="info-box">
    <div class="trip-title">${trip.city} Trip</div>
    <div class="trip-stats">
      <span>⏱ ${trip.hours || 0}h</span>
      <span>📍 ${trip.miles || trip.actual_distance_miles || 0} mi</span>
      ${hasOfflineGap ? '<span>✈️ Flight included</span>' : ''}
    </div>
  </div>
  <div id="map"></div>
  <script>
    const map = L.map('map').setView([35.27, -81.49], 8);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19
    }).addTo(map);

    const coords = ${JSON.stringify(routeCoords)};

    if (coords.length > 0) {
      // Draw route line
      const line = coords.map(c => [c.lat, c.lon]);
      L.polyline(line, {
        color: '#4ae885',
        weight: 4,
        opacity: 0.8
      }).addTo(map);

      // Start marker (green)
      L.marker([coords[0].lat, coords[0].lon], {
        icon: L.divIcon({
          className: '',
          html: '<div style="width:16px;height:16px;border-radius:50%;background:#4ae885;border:3px solid #fff;"></div>',
          iconSize: [16, 16]
        })
      }).addTo(map).bindPopup('Start');

      // End marker (red)
      const last = coords[coords.length - 1];
      L.marker([last.lat, last.lon], {
        icon: L.divIcon({
          className: '',
          html: '<div style="width:16px;height:16px;border-radius:50%;background:#e05252;border:3px solid #fff;"></div>',
          iconSize: [16, 16]
        })
      }).addTo(map).bindPopup('End');

      // Fit map to route
      map.fitBounds(line, { padding: [60, 60] });

      ${hasOfflineGap ? `
      // Show offline gap warning for fly trips
      const mid = Math.floor(coords.length / 2);
      L.marker([coords[mid].lat, coords[mid].lon], {
        icon: L.divIcon({
          className: '',
          html: '<div style="background:rgba(224,82,82,0.9);color:#fff;padding:8px 12px;border-radius:4px;font-size:11px;white-space:nowrap;">✈️ Flight (GPS offline)</div>',
          iconSize: [200, 30]
        })
      }).addTo(map);
      ` : ''}
    }
  </script>
</body>
</html>
  `;

  return (
    <View style={s.container}>
      <WebView
        ref={webviewRef}
        source={{ html: mapHtml }}
        style={s.map}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={['*']}
      />

      {/* Trip details */}
      <View style={s.detailsCard}>
        <Text style={s.detailTitle}>Trip Details</Text>
        <View style={s.detailRow}>
          <Text style={s.detailLabel}>Start:</Text>
          <Text style={s.detailValue}>
            {trip.actual_start ? new Date(trip.actual_start).toLocaleString() : '—'}
          </Text>
        </View>
        <View style={s.detailRow}>
          <Text style={s.detailLabel}>End:</Text>
          <Text style={s.detailValue}>
            {trip.actual_end ? new Date(trip.actual_end).toLocaleString() : '—'}
          </Text>
        </View>
        <View style={s.detailRow}>
          <Text style={s.detailLabel}>Type:</Text>
          <Text style={s.detailValue}>{trip.trip_type === 'fly' ? '✈️ Fly' : '🚗 Drive'}</Text>
        </View>
        {hasOfflineGap && (
          <View style={s.noteBox}>
            <Text style={s.noteText}>
              ✈️ This trip includes a flight. GPS was offline during airplane mode, 
              so the route shows a gap. Total time includes the flight.
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  map: { flex: 1 },
  detailsCard: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#111',
    borderTopWidth: 1,
    borderTopColor: '#1e1e1e',
    padding: 20
  },
  detailTitle: { fontSize: 14, fontWeight: '700', color: '#f5a623', marginBottom: 12 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  detailLabel: { fontSize: 12, color: '#666' },
  detailValue: { fontSize: 12, color: '#fff', fontWeight: '600' },
  noteBox: {
    backgroundColor: 'rgba(245,166,35,0.1)',
    padding: 12,
    borderRadius: 4,
    marginTop: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#f5a623'
  },
  noteText: { fontSize: 11, color: '#f5a623', lineHeight: 16 }
});