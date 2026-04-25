import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, ScrollView, Modal, RefreshControl,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { supabase } from '../lib/supabase';
import { formatTimeET } from '../lib/utils';
import { colors, spacing, radius, typography } from '../lib/theme';

export default function LiveDriversScreen() {
  const [locations, setLocations] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [showTripLogs, setShowTripLogs] = useState(false);
  const [tripLogs, setTripLogs] = useState([]);
  const webviewRef = useRef(null);

  async function load() {
    const [{ data: locs }, { data: profs }, { data: activeStops }, { data: activeTrips }] = await Promise.all([
      supabase.from('driver_locations').select('*'),
      supabase.from('profiles').select('*').eq('role', 'driver'),
      supabase.from('trip_stops').select('*').is('ended_at', null),
      supabase.from('trips').select('driver_id, second_driver_id').eq('status', 'in_progress'),
    ]);

    // Only show drivers who have an active trip
    const activeDriverIds = new Set(
      (activeTrips ?? []).flatMap(t => [t.driver_id, t.second_driver_id].filter(Boolean))
    );
    const filteredLocs = (locs ?? []).filter(l => activeDriverIds.has(l.driver_id));

    setLocations(filteredLocs);
    setProfiles(profs ?? []);
    setLoading(false);
    setLastRefresh(new Date());

    // Build enriched location data with driver names and stop info
    const enriched = filteredLocs.map(loc => {
      const prof = (profs ?? []).find(p => p.id === loc.driver_id);
      const stop = (activeStops ?? []).find(s => s.driver_id === loc.driver_id);
      return {
        ...loc,
        name: prof?.name ?? 'Unknown',
        activeStop: stop ? {
          started_at: stop.started_at,
          lat: stop.latitude,
          lon: stop.longitude,
        } : null,
      };
    });

    if (webviewRef.current) {
      webviewRef.current.postMessage(JSON.stringify(enriched));
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

  // Dealership marker + geofence ring
  var dealershipIcon = L.divIcon({
    className: '',
    html: '<div style="width:18px;height:18px;border-radius:3px;background:#f5a623;border:2px solid #fff;box-shadow:0 0 10px #f5a623;display:flex;align-items:center;justify-content:center;font-size:10px;color:#000;font-weight:bold;">D</div>',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
  L.marker([35.270367, -81.496247], { icon: dealershipIcon }).addTo(map).bindPopup('Discovery Automotive');
  L.circle([35.270367, -81.496247], { radius: 300, color: '#f5a623', fillColor: '#f5a623', fillOpacity: 0.1, weight: 1, dashArray: '5,5' }).addTo(map);

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
      const isStopped = loc.activeStop != null;
      const color = isStopped ? '#ff453a' : isActive ? '#4ae885' : '#f5a623';
      const firstName = (loc.name || 'Unknown').split(' ')[0];

      var stopInfo = '';
      if (isStopped) {
        var stopMins = Math.round((now - new Date(loc.activeStop.started_at).getTime()) / 60000);
        stopInfo = '<div style="font-size:9px;color:#ff453a;margin-top:2px;">STOPPED ' + stopMins + 'm</div>';
      }

      const icon = L.divIcon({
        className: '',
        html: '<div style="display:flex;flex-direction:column;align-items:center;">' +
          '<div style="width:14px;height:14px;border-radius:50%;background:' + color + ';border:2px solid #fff;box-shadow:0 0 8px ' + color + '"></div>' +
          '<div style="font-size:9px;font-weight:700;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,0.8);margin-top:2px;white-space:nowrap;">' + firstName + '</div>' +
          '</div>',
        iconSize: [60, 30],
        iconAnchor: [30, 7],
      });

      var ageLabel = age < 60000 ? Math.round(age/1000) + 's ago' : age < 3600000 ? Math.round(age/60000) + 'm ago' : Math.round(age/3600000) + 'h ago';

      // Use real ETA from Google Distance Matrix if available, fall back to straight-line
      var etaLabel;
      if (loc.eta_miles != null && loc.eta_minutes != null) {
        if (loc.eta_miles < 5) {
          etaLabel = 'At the dealership';
        } else {
          var hrs = loc.eta_minutes / 60;
          etaLabel = hrs < 1
            ? '~' + loc.eta_miles + ' mi, ~' + loc.eta_minutes + ' min'
            : '~' + loc.eta_miles + ' mi, ~' + hrs.toFixed(1) + ' hrs';
        }
      } else {
        var dLat = (loc.latitude - 35.270367) * Math.PI / 180;
        var dLon = (loc.longitude - (-81.496247)) * Math.PI / 180;
        var a2 = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(35.270367 * Math.PI / 180) * Math.cos(loc.latitude * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
        var distMi = 3958.8 * 2 * Math.atan2(Math.sqrt(a2), Math.sqrt(1-a2));
        etaLabel = distMi < 5 ? 'At the dealership' : '~' + Math.round(distMi) + ' mi out';
      }

      var popupContent = '<div style="font-size:13px;font-weight:800;color:#fff;">' + (loc.name || 'Unknown') + '</div>' +
        '<div style="font-size:10px;color:#6b7585;">LAST UPDATE</div>' +
        '<div style="font-size:12px;font-weight:600;color:' + color + ';">' + ageLabel + '</div>' +
        stopInfo +
        '<div style="font-size:11px;color:#f5a623;font-weight:600;margin-top:4px;">' + etaLabel + '</div>';

      if (markers[loc.driver_id]) {
        markers[loc.driver_id].setLatLng([loc.latitude, loc.longitude]);
        markers[loc.driver_id].setIcon(icon);
        markers[loc.driver_id].setPopupContent(popupContent);
      } else {
        markers[loc.driver_id] = L.marker([loc.latitude, loc.longitude], { icon }).addTo(map).bindPopup(popupContent);
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
          <Text style={[s.statusText, { color: colors.textMuted }]}>  {visibleLocations.length} tracked</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <TouchableOpacity onPress={() => setShowTripLogs(true)} style={[s.refreshBtn, { borderColor: colors.primary }]}>
            <Text style={[s.refreshText, { color: colors.primary }]}>TRIP LOGS</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={load} style={s.refreshBtn}>
            <Text style={s.refreshText}>REFRESH</Text>
          </TouchableOpacity>
        </View>
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
            // Re-send enriched data once WebView is ready
            load();
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

      {/* Trip Logs Modal */}
      <Modal visible={showTripLogs} transparent animationType="slide" onRequestClose={() => setShowTripLogs(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalSheet}>
            <View style={s.modalHandle} />
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>LIVE TRIP LOGS</Text>
              <TouchableOpacity style={s.modalCloseBtn} onPress={() => setShowTripLogs(false)}>
                <Text style={s.modalCloseText}>CLOSE</Text>
              </TouchableOpacity>
            </View>
            <TripLogsContent profiles={profiles} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const LOCATIONIQ_KEY = 'pk.ad8425665c12e1b7f5d7827258d59077';
const locationCache = {};

async function reverseGeocode(lat, lon) {
  const key = `${parseFloat(lat).toFixed(3)},${parseFloat(lon).toFixed(3)}`;
  if (locationCache[key]) return locationCache[key];
  try {
    const res = await fetch(`https://us1.locationiq.com/v1/reverse?key=${LOCATIONIQ_KEY}&lat=${lat}&lon=${lon}&format=json`);
    if (!res.ok) return null;
    const data = await res.json();
    const city = data.address?.city || data.address?.town || data.address?.village || data.address?.county || '';
    const state = data.address?.state || '';
    const result = city && state ? `${city}, ${state}` : city || state || null;
    locationCache[key] = result;
    return result;
  } catch {
    return null;
  }
}

function TripLogsContent({ profiles }) {
  const [mode, setMode] = useState('live'); // 'live' | 'history'
  const [trips, setTrips] = useState([]);
  const [stops, setStops] = useState([]);
  const [pauseEvents, setPauseEvents] = useState([]);
  const [stopLocations, setStopLocations] = useState({});
  const [loading, setLoading] = useState(true);

  // History filters
  const [historyDate, setHistoryDate] = useState(new Date());
  const [historyDriver, setHistoryDriver] = useState('all');
  const [showDatePicker, setShowDatePicker] = useState(false);

  const drivers = profiles.filter(p => p.role === 'driver');

  async function loadLive() {
    const [{ data: activeTrips }, { data: activeStops }, { data: pauses }] = await Promise.all([
      supabase.from('trips').select('*').in('status', ['in_progress']),
      supabase.from('trip_stops').select('*').order('started_at', { ascending: false }).limit(50),
      supabase.from('system_logs').select('*').in('event', ['trip_paused', 'trip_resumed']).order('created_at', { ascending: false }).limit(50),
    ]);
    setTrips(activeTrips ?? []);
    setStops(activeStops ?? []);
    setPauseEvents(pauses ?? []);
    setLoading(false);
    geocodeStops(activeStops ?? []);
  }

  async function loadHistory() {
    setLoading(true);
    const dateStr = historyDate.toISOString().split('T')[0];
    let tripQuery = supabase.from('trips').select('*')
      .in('status', ['completed', 'finalized'])
      .gte('actual_start', dateStr + 'T00:00:00')
      .lte('actual_start', dateStr + 'T23:59:59')
      .order('actual_start', { ascending: false });

    if (historyDriver !== 'all') {
      tripQuery = tripQuery.or(`driver_id.eq.${historyDriver},designated_driver_id.eq.${historyDriver}`);
    }

    const { data: histTrips } = await tripQuery;
    const tripIds = (histTrips ?? []).map(t => t.id);

    let histStops = [];
    let histPauses = [];
    if (tripIds.length > 0) {
      const [{ data: s }, { data: p }] = await Promise.all([
        supabase.from('trip_stops').select('*').in('trip_id', tripIds).order('started_at', { ascending: false }),
        supabase.from('system_logs').select('*').in('event', ['trip_paused', 'trip_resumed']).order('created_at', { ascending: false }).limit(100),
      ]);
      histStops = s ?? [];
      histPauses = (p ?? []).filter(pe => tripIds.includes(pe.metadata?.trip_id));
    }

    setTrips(histTrips ?? []);
    setStops(histStops);
    setPauseEvents(histPauses);
    setLoading(false);
    geocodeStops(histStops);
  }

  function geocodeStops(stopsToGeocode) {
    for (const stop of stopsToGeocode) {
      if (stop.latitude && stop.longitude && !stopLocations[stop.id]) {
        reverseGeocode(stop.latitude, stop.longitude).then(loc => {
          if (loc) setStopLocations(prev => ({ ...prev, [stop.id]: loc }));
        });
      }
    }
  }

  useEffect(() => {
    if (mode === 'live') {
      loadLive();
      const interval = setInterval(loadLive, 15000);
      return () => clearInterval(interval);
    } else {
      loadHistory();
    }
  }, [mode, historyDate, historyDriver]);

  function getName(id) {
    return profiles.find(p => p.id === id)?.name ?? 'Unknown';
  }

  const DateTimePicker = require('@react-native-community/datetimepicker').default;
  const Platform = require('react-native').Platform;


  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      {/* Mode Toggle */}
      <View style={logStyles.modeRow}>
        <TouchableOpacity
          style={[logStyles.modeBtn, mode === 'live' && logStyles.modeBtnActive]}
          onPress={() => setMode('live')}
        >
          <Text style={[logStyles.modeBtnText, mode === 'live' && logStyles.modeBtnTextActive]}>LIVE</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[logStyles.modeBtn, mode === 'history' && logStyles.modeBtnActive]}
          onPress={() => setMode('history')}
        >
          <Text style={[logStyles.modeBtnText, mode === 'history' && logStyles.modeBtnTextActive]}>HISTORY</Text>
        </TouchableOpacity>
      </View>

      {/* History Filters */}
      {mode === 'history' && (
        <View style={logStyles.filterRow}>
          <TouchableOpacity style={logStyles.dateBtn} onPress={() => setShowDatePicker(true)}>
            <Text style={logStyles.dateBtnText}>
              {historyDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </Text>
          </TouchableOpacity>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
            <TouchableOpacity
              style={[logStyles.driverPill, historyDriver === 'all' && logStyles.driverPillActive]}
              onPress={() => setHistoryDriver('all')}
            >
              <Text style={[logStyles.driverPillText, historyDriver === 'all' && logStyles.driverPillTextActive]}>All</Text>
            </TouchableOpacity>
            {drivers.map(d => (
              <TouchableOpacity
                key={d.id}
                style={[logStyles.driverPill, historyDriver === d.id && logStyles.driverPillActive]}
                onPress={() => setHistoryDriver(d.id)}
              >
                <Text style={[logStyles.driverPillText, historyDriver === d.id && logStyles.driverPillTextActive]}>
                  {d.name.split(' ')[0]}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {mode === 'history' && showDatePicker && (
        <View>
          <DateTimePicker
            value={historyDate}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            themeVariant="dark"
            textColor="#fff"
            onChange={(event, date) => {
              if (Platform.OS === 'android') setShowDatePicker(false);
              if (date) setHistoryDate(date);
            }}
            maximumDate={new Date()}
          />
          {Platform.OS === 'ios' && (
            <TouchableOpacity style={{ alignItems: 'center', paddingVertical: 8 }} onPress={() => setShowDatePicker(false)}>
              <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 11, letterSpacing: 1.5 }}>DONE</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {loading && <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />}

      {!loading && trips.length === 0 && (
        <Text style={{ color: colors.textMuted, textAlign: 'center', marginTop: 40, fontSize: 13 }}>
          {mode === 'live' ? 'No active trips' : 'No trips found for this date'}
        </Text>
      )}

      {!loading && trips.map(trip => {
        const driverName = getName(trip.designated_driver_id || trip.driver_id);
        const tripStops = stops.filter(s => s.trip_id === trip.id);
        const tripPauses = pauseEvents.filter(p => p.metadata?.trip_id === trip.id);
        const activeStop = mode === 'live' ? tripStops.find(s => !s.ended_at) : null;
        const elapsed = trip.actual_start
          ? Math.round(((trip.actual_end ? new Date(trip.actual_end) : Date.now()) - new Date(trip.actual_start).getTime()) / 60000)
          : 0;

        return (
          <View key={trip.id} style={logStyles.card}>
            <View style={logStyles.cardHeader}>
              <View>
                <Text style={logStyles.driverName}>{driverName}</Text>
                <Text style={logStyles.tripCity}>{trip.city} · {trip.crm_id || '—'}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={logStyles.elapsed}>{elapsed}m</Text>
                <Text style={logStyles.elapsedLabel}>ELAPSED</Text>
              </View>
            </View>

            {/* Speed data (history mode) */}
            {mode === 'history' && trip.speed_data && trip.speed_data.top_speed > 0 && (
              <View style={logStyles.speedRow}>
                <Text style={logStyles.speedStat}>⚡ Top: {trip.speed_data.top_speed} mph</Text>
                <Text style={logStyles.speedStat}>Avg: {trip.speed_data.avg_speed} mph</Text>
                {trip.speed_data.seconds_over_80 > 0 && (
                  <Text style={[logStyles.speedStat, { color: colors.warning }]}>
                    {Math.round(trip.speed_data.seconds_over_80 / 60)}m &gt;80
                  </Text>
                )}
                {trip.speed_data.seconds_over_90 > 0 && (
                  <Text style={[logStyles.speedStat, { color: colors.error }]}>
                    {Math.round(trip.speed_data.seconds_over_90 / 60)}m &gt;90
                  </Text>
                )}
              </View>
            )}

            {activeStop && (
              <View style={logStyles.activeStopBanner}>
                <View style={logStyles.stopDot} />
                <Text style={logStyles.activeStopText}>
                  STOPPED {Math.round((Date.now() - new Date(activeStop.started_at).getTime()) / 60000)}m
                </Text>
              </View>
            )}

            {tripStops.length > 0 && (
              <View style={logStyles.stopsSection}>
                <Text style={logStyles.stopsTitle}>STOPS ({tripStops.length})</Text>
                {tripStops.map((stop, i) => (
                  <View key={stop.id || i} style={logStyles.stopRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={logStyles.stopTime}>
                        {formatTimeET(stop.started_at)}
                      </Text>
                      {stopLocations[stop.id] && (
                        <Text style={logStyles.stopLocation}>{stopLocations[stop.id]}</Text>
                      )}
                    </View>
                    <Text style={[logStyles.stopDuration, !stop.ended_at && { color: colors.error }]}>
                      {stop.ended_at
                        ? `${stop.duration_minutes}m`
                        : `${Math.round((Date.now() - new Date(stop.started_at).getTime()) / 60000)}m (active)`
                      }
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {tripStops.length === 0 && !tripPauses.length && (
              <Text style={logStyles.noStops}>No stops or pauses recorded</Text>
            )}

            {tripPauses.length > 0 && (
              <View style={logStyles.stopsSection}>
                <Text style={logStyles.stopsTitle}>PAUSES ({tripPauses.length})</Text>
                {tripPauses.map((p, i) => (
                  <View key={p.id || i} style={logStyles.stopRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={logStyles.stopTime}>
                        {p.event === 'trip_paused' ? '⏸' : '▶'} {formatTimeET(p.created_at)}
                      </Text>
                    </View>
                    <Text style={[logStyles.stopDuration, { color: p.event === 'trip_paused' ? colors.warning : colors.success }]}>
                      {p.event === 'trip_paused' ? 'PAUSED' : 'RESUMED'}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

const logStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  driverName: {
    ...typography.h3,
    color: colors.textPrimary,
    fontWeight: '900',
  },
  tripCity: {
    ...typography.captionSm,
    color: colors.textTertiary,
    marginTop: 2,
  },
  elapsed: {
    ...typography.h2,
    color: colors.primary,
  },
  elapsedLabel: {
    ...typography.labelSm,
    color: colors.textMuted,
    letterSpacing: 1.5,
  },
  activeStopBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(255, 69, 58, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 69, 58, 0.25)',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  stopDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.error,
  },
  activeStopText: {
    ...typography.labelSm,
    color: colors.error,
    letterSpacing: 1.5,
  },
  stopsSection: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  stopsTitle: {
    ...typography.labelSm,
    color: colors.textMuted,
    letterSpacing: 2,
    marginBottom: spacing.xs,
  },
  stopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  stopTime: {
    ...typography.captionSm,
    color: colors.textTertiary,
  },
  stopLocation: {
    ...typography.captionSm,
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 1,
  },
  stopDuration: {
    ...typography.captionSm,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  noStops: {
    ...typography.captionSm,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  // Mode toggle
  modeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  modeBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  modeBtnActive: {
    backgroundColor: colors.primaryDim,
    borderColor: colors.primary,
  },
  modeBtnText: {
    ...typography.labelSm,
    color: colors.textTertiary,
    letterSpacing: 2,
  },
  modeBtnTextActive: {
    color: colors.primary,
  },
  // History filters
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
    alignItems: 'center',
  },
  dateBtn: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  dateBtnText: {
    ...typography.captionSm,
    color: colors.primary,
    fontWeight: '700',
  },
  driverPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginRight: spacing.sm,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
  },
  driverPillActive: {
    backgroundColor: colors.primaryDim,
    borderColor: colors.primary,
  },
  driverPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textTertiary,
  },
  driverPillTextActive: {
    color: colors.primary,
  },
  // Speed row
  speedRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginBottom: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  speedStat: {
    ...typography.captionSm,
    color: colors.textTertiary,
  },
});

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
  // Modal
  modalOverlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.xxxxl,
    maxHeight: '85%',
  },
  modalHandle: { width: 36, height: 4, backgroundColor: colors.borderLight, borderRadius: 2, alignSelf: 'center', marginTop: spacing.md, marginBottom: spacing.lg },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg },
  modalTitle: { ...typography.h3, fontWeight: '900', color: colors.textPrimary, letterSpacing: 2 },
  modalCloseBtn: { borderWidth: 1, borderColor: colors.borderLight, borderRadius: radius.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  modalCloseText: { ...typography.labelSm, color: colors.textTertiary, letterSpacing: 1.5 },
});