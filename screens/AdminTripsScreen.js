import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Modal,
  Alert,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { WebView } from 'react-native-webview';
import DateTimePicker from '@react-native-community/datetimepicker';
import { supabase } from '../lib/supabase';
import { colors, spacing, radius, typography, components } from '../lib/theme';
import CityAutocomplete from '../components/CityAutocomplete';
import TripChatScreen from './TripChatScreen';
import useResponsive from '../lib/useResponsive';

// Trip status colors
const STATUS_COLORS = {
  pending: colors.info,
  in_progress: colors.primary,
  completed: colors.success,
  finalized: colors.textTertiary,
};

export default function AdminTripsScreen({ session, userRole }) {
  const isReadOnly = userRole === 'caller';
  const { isTablet } = useResponsive();
  const [trips, setTrips] = useState([]);
  const [allProfiles, setAllProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState('active'); // 'active' | 'all' | 'create'
  const [selectedTrip, setSelectedTrip] = useState(null);
  const [showFinalizeModal, setShowFinalizeModal] = useState(false);
  const [routeTrip, setRouteTrip] = useState(null);
  const [unreadCounts, setUnreadCounts] = useState({});
  const [chatTrip, setChatTrip] = useState(null);

  // Load trips + profiles
  useEffect(() => {
    loadData();

    // Subscribe to realtime updates
    const subscription = supabase
      .channel('trips_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trips' },
        (payload) => {
          console.log('Trip change:', payload);
          loadData();
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  async function loadData() {
    setLoading(true);
    const [tripsRes, profilesRes] = await Promise.all([
      supabase.from('trips').select('*').order('scheduled_pickup', { ascending: false }),
      supabase.from('profiles').select('*'),
    ]);

    if (tripsRes.error) console.error('Error loading trips:', tripsRes.error);
    else setTrips(tripsRes.data || []);

    if (profilesRes.error) console.error('Error loading profiles:', profilesRes.error);
    else setAllProfiles(profilesRes.data || []);

    setLoading(false);
  }

  async function loadUnreadCounts() {
    const userId = (await supabase.auth.getUser()).data.user?.id;
    if (!userId || trips.length === 0) return;

    const { data: messages } = await supabase
      .from('trip_messages')
      .select('trip_id, sender_id')
      .in('trip_id', trips.map(t => t.id));

    if (!messages) return;

    const counts = {};
    messages.forEach(msg => {
      if (msg.sender_id !== userId) {
        counts[msg.trip_id] = (counts[msg.trip_id] || 0) + 1;
      }
    });
    setUnreadCounts(counts);
  }

  useEffect(() => {
    if (trips.length > 0) loadUnreadCounts();
  }, [trips]);

  async function handleDeleteTrip(trip) {
    Alert.alert(
      'Delete Trip',
      `Delete ${trip.city} (${trip.crm_id || 'No CRM'})? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase.from('trips').delete().eq('id', trip.id);
            if (error) {
              Alert.alert('Error', error.message);
            } else {
              setTrips((prev) => prev.filter((t) => t.id !== trip.id));
            }
          },
        },
      ]
    );
  }

  async function handleRefresh() {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }

  const activeTrips = trips.filter(
    (t) => t.status === 'pending' || t.status === 'in_progress'
  );

  const displayedTrips = view === 'active' ? activeTrips : trips;

  if (loading && !refreshing) {
    return (
      <View style={s.container}>
        <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 100 }} />
      </View>
    );
  }

  if (view === 'create') {
    return (
      <CreateTripView
        drivers={allProfiles.filter((p) => p.role === 'driver')}
        onBack={() => setView('active')}
        onCreated={(trip) => {
          setTrips([trip, ...trips]);
          setView('active');
        }}
      />
    );
  }

  return (
    <View style={s.container}>
      {/* Tab Navigation */}
      <View style={s.tabBar}>
        <TouchableOpacity
          style={[s.tab, view === 'active' && s.tabActive]}
          onPress={() => setView('active')}
        >
          <Text style={[s.tabText, view === 'active' && s.tabTextActive]}>
            ACTIVE ({activeTrips.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.tab, view === 'all' && s.tabActive]}
          onPress={() => setView('all')}
        >
          <Text style={[s.tabText, view === 'all' && s.tabTextActive]}>
            ALL TRIPS ({trips.length})
          </Text>
        </TouchableOpacity>
        {!isReadOnly && (
          <TouchableOpacity style={s.createBtn} onPress={() => setView('create')}>
            <Text style={s.createBtnText}>+ CREATE TRIP</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Header */}
      <View style={s.header}>
        <Text style={s.sectionTitle}>
          {view === 'active' ? 'ACTIVE TRIPS' : 'ALL TRIPS'}
        </Text>
        <Text style={s.sectionCount}>{displayedTrips.length} trips</Text>
      </View>

      {/* Trips List - CARD LAYOUT */}
      <ScrollView
        style={s.scrollView}
        contentContainerStyle={isTablet ? { alignSelf: 'center', maxWidth: 700, width: '100%' } : undefined}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
      >
        <View style={isTablet ? { flexDirection: 'row', flexWrap: 'wrap', gap: 10 } : undefined}>
        {displayedTrips.map((trip) => (
          <TripCard
            key={trip.id}
            trip={trip}
            allProfiles={allProfiles}
            unreadCount={unreadCounts[trip.id] || 0}
            isTablet={isTablet}
            onPress={() => {
              if (isReadOnly) return;
              setSelectedTrip(trip);
              if (trip.status === 'completed') {
                setShowFinalizeModal(true);
              }
            }}
            onViewRoute={(t) => setRouteTrip(t)}
            onChatPress={(t) => setChatTrip(t)}
            onDelete={isReadOnly ? null : handleDeleteTrip}
            isReadOnly={isReadOnly}
          />
        ))}
        </View>

        {displayedTrips.length === 0 && (
          <View style={s.emptyState}>
            <Text style={s.emptyText}>
              {view === 'active' ? 'No active trips' : 'No trips yet'}
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Route Map Modal */}
      {routeTrip && (
        <RouteMapModal
          trip={routeTrip}
          onClose={() => setRouteTrip(null)}
        />
      )}

      {/* Chat Modal */}
      {chatTrip && (
        <Modal visible transparent animationType="slide">
          <TripChatScreen
            trip={chatTrip}
            allProfiles={allProfiles}
            onClose={() => {
              setChatTrip(null);
              loadUnreadCounts();
            }}
          />
        </Modal>
      )}

      {/* Finalize Modal */}
      {showFinalizeModal && selectedTrip && (
        <FinalizeTripModal
          trip={selectedTrip}
          allProfiles={allProfiles}
          onClose={() => {
            setShowFinalizeModal(false);
            setSelectedTrip(null);
          }}
          onFinalized={(updatedTrip) => {
            setTrips(trips.map((t) => (t.id === updatedTrip.id ? updatedTrip : t)));
            setShowFinalizeModal(false);
            setSelectedTrip(null);
          }}
        />
      )}
    </View>
  );
}

// ── TRIP CARD (Card Layout) ──────────────────────────────────────────────────
function TripCard({ trip, allProfiles, onPress, onViewRoute, unreadCount, isTablet, onChatPress, onDelete, isReadOnly }) {
  const driver1 = allProfiles.find((p) => p.id === trip.driver_id);
  const driver2 = trip.second_driver_id
    ? allProfiles.find((p) => p.id === trip.second_driver_id)
    : null;

  const statusColor = STATUS_COLORS[trip.status] || '#6b7585';
  const pickupDate = trip.scheduled_pickup
    ? new Date(trip.scheduled_pickup).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      })
    : null;
  const pickupTime = trip.scheduled_pickup
    ? new Date(trip.scheduled_pickup).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;

  const displayMiles = trip.miles || trip.actual_distance_miles;
  const isCompleted = trip.status === 'completed' || trip.status === 'finalized';

  return (
    <TouchableOpacity style={[s.card, isTablet && { width: '48.5%' }]} onPress={onPress} activeOpacity={0.7}>
      {/* Top Row: Status + CRM + Type */}
      <View style={s.cardTop}>
        <View style={[s.statusBadge, { borderColor: statusColor, backgroundColor: `${statusColor}15` }]}>
          <Text style={[s.statusText, { color: statusColor }]}>
            {trip.status === 'in_progress' ? 'IN PROGRESS' : trip.status.toUpperCase()}
          </Text>
        </View>
        <Text style={s.crmId}>{trip.crm_id || '—'}</Text>
        <Text style={s.tripType}>
          {trip.trip_type === 'fly' ? '✈ FLY' : '🚗 DRIVE'}
        </Text>
      </View>

      {/* Main Info Row */}
      <View style={s.cardMain}>
        <View style={s.cardLeft}>
          <Text style={s.cityText}>{trip.city}</Text>
          {pickupDate && (
            <Text style={s.pickupText}>
              {pickupDate} at {pickupTime}
            </Text>
          )}
        </View>
      </View>

      {/* Trip stats for completed trips */}
      {isCompleted && (
        <View style={s.tripStatsRow}>
          {trip.hours ? <Text style={s.tripStat}>{trip.hours}h</Text> : null}
          {trip.hours && displayMiles ? <Text style={s.tripStatDot}>·</Text> : null}
          {displayMiles ? <Text style={s.tripStat}>{parseFloat(displayMiles).toFixed(1)} mi</Text> : null}
        </View>
      )}

      {/* Route button or no-route label for completed trips */}
      {isCompleted && trip.route_geojson && (
        <TouchableOpacity
          onPress={() => onViewRoute(trip)}
          style={s.viewRouteBtn}
          activeOpacity={0.7}
        >
          <Text style={s.viewRouteText}>View Route</Text>
        </TouchableOpacity>
      )}
      {isCompleted && !trip.route_geojson && (
        <Text style={s.noRouteText}>No route data (manual trip)</Text>
      )}

      {/* Drivers Row */}
      <View style={s.driversRow}>
        <Text style={s.driverLabel}>
          {driver1?.name || 'Unknown'}
          {driver1?.willing_to_fly && <Text style={s.flyBadge}> (F)</Text>}
        </Text>
        {driver2 && (
          <Text style={s.driverLabel2}>
            + {driver2.name}
            {driver2.willing_to_fly && <Text style={s.flyBadge}> (F)</Text>}
          </Text>
        )}
      </View>

      {/* Notes (if present) */}
      {trip.notes && (
        <Text style={s.notesText} numberOfLines={2}>
          {trip.notes}
        </Text>
      )}

      {/* Action Row */}
      <View style={s.chatRow}>
        {trip.status === 'pending' && !isReadOnly && onDelete && (
          <TouchableOpacity
            style={s.deleteBtn}
            onPress={() => onDelete(trip)}
            activeOpacity={0.7}
          >
            <Text style={s.deleteBtnText}>DELETE</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={s.chatBtn}
          onPress={() => onChatPress(trip)}
          activeOpacity={0.7}
        >
          <Text style={s.chatIcon}>💬</Text>
          {unreadCount > 0 && (
            <View style={s.chatBadge}>
              <Text style={s.chatBadgeText}>{unreadCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

// ── ROUTE MAP MODAL ──────────────────────────────────────────────────────────
function RouteMapModal({ trip, onClose }) {
  const webviewRef = useRef(null);

  const geojson = typeof trip.route_geojson === 'string'
    ? trip.route_geojson
    : JSON.stringify(trip.route_geojson);

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
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(map);

  try {
    const geojson = ${geojson};
    const layer = L.geoJSON(geojson, {
      style: { color: '#f5a623', weight: 3, opacity: 0.9 },
      pointToLayer: function(feature, latlng) {
        return L.circleMarker(latlng, { radius: 6, fillColor: '#f5a623', color: '#fff', weight: 2, fillOpacity: 1 });
      }
    }).addTo(map);
    map.fitBounds(layer.getBounds(), { padding: [40, 40] });
  } catch(e) {
    document.body.innerHTML = '<div style="color:#888;display:flex;align-items:center;justify-content:center;height:100%;font-family:sans-serif;">Failed to load route</div>';
  }
</script>
</body>
</html>
`;

  return (
    <Modal visible transparent animationType="slide">
      <View style={s.routeModalContainer}>
        <View style={s.routeModalHeader}>
          <View>
            <Text style={s.routeModalTitle}>{trip.city} — {trip.crm_id}</Text>
            <Text style={s.routeModalSubtitle}>
              {trip.actual_distance_miles ? `${parseFloat(trip.actual_distance_miles).toFixed(1)} mi` : ''}
              {trip.actual_distance_miles && trip.actual_duration_minutes ? '  ·  ' : ''}
              {trip.actual_duration_minutes ? `${Math.round(trip.actual_duration_minutes)} min` : ''}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} style={s.routeCloseBtn}>
            <Text style={s.routeCloseText}>CLOSE</Text>
          </TouchableOpacity>
        </View>
        <WebView
          ref={webviewRef}
          source={{ html: mapHtml }}
          style={s.routeMap}
          javaScriptEnabled
          domStorageEnabled
          originWhitelist={['*']}
        />
      </View>
    </Modal>
  );
}

// ── CREATE TRIP VIEW ─────────────────────────────────────────────────────────
function CreateTripView({ drivers, onBack, onCreated }) {
  const now = new Date();
  const [form, setForm] = useState({
    driver_id: drivers[0]?.id || '',
    second_driver_id: '',
    designated_driver_id: '',
    trip_type: 'fly',
    city: '',
    crm_id: '',
    carpage_link: '',
    scheduled_pickup: now,
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  
  // Date picker states
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function onDateChange(event, selectedDate) {
    if (Platform.OS === 'android') setShowDatePicker(false);
    if (selectedDate) {
      const newDate = new Date(form.scheduled_pickup);
      newDate.setFullYear(selectedDate.getFullYear());
      newDate.setMonth(selectedDate.getMonth());
      newDate.setDate(selectedDate.getDate());
      set('scheduled_pickup', newDate);
    }
  }

  function onTimeChange(event, selectedTime) {
    if (Platform.OS === 'android') setShowTimePicker(false);
    if (selectedTime) {
      const newDate = new Date(form.scheduled_pickup);
      newDate.setHours(selectedTime.getHours());
      newDate.setMinutes(selectedTime.getMinutes());
      set('scheduled_pickup', newDate);
    }
  }

  async function handleCreate() {
    if (!form.driver_id || !form.city || !form.crm_id) {
      setError('Driver, City, and CRM ID are required');
      return;
    }

    setSaving(true);
    setError('');

    const payload = {
      driver_id: form.driver_id,
      second_driver_id: form.second_driver_id || null,
      designated_driver_id: form.designated_driver_id || form.driver_id,
      trip_type: form.trip_type,
      city: form.city,
      crm_id: form.crm_id,
      carpage_link: form.carpage_link || null,
      scheduled_pickup: form.scheduled_pickup.toISOString(),
      notes: form.notes || null,
      status: 'pending',
    };

    const { data, error: err } = await supabase
      .from('trips')
      .insert(payload)
      .select()
      .single();

    setSaving(false);

    if (err) {
      setError(err.message);
      return;
    }

    onCreated(data);
  }

  const formattedDate = form.scheduled_pickup.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const formattedTime = form.scheduled_pickup.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={100}>
    <ScrollView style={s.createContainer}>
      <View style={s.createHeader}>
        <TouchableOpacity onPress={onBack} style={s.backBtn}>
          <Text style={s.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.createTitle}>Create Trip</Text>
      </View>

      <View style={s.form}>
        <View style={s.field}>
          <Text style={s.label}>Trip Type</Text>
          <View style={s.segmentControl}>
            <TouchableOpacity
              style={[
                s.segment,
                form.trip_type === 'fly' && s.segmentActive,
              ]}
              onPress={() => set('trip_type', 'fly')}
            >
              <Text
                style={[
                  s.segmentText,
                  form.trip_type === 'fly' && s.segmentTextActive,
                ]}
              >
                ✈ Fly
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                s.segment,
                form.trip_type === 'drive' && s.segmentActive,
              ]}
              onPress={() => set('trip_type', 'drive')}
            >
              <Text
                style={[
                  s.segmentText,
                  form.trip_type === 'drive' && s.segmentTextActive,
                ]}
              >
                🚗 Drive
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={s.field}>
          <Text style={s.label}>
            {form.trip_type === 'drive' ? 'Driver 1 (Chase Car)' : 'Assigned Driver'}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {drivers.map((d) => (
              <TouchableOpacity
                key={d.id}
                style={[s.driverPill, form.driver_id === d.id && s.driverPillActive]}
                onPress={() => set('driver_id', d.id)}
              >
                <Text style={[s.driverPillText, form.driver_id === d.id && s.driverPillTextActive]}>
                  {d.name}{d.willing_to_fly ? ' (F)' : ''}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {form.trip_type === 'drive' && (
          <View style={s.field}>
            <Text style={s.label}>Driver 2 (Drives Vehicle Back)</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <TouchableOpacity
                style={[s.driverPill, form.second_driver_id === '' && s.driverPillActive]}
                onPress={() => set('second_driver_id', '')}
              >
                <Text style={[s.driverPillText, form.second_driver_id === '' && s.driverPillTextActive]}>
                  — None —
                </Text>
              </TouchableOpacity>
              {drivers
                .filter((d) => d.id !== form.driver_id)
                .map((d) => (
                  <TouchableOpacity
                    key={d.id}
                    style={[s.driverPill, form.second_driver_id === d.id && s.driverPillActive]}
                    onPress={() => set('second_driver_id', d.id)}
                  >
                    <Text style={[s.driverPillText, form.second_driver_id === d.id && s.driverPillTextActive]}>
                      {d.name}{d.willing_to_fly ? ' (F)' : ''}
                    </Text>
                  </TouchableOpacity>
                ))}
            </ScrollView>
          </View>
        )}

        <View style={s.field}>
          <Text style={s.label}>City / Pickup Location *</Text>
          <CityAutocomplete
            style={s.input}
            placeholder="Columbus, OH"
            placeholderTextColor={colors.textTertiary}
            value={form.city}
            onChangeText={(text) => set('city', text)}
          />
        </View>

        <View style={s.field}>
          <Text style={s.label}>CRM ID *</Text>
          <TextInput
            style={s.input}
            placeholder="AB123"
            placeholderTextColor={colors.textTertiary}
            value={form.crm_id}
            onChangeText={(text) => set('crm_id', text)}
          />
        </View>

        {/* DATE & TIME PICKERS */}
        <View style={s.field}>
          <Text style={s.label}>Scheduled Pickup</Text>
          <View style={s.dateTimeRow}>
            <TouchableOpacity
              style={s.dateTimeButton}
              onPress={() => setShowDatePicker(true)}
            >
              <Text style={s.dateTimeButtonText}>📅 {formattedDate}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.dateTimeButton}
              onPress={() => setShowTimePicker(true)}
            >
              <Text style={s.dateTimeButtonText}>🕐 {formattedTime}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {showDatePicker && (
          <View>
            <DateTimePicker
              value={form.scheduled_pickup}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              themeVariant="dark"
              textColor="#fff"
              onChange={onDateChange}
            />
            {Platform.OS === 'ios' && (
              <TouchableOpacity style={s.pickerDone} onPress={() => setShowDatePicker(false)}>
                <Text style={s.pickerDoneText}>Done</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {showTimePicker && (
          <View>
            <DateTimePicker
              value={form.scheduled_pickup}
              mode="time"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              themeVariant="dark"
              textColor="#fff"
              onChange={onTimeChange}
            />
            {Platform.OS === 'ios' && (
              <TouchableOpacity style={s.pickerDone} onPress={() => setShowTimePicker(false)}>
                <Text style={s.pickerDoneText}>Done</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        <View style={s.field}>
          <Text style={s.label}>Carpage Link</Text>
          <TextInput
            style={s.input}
            placeholder="https://..."
            placeholderTextColor={colors.textTertiary}
            value={form.carpage_link}
            onChangeText={(text) => set('carpage_link', text)}
            autoCapitalize="none"
          />
        </View>

        <View style={s.field}>
          <Text style={s.label}>Notes</Text>
          <TextInput
            style={[s.input, { height: 80 }]}
            placeholder="Flight info, seller contact, etc."
            placeholderTextColor={colors.textTertiary}
            value={form.notes}
            onChangeText={(text) => set('notes', text)}
            multiline
          />
        </View>

        {error ? <Text style={s.errorText}>{error}</Text> : null}

        <TouchableOpacity
          style={[s.createSubmitBtn, saving && s.disabled]}
          onPress={handleCreate}
          disabled={saving}
        >
          <Text style={s.createSubmitText}>
            {saving ? 'Creating...' : 'Create Trip →'}
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── FINALIZE TRIP MODAL ────────────────────────────────────────────────────────────────────────────
function FinalizeTripModal({ trip, allProfiles, onClose, onFinalized }) {
  const driver1 = allProfiles.find((p) => p.id === trip.driver_id);
  const driver2 = trip.second_driver_id
    ? allProfiles.find((p) => p.id === trip.second_driver_id)
    : null;

  const duration =
    trip.actual_start && trip.actual_end
      ? ((new Date(trip.actual_end) - new Date(trip.actual_start)) / 3600000).toFixed(1)
      : '';

  const [form, setForm] = useState({
    pay: '',
    pay2: '',
    hours: duration,
    miles: String(trip.miles || ''),
    actual_cost: String(trip.actual_cost || ''),
    estimated_cost: String(trip.estimated_cost || ''),
    recon_missed: false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleFinalize() {
    if (!form.pay) {
      setError('Driver 1 pay is required');
      return;
    }
    if (driver2 && !form.pay2) {
      setError('Driver 2 pay is required');
      return;
    }

    setSaving(true);
    setError('');

    // Update trip to finalized
    const { error: tripError } = await supabase
      .from('trips')
      .update({
        status: 'finalized',
        pay: Number(form.pay),
        second_driver_pay: driver2 ? Number(form.pay2) : null,
        hours: Number(form.hours),
        miles: Number(form.miles),
        actual_cost: Number(form.actual_cost),
        estimated_cost: Number(form.estimated_cost),
        recon_missed: form.recon_missed,
      })
      .eq('id', trip.id);

    if (tripError) {
      setError(tripError.message);
      setSaving(false);
      return;
    }

    // Create entries for each driver
    const entries = [
      {
        driver_id: trip.driver_id,
        trip_id: trip.id,
        date: trip.actual_start ? trip.actual_start.split('T')[0] : new Date().toISOString().split('T')[0],
        pay: Number(form.pay),
        hours: Number(form.hours),
        city: trip.city,
        crm_id: trip.crm_id,
        miles: Number(form.miles),
        actual_cost: Number(form.actual_cost),
        estimated_cost: Number(form.estimated_cost),
        carpage_link: trip.carpage_link,
        recon_missed: form.recon_missed,
      },
    ];

    if (driver2) {
      entries.push({
        driver_id: trip.second_driver_id,
        trip_id: trip.id,
        date: trip.actual_start ? trip.actual_start.split('T')[0] : new Date().toISOString().split('T')[0],
        pay: Number(form.pay2),
        hours: Number(form.hours),
        city: trip.city,
        crm_id: trip.crm_id,
        miles: Number(form.miles),
        actual_cost: Number(form.actual_cost),
        estimated_cost: Number(form.estimated_cost),
        carpage_link: trip.carpage_link,
        recon_missed: form.recon_missed,
      });
    }

    const { error: entriesError } = await supabase.from('entries').insert(entries);

    setSaving(false);

    if (entriesError) {
      setError(entriesError.message);
      return;
    }

    const updatedTrip = {
      ...trip,
      status: 'finalized',
      pay: Number(form.pay),
      second_driver_pay: driver2 ? Number(form.pay2) : null,
      hours: Number(form.hours),
      miles: Number(form.miles),
      actual_cost: Number(form.actual_cost),
      estimated_cost: Number(form.estimated_cost),
      recon_missed: form.recon_missed,
    };

    onFinalized(updatedTrip);
  }

  return (
    <Modal visible transparent animationType="fade">
      <View style={s.modalOverlay}>
        <View style={s.modalContainer}>
          <Text style={s.modalTitle}>Finalize Trip</Text>
          <Text style={s.modalSubtitle}>
            {trip.city} · {trip.crm_id}
          </Text>

          <ScrollView style={{ maxHeight: 400 }}>
            <View style={s.modalField}>
              <Text style={s.modalLabel}>{driver1?.name} Pay ($) *</Text>
              <TextInput
                style={s.modalInput}
                placeholder="0.00"
                placeholderTextColor={colors.textTertiary}
                keyboardType="decimal-pad"
                value={form.pay}
                onChangeText={(text) => set('pay', text)}
              />
            </View>

            {driver2 && (
              <View style={s.modalField}>
                <Text style={s.modalLabel}>{driver2.name} Pay ($) *</Text>
                <TextInput
                  style={s.modalInput}
                  placeholder="0.00"
                  placeholderTextColor={colors.textTertiary}
                  keyboardType="decimal-pad"
                  value={form.pay2}
                  onChangeText={(text) => set('pay2', text)}
                />
              </View>
            )}

            <View style={s.modalField}>
              <Text style={s.modalLabel}>Hours Worked</Text>
              <TextInput
                style={s.modalInput}
                placeholder="0.0"
                placeholderTextColor={colors.textTertiary}
                keyboardType="decimal-pad"
                value={form.hours}
                onChangeText={(text) => set('hours', text)}
              />
            </View>

            <View style={s.modalField}>
              <Text style={s.modalLabel}>Miles Driven</Text>
              <TextInput
                style={s.modalInput}
                placeholder="0"
                placeholderTextColor={colors.textTertiary}
                keyboardType="decimal-pad"
                value={form.miles}
                onChangeText={(text) => set('miles', text)}
              />
            </View>

            <View style={s.modalField}>
              <Text style={s.modalLabel}>Actual Cost ($)</Text>
              <TextInput
                style={s.modalInput}
                placeholder="0.00"
                placeholderTextColor={colors.textTertiary}
                keyboardType="decimal-pad"
                value={form.actual_cost}
                onChangeText={(text) => set('actual_cost', text)}
              />
            </View>

            <View style={s.modalField}>
              <Text style={s.modalLabel}>Estimated Cost ($)</Text>
              <TextInput
                style={s.modalInput}
                placeholder="0.00"
                placeholderTextColor={colors.textTertiary}
                keyboardType="decimal-pad"
                value={form.estimated_cost}
                onChangeText={(text) => set('estimated_cost', text)}
              />
            </View>

            <TouchableOpacity
              style={s.checkboxRow}
              onPress={() => set('recon_missed', !form.recon_missed)}
            >
              <View
                style={[s.checkbox, form.recon_missed && s.checkboxChecked]}
              >
                {form.recon_missed && <Text style={s.checkmark}>✓</Text>}
              </View>
              <Text style={s.checkboxLabel}>Recon was missed on this vehicle</Text>
            </TouchableOpacity>
          </ScrollView>

          {error ? <Text style={s.modalError}>{error}</Text> : null}

          <View style={s.modalActions}>
            <TouchableOpacity style={s.modalBtnCancel} onPress={onClose}>
              <Text style={s.modalBtnCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.modalBtnSave, saving && s.disabled]}
              onPress={handleFinalize}
              disabled={saving}
            >
              <Text style={s.modalBtnSaveText}>
                {saving ? 'Finalizing...' : 'Finalize Trip →'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── STYLES ───────────────────────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: {
    ...components.screen,
  },
  tabBar: {
    flexDirection: 'row',
    padding: spacing.lg,
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tab: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
  },
  tabActive: {
    backgroundColor: colors.primaryDim,
    borderColor: colors.primary,
  },
  tabText: {
    ...typography.captionSm,
    letterSpacing: 1,
    color: colors.textTertiary,
  },
  tabTextActive: {
    color: colors.primary,
  },
  createBtn: {
    marginLeft: 'auto',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
  },
  createBtnText: {
    ...typography.captionSm,
    letterSpacing: 1,
    color: colors.bg,
  },
  scrollView: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sectionTitle: {
    ...typography.caption,
    letterSpacing: 1.5,
    color: colors.primary,
  },
  sectionCount: {
    ...typography.captionSm,
    color: colors.textTertiary,
  },
  // CARD LAYOUT
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  statusBadge: {
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  statusText: {
    ...typography.labelSm,
    letterSpacing: 0.5,
  },
  crmId: {
    ...typography.body,
    fontWeight: '700',
    color: colors.primary,
    letterSpacing: 0.5,
  },
  tripType: {
    ...typography.captionSm,
    color: colors.textTertiary,
    marginLeft: 'auto',
  },
  cardMain: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  cardLeft: {
    flex: 1,
  },
  cityText: {
    ...typography.h3,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  pickupText: {
    ...typography.caption,
    color: colors.textTertiary,
  },
  driversRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  driverLabel: {
    ...typography.bodySm,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  driverLabel2: {
    ...typography.bodySm,
    color: colors.textTertiary,
    fontWeight: '500',
  },
  flyBadge: {
    color: colors.primary,
    fontSize: 11,
  },
  tripStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  tripStat: {
    fontSize: 12,
    color: '#d4d8df',
    fontWeight: '600',
  },
  tripStatDot: {
    color: '#6b7585',
  },
  viewRouteBtn: {
    borderWidth: 1,
    borderColor: '#f5a623',
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignSelf: 'flex-start',
    marginBottom: 10,
  },
  viewRouteText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#f5a623',
    letterSpacing: 0.5,
  },
  noRouteText: {
    fontSize: 11,
    color: '#6b7585',
    fontStyle: 'italic',
    marginBottom: 10,
  },
  notesText: {
    ...typography.caption,
    color: colors.textTertiary,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    fontStyle: 'italic',
  },
  emptyState: {
    padding: spacing.xxxxl + 12,
    alignItems: 'center',
  },
  emptyText: {
    ...typography.bodySm,
    color: colors.textTertiary,
  },
  // Chat button on trip cards
  chatRow: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  deleteBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtnText: {
    ...typography.labelSm,
    color: colors.error,
    letterSpacing: 1,
  },
  chatBtn: {
    position: 'relative',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.primaryDim,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  chatIcon: {
    fontSize: 18,
  },
  chatBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: colors.error,
    borderRadius: radius.full,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  chatBadgeText: {
    ...typography.labelSm,
    fontSize: 10,
    color: colors.textPrimary,
  },
  // Create form styles
  createContainer: {
    ...components.screen,
  },
  createHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: {
    padding: spacing.sm,
  },
  backText: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '600',
  },
  createTitle: {
    ...typography.h3,
    color: colors.textPrimary,
  },
  form: {
    padding: spacing.lg,
  },
  field: {
    marginBottom: spacing.xl,
  },
  label: {
    ...typography.captionSm,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: colors.textTertiary,
    marginBottom: spacing.sm - 2,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: spacing.md,
    ...typography.body,
    color: colors.textPrimary,
  },
  driverPill: {
    paddingHorizontal: spacing.lg - 2,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    marginRight: spacing.sm,
  },
  driverPillActive: {
    backgroundColor: colors.primaryDim,
    borderColor: colors.primary,
  },
  driverPillText: {
    ...typography.caption,
    fontWeight: '600',
    color: colors.textTertiary,
  },
  driverPillTextActive: {
    color: colors.primary,
  },
  segmentControl: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  segment: {
    flex: 1,
    paddingVertical: spacing.md,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  segmentActive: {
    backgroundColor: colors.primary,
  },
  segmentText: {
    ...typography.bodySm,
    fontWeight: '600',
    color: colors.textTertiary,
  },
  segmentTextActive: {
    color: colors.bg,
  },
  // Date/Time Picker Styles
  dateTimeRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  dateTimeButton: {
    flex: 1,
    backgroundColor: colors.primaryDim,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.sm,
    padding: spacing.md,
    alignItems: 'center',
  },
  dateTimeButtonText: {
    ...typography.body,
    fontWeight: '600',
    color: colors.primary,
  },
  errorText: {
    ...typography.caption,
    color: colors.error,
    marginBottom: spacing.md,
  },
  createSubmitBtn: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.lg - 2,
    borderRadius: radius.sm,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  createSubmitText: {
    ...typography.bodySm,
    fontWeight: '700',
    color: colors.bg,
    letterSpacing: 0.5,
  },
  disabled: {
    opacity: 0.5,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  modalContainer: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.md,
    padding: spacing.xl,
    maxWidth: 500,
    width: '100%',
    alignSelf: 'center',
  },
  modalTitle: {
    ...typography.h2,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  modalSubtitle: {
    ...typography.bodySm,
    color: colors.textTertiary,
    marginBottom: spacing.xl,
  },
  modalField: {
    marginBottom: spacing.lg,
  },
  modalLabel: {
    ...typography.captionSm,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: colors.textTertiary,
    marginBottom: spacing.sm - 2,
    textTransform: 'uppercase',
  },
  modalInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: radius.sm,
    padding: spacing.sm + 2,
    ...typography.body,
    color: colors.textPrimary,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: 2,
    marginRight: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: colors.error,
    borderColor: colors.error,
  },
  checkmark: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '700',
  },
  checkboxLabel: {
    ...typography.caption,
    color: colors.textPrimary,
  },
  modalError: {
    ...typography.caption,
    color: colors.error,
    marginTop: spacing.md,
  },
  modalActions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  modalBtnCancel: {
    flex: 1,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  modalBtnCancelText: {
    ...typography.bodySm,
    fontWeight: '600',
    color: colors.textTertiary,
  },
  modalBtnSave: {
    flex: 1,
    paddingVertical: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  modalBtnSaveText: {
    ...typography.bodySm,
    fontWeight: '700',
    color: colors.bg,
  },
  pickerDone: {
    alignSelf: 'center',
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.xxxl,
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  pickerDoneText: {
    ...typography.body,
    fontWeight: '700',
    color: colors.bg,
  },
  // Route map modal
  routeModalContainer: {
    flex: 1,
    backgroundColor: '#0d0f12',
  },
  routeModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 60,
    paddingBottom: 14,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1d24',
  },
  routeModalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#d4d8df',
  },
  routeModalSubtitle: {
    fontSize: 12,
    color: '#6b7585',
    marginTop: 2,
  },
  routeCloseBtn: {
    borderWidth: 1,
    borderColor: '#2a2d34',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 4,
  },
  routeCloseText: {
    fontSize: 10,
    color: '#f5a623',
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  routeMap: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
});