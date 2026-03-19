import React, { useEffect, useState, useRef } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Modal, AppState, Platform
} from "react-native";
import { SafeAreaProvider, initialWindowMetrics } from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { supabase } from "./lib/supabase";
import LoginScreen from "./screens/LoginScreen";
import DriverDashboard from "./screens/DriverDashboard";
import MyTripsScreen from "./screens/MyTripsScreen";
import AdminOverview from "./screens/AdminOverview";
import LogEntryScreen from "./screens/LogEntryScreen";
import AllEntriesScreen from "./screens/AllEntriesScreen";
import MileageCostsScreen from "./screens/MileageCostsScreen";
import AvailabilityScreen from "./screens/AvailabilityScreen";
import LiveDriversScreen from "./screens/LiveDriversScreen";
import DriverAvailabilityScreen from './screens/DriverAvailabilityScreen';
import AdminTripsScreen from "./screens/AdminTripsScreen";
import AdminTrackingHealthScreen from "./screens/AdminTrackingHealthScreen";
import { GeofenceManager } from './lib/geofenceManager';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const ADMIN_TABS = [
  { id: "overview", label: "Overview" },
  { id: "log", label: "Log Entry" },
  { id: "entries", label: "All Entries" },
  { id: "mileage", label: "Mileage Costs" },
  { id: "availability", label: "Availability" },
  { id: "live", label: "Live Drivers" },
  { id: "trips", label: "Trips" },
  { id: "tracking", label: "Tracking Health" },
];

function AdminNav({ active, onSelect, onSignOut }) {
  const [open, setOpen] = useState(false);
  const activeLabel = ADMIN_TABS.find((t) => t.id === active)?.label ?? "";

  return (
    <>
      <View style={styles.adminBar}>
        <Text style={styles.adminBarTitle}>{activeLabel.toUpperCase()}</Text>
        <View style={styles.adminBarRight}>
          <TouchableOpacity onPress={onSignOut} style={styles.signOutBtn}>
            <Text style={styles.signOutText}>SIGN OUT</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setOpen(true)} style={styles.hamburger}>
            <View style={styles.line} />
            <View style={styles.line} />
            <View style={styles.line} />
          </TouchableOpacity>
        </View>
      </View>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={styles.drawer}>
            <Text style={styles.drawerHeading}>MENU</Text>
            {ADMIN_TABS.map((t) => (
              <TouchableOpacity
                key={t.id}
                style={[styles.drawerRow, active === t.id && styles.drawerRowActive]}
                onPress={() => { onSelect(t.id); setOpen(false); }}
              >
                <Text style={[styles.drawerLabel, active === t.id && styles.drawerLabelActive]}>
                  {t.label}
                </Text>
                {active === t.id && <View style={styles.dot} />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

function DriverTabBar({ active, onSelect }) {
  const bottomInset = Platform.OS === 'android' ? 48 : 0;
  return (
    <View style={[styles.tabBar, { paddingBottom: bottomInset }]}>
      {["dashboard", "trips", "availability"].map((t) => (
        <TouchableOpacity
          key={t}
          style={[styles.tab, active === t && styles.tabActive]}
          onPress={() => onSelect(t)}
        >
          <Text style={[styles.tabText, active === t && styles.tabTextActive]}>
            {t.toUpperCase()}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

async function registerForPushNotifications(userId) {
  if (!Device.isDevice) { console.log('Push: skipped - not a device'); return; }

  const { status: existing } = await Notifications.getPermissionsAsync();
  console.log('Push: existing permission status:', existing);
  let finalStatus = existing;

  if (existing !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") { console.log('Push: permission not granted'); return; }

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: "2fa6ed9e-334f-4d4e-83f4-753b40bf843b",
    });
    console.log('Push: token obtained:', tokenData.data);
    const token = tokenData.data;

    const { error } = await supabase
      .from("profiles")
      .update({ push_token: token })
      .eq("id", userId);
    console.log('Push: saved to Supabase, error:', error);

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
      });
    }
  } catch (e) {
    console.log('Push: error getting token:', e.message);
    
  }
}

export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const appState = useRef(AppState.currentState);
  const notificationListener = useRef();
  const responseListener = useRef();

  async function loadProfile(s) {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", s.user.id)
      .single();
    if (error) {
      await supabase.auth.signOut();
      return;
    }
    if (data) {
      setProfile(data);
      setActiveTab(data?.role === "admin" ? "overview" : "dashboard");
      // Register push token for drivers
      // Register push token
      registerForPushNotifications(s.user.id);
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      let s = session;
      if (s && s.expires_at * 1000 < Date.now()) {
        const { data } = await supabase.auth.refreshSession();
        s = data?.session ?? null;
      }
      setSession(s);
      if (s) await loadProfile(s);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "INITIAL_SESSION") return;
      setSession(session);
      if (session) {
        loadProfile(session);
      } else {
        setProfile(null);
        setActiveTab(null);
      }
    });

    const appStateSubscription = AppState.addEventListener("change", async (nextAppState) => {
      if (appState.current.match(/inactive|background/) && nextAppState === "active") {
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        if (currentSession) {
          setIsRefreshing(true);
          try {
            const { data } = await supabase.auth.refreshSession();
            if (data?.session) setSession(data.session);
          } finally {
            setIsRefreshing(false);
          }
        }
        setRefreshKey((k) => k + 1);
      }
      appState.current = nextAppState;
    });

    // Notification listeners
    notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
      console.log("Notification received:", notification);
    });

    responseListener.current = Notifications.addNotificationResponseReceivedListener(() => {
      // Handle geofence prompts or any driver notification — navigate to trips
      if (profile?.role === "driver") {
        setActiveTab("trips");
        setRefreshKey((k) => k + 1);
      }
    });

    return () => {
      subscription.unsubscribe();
      appStateSubscription.remove();
      Notifications.removeNotificationSubscription(notificationListener.current);
      Notifications.removeNotificationSubscription(responseListener.current);
    };
  }, []);

  // Start/stop geofence monitoring based on profile role
  useEffect(() => {
    if (profile?.role === 'driver') {
      GeofenceManager.start().then(() => {
        setTimeout(async () => {
          const isActive = await GeofenceManager.isActive();
          console.log('🔍 Geofence registered:', isActive);

          const distance = await GeofenceManager.getDistanceFromGeofence();
          console.log('🔍 Distance from home:', distance);
        }, 3000);
      });
    }
    return () => {
      GeofenceManager.stop();
    };
  }, [profile]);

  async function handleSignOut() {
    try {
      await supabase.from("driver_locations").delete().eq("driver_id", session.user.id);
      await GeofenceManager.stop();
    } finally {
      await supabase.auth.signOut();
    }
  }

  function handleTabSelect(tab) {
    setActiveTab(tab);
    setRefreshKey((k) => k + 1);
  }

  if (loading)
    return (
      <View style={styles.loader}>
        <ActivityIndicator color="#f5a623" size="large" />
      </View>
    );

  if (!session) return <LoginScreen />;

  const isAdmin = profile?.role === "admin";

  function renderScreen() {
    if (isRefreshing) return <View style={styles.loader}><ActivityIndicator color="#f5a623" size="large" /></View>;
    if (isAdmin) {
      if (activeTab === "overview") return <AdminOverview key={refreshKey} />;
      if (activeTab === "log") return <LogEntryScreen key={refreshKey} />;
      if (activeTab === "entries") return <AllEntriesScreen key={refreshKey} />;
      if (activeTab === "mileage") return <MileageCostsScreen key={refreshKey} />;
      if (activeTab === "availability") return <AvailabilityScreen key={refreshKey} />;
      if (activeTab === "live") return <LiveDriversScreen key={refreshKey} />;
      if (activeTab === "trips") return <AdminTripsScreen key={refreshKey} />;
      if (activeTab === "tracking") return <AdminTrackingHealthScreen key={refreshKey} />;
    } else {
      if (activeTab === "dashboard") return <DriverDashboard key={refreshKey} session={session} />;
      if (activeTab === "trips") return <MyTripsScreen key={refreshKey} session={session} />;
      if (activeTab === 'availability') return <DriverAvailabilityScreen key={refreshKey} session={session} />;
    }
    return null;
  }

  if (isAdmin) {
    return (
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <View style={styles.app}>
          <AdminNav active={activeTab} onSelect={handleTabSelect} onSignOut={handleSignOut} />
          <View style={styles.screen}>{renderScreen()}</View>
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <View style={styles.app}>
        <View style={styles.screen}>{renderScreen()}</View>
        <DriverTabBar active={activeTab} onSelect={handleTabSelect} />
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loader: { flex: 1, backgroundColor: "#0a0a0a", justifyContent: "center", alignItems: "center" },
  app: { flex: 1, backgroundColor: "#0a0a0a" },
  screen: { flex: 1 },
  adminBar: {
    paddingTop: 60, paddingBottom: 14, paddingHorizontal: 20,
    backgroundColor: "#0a0a0a", borderBottomWidth: 1, borderBottomColor: "#1a1a1a",
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
  },
  adminBarTitle: { fontSize: 16, fontWeight: "900", color: "#fff", letterSpacing: 2 },
  adminBarRight: { flexDirection: "row", alignItems: "center", gap: 14 },
  signOutBtn: { borderWidth: 1, borderColor: "#2a2a2a", paddingHorizontal: 10, paddingVertical: 5 },
  signOutText: { fontSize: 9, color: "#555", letterSpacing: 1.5, fontWeight: "700" },
  hamburger: { gap: 5, padding: 4 },
  line: { width: 22, height: 2, backgroundColor: "#f5a623" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "flex-end" },
  drawer: {
    backgroundColor: "#111", borderTopWidth: 1, borderTopColor: "#222",
    paddingTop: 28, paddingBottom: 52, paddingHorizontal: 28,
  },
  drawerHeading: { fontSize: 10, color: "#444", letterSpacing: 3, fontWeight: "700", marginBottom: 16 },
  drawerRow: {
    paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: "#1a1a1a",
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
  },
  drawerRowActive: {},
  drawerLabel: { fontSize: 20, fontWeight: "700", color: "#555" },
  drawerLabelActive: { color: "#f5a623" },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#f5a623" },
  tabBar: { flexDirection: "row", borderTopWidth: 1, borderTopColor: "#1a1a1a", backgroundColor: "#0a0a0a" },
  tab: { flex: 1, paddingVertical: 16, alignItems: "center" },
  tabActive: { borderTopWidth: 2, borderTopColor: "#f5a623" },
  tabText: { fontSize: 11, color: "#444", letterSpacing: 2, fontWeight: "700" },
  tabTextActive: { color: "#f5a623" },
});