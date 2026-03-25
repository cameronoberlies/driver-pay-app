import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Modal,
  AppState,
  Platform,
} from "react-native";
import {
  SafeAreaProvider,
  useSafeAreaInsets,
  initialWindowMetrics,
} from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { supabase } from "./lib/supabase";
import { colors, spacing, radius, typography } from "./lib/theme";
import LoginScreen from "./screens/LoginScreen";
import DriverDashboard from "./screens/DriverDashboard";
import MyTripsScreen from "./screens/MyTripsScreen";
import AdminOverview from "./screens/AdminOverview";
import LogEntryScreen from "./screens/LogEntryScreen";
import AllEntriesScreen from "./screens/AllEntriesScreen";
import MileageCostsScreen from "./screens/MileageCostsScreen";
import AvailabilityScreen from "./screens/AvailabilityScreen";
import LiveDriversScreen from "./screens/LiveDriversScreen";
import DriverAvailabilityScreen from "./screens/DriverAvailabilityScreen";
import AdminTripsScreen from "./screens/AdminTripsScreen";
import AdminTrackingHealthScreen from "./screens/AdminTrackingHealthScreen";
import { GeofenceManager } from "./lib/GeofenceManager";
import { useUpdateChecker } from "./lib/AndroidUpdateChecker";
import * as Updates from "expo-updates";
import GeofenceActivityScreen from "./screens/GeofenceActivityScreen";
import LiveFlightsScreen from "./screens/LiveFlightsScreen";
import TripChatScreen from "./screens/TripChatScreen";

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
  { id: "trips", label: "Trips" },
  { id: "mileage", label: "Mileage Costs" },
  { id: "availability", label: "Availability" },
  { id: "live", label: "Live Drivers" },
  { id: "flights", label: "Live Flights" },
  { id: "tracking", label: "Tracking Health" },
  { id: "geofence", label: "Geofence Activity" },
];

const CALLER_HIDDEN_TABS = ["log"];

function AdminNav({ active, onSelect, onSignOut, userRole }) {
  const [open, setOpen] = useState(false);
  const tabs = userRole === "caller"
    ? ADMIN_TABS.filter((t) => !CALLER_HIDDEN_TABS.includes(t.id))
    : ADMIN_TABS;
  const activeLabel = tabs.find((t) => t.id === active)?.label ?? "";

  return (
    <>
      <View style={styles.adminBar}>
        <Text style={styles.adminBarTitle}>{activeLabel.toUpperCase()}</Text>
        <View style={styles.adminBarRight}>
          <TouchableOpacity onPress={onSignOut} style={styles.signOutBtn}>
            <Text style={styles.signOutText}>SIGN OUT</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setOpen(true)}
            style={styles.hamburger}
          >
            <View style={styles.line} />
            <View style={styles.line} />
            <View style={styles.line} />
          </TouchableOpacity>
        </View>
      </View>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <TouchableOpacity
          style={styles.overlay}
          activeOpacity={1}
          onPress={() => setOpen(false)}
        >
          <View style={styles.drawer}>
            <Text style={styles.drawerHeading}>MENU</Text>
            {tabs.map((t) => (
              <TouchableOpacity
                key={t.id}
                style={[
                  styles.drawerRow,
                  active === t.id && styles.drawerRowActive,
                ]}
                onPress={() => {
                  onSelect(t.id);
                  setOpen(false);
                }}
              >
                <Text
                  style={[
                    styles.drawerLabel,
                    active === t.id && styles.drawerLabelActive,
                  ]}
                >
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
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.tabBar, { paddingBottom: insets.bottom }]}>
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
  if (!Device.isDevice) {
    console.log("Push: skipped - not a device");
    return;
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  console.log("Push: existing permission status:", existing);
  let finalStatus = existing;

  if (existing !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    console.log("Push: permission not granted");
    return;
  }

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: "2fa6ed9e-334f-4d4e-83f4-753b40bf843b",
    });
    console.log("Push: token obtained:", tokenData.data);
    const token = tokenData.data;

    const { error } = await supabase
      .from("profiles")
      .update({ push_token: token })
      .eq("id", userId);
    console.log("Push: saved to Supabase, error:", error);

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
      });
    }
  } catch (e) {
    console.log("Push: error getting token:", e.message);
  }
}

export default function App() {
  const { updateAvailable } = useUpdateChecker();
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [chatTrip, setChatTrip] = useState(null);

  const appState = useRef(AppState.currentState);
  const notificationListener = useRef();
  const responseListener = useRef();

  const profileLoadedRef = useRef(false);

  async function loadProfile(s) {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", s.user.id)
        .single();
      if (error) {
        // Only sign out if profile has never loaded (first attempt)
        if (!profileLoadedRef.current) {
          await supabase.auth.signOut();
        }
        return;
      }
      if (data) {
        profileLoadedRef.current = true;
        setProfile(data);
        setActiveTab(prev => prev ?? (data?.role === "admin" || data?.role === "caller" ? "overview" : "dashboard"));
        registerForPushNotifications(s.user.id);
      }
    } catch (e) {
      console.log("loadProfile error:", e);
      // Don't sign out on network errors if already loaded
    }
  }

  // Check for OTA updates — download silently, apply on next launch
  useEffect(() => {
    async function checkForUpdates() {
      if (__DEV__) return;
      try {
        const update = await Updates.checkForUpdateAsync();
        if (update.isAvailable) {
          await Updates.fetchUpdateAsync();
          // Update applies automatically on next app launch — no reload loop
        }
      } catch (e) {
        console.log("Update check failed:", e);
      }
    }
    checkForUpdates();
  }, []);

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

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "INITIAL_SESSION") return;
      setSession(session);
      if (session) {
        // Only load profile if not already loaded (avoid re-trigger loops)
        if (!profileLoadedRef.current) {
          loadProfile(session);
        }
      } else {
        profileLoadedRef.current = false;
        setProfile(null);
        setActiveTab(null);
      }
    });

    const appStateSubscription = AppState.addEventListener(
      "change",
      async (nextAppState) => {
        if (
          appState.current.match(/inactive|background/) &&
          nextAppState === "active"
        ) {
          const {
            data: { session: currentSession },
          } = await supabase.auth.getSession();
          if (currentSession) {
            try {
              const { data } = await supabase.auth.refreshSession();
              if (data?.session) setSession(data.session);
            } catch (e) {
              console.log("Session refresh failed:", e);
            }
          }
        }
        appState.current = nextAppState;
      },
    );

    // Notification listeners
    notificationListener.current =
      Notifications.addNotificationReceivedListener((notification) => {
        console.log("Notification received:", notification);
      });

    responseListener.current =
      Notifications.addNotificationResponseReceivedListener(() => {
        // Handle geofence prompts or any driver notification — navigate to trips
        if (profile?.role === "driver") {
          setActiveTab("trips");
          setRefreshKey((k) => k + 1);
        }
      });

    return () => {
      subscription.unsubscribe();
      appStateSubscription.remove();
      if (notificationListener.current) {
        notificationListener.current.remove();
      }
      if (responseListener.current) {
        responseListener.current.remove();
      }
    };
  }, []);

  // Start/stop geofence monitoring based on profile role
  const geofenceStartedRef = useRef(false);
  useEffect(() => {
    if (profile?.role === "driver" && !geofenceStartedRef.current) {
      geofenceStartedRef.current = true;
      GeofenceManager.start().then(() => {
        setTimeout(async () => {
          const isActive = await GeofenceManager.isActive();
          console.log("🔍 Geofence registered:", isActive);
        }, 3000);
      });
    }
  }, [profile]);

  async function handleSignOut() {
    try {
      await supabase
        .from("driver_locations")
        .delete()
        .eq("driver_id", session.user.id);
      await GeofenceManager.stop();
      geofenceStartedRef.current = false;
    } finally {
      await supabase.auth.signOut();
    }
  }

  function handleTabSelect(tab) {
    setActiveTab(tab);
    setRefreshKey((k) => k + 1);
  }

  if (loading || (session && !activeTab))
    return (
      <View style={styles.loader}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );

  if (!session) return <LoginScreen />;

  const isAdmin = profile?.role === "admin" || profile?.role === "caller";

  function renderScreen() {
    if (isAdmin) {
      if (activeTab === "overview") return <AdminOverview key={refreshKey} />;
      if (activeTab === "log") return <LogEntryScreen key={refreshKey} userRole={profile?.role} />;
      if (activeTab === "entries") return <AllEntriesScreen key={refreshKey} userRole={profile?.role} />;
      if (activeTab === "mileage")
        return <MileageCostsScreen key={refreshKey} />;
      if (activeTab === "availability")
        return <AvailabilityScreen key={refreshKey} />;
      if (activeTab === "live") return <LiveDriversScreen key={refreshKey} />;
      if (activeTab === "trips") return <AdminTripsScreen key={refreshKey} session={session} userRole={profile?.role} />;
      if (activeTab === "tracking")
        return <AdminTrackingHealthScreen key={refreshKey} />;
      if (activeTab === "geofence")
        return <GeofenceActivityScreen key={refreshKey} />;
      if (activeTab === "flights")
        return <LiveFlightsScreen key={refreshKey} />;
    } else {
      if (activeTab === "dashboard")
        return <DriverDashboard key={refreshKey} session={session} />;
      if (activeTab === "trips")
        return <MyTripsScreen key={refreshKey} session={session} navigation={{ navigate: (screen, params) => { if (screen === 'TripChat') setChatTrip(params); } }} />;
      if (activeTab === "availability")
        return <DriverAvailabilityScreen key={refreshKey} session={session} />;
    }
    return null;
  }

  if (isAdmin) {
    return (
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <View style={styles.app}>
          <AdminNav
            active={activeTab}
            onSelect={handleTabSelect}
            onSignOut={handleSignOut}
            userRole={profile?.role}
          />
          <View style={styles.screen}>{renderScreen()}</View>
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <View style={styles.app}>
        {chatTrip ? (
          <TripChatScreen
            trip={chatTrip.trip}
            currentUser={chatTrip.currentUser}
            allProfiles={chatTrip.allProfiles}
            onClose={() => setChatTrip(null)}
          />
        ) : (
          <>
            <View style={styles.screen}>{renderScreen()}</View>
            <DriverTabBar active={activeTab} onSelect={handleTabSelect} />
          </>
        )}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: "center",
    alignItems: "center",
  },
  app: { flex: 1, backgroundColor: colors.bg },
  screen: { flex: 1 },
  adminBar: {
    paddingTop: 60,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  adminBarTitle: {
    ...typography.label,
    color: colors.textPrimary,
  },
  adminBarRight: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  signOutBtn: {
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  signOutText: {
    ...typography.labelSm,
    color: colors.textTertiary,
  },
  hamburger: { gap: spacing.xs, padding: spacing.xs },
  line: { width: 22, height: 2, backgroundColor: colors.primary },
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "flex-end",
  },
  drawer: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderRadius: radius.md,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xxxxl,
    paddingHorizontal: spacing.xxl,
  },
  drawerHeading: {
    ...typography.label,
    color: colors.textMuted,
    letterSpacing: 3,
    marginBottom: spacing.lg,
  },
  drawerRow: {
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  drawerRowActive: {},
  drawerLabel: { fontSize: 20, fontWeight: "700", color: colors.textTertiary },
  drawerLabelActive: { color: colors.primary },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
  tabBar: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  tab: { flex: 1, paddingVertical: spacing.lg, alignItems: "center" },
  tabActive: { borderTopWidth: 2, borderTopColor: colors.primary },
  tabText: {
    ...typography.labelSm,
    color: colors.textMuted,
  },
  tabTextActive: { color: colors.primary },
});
