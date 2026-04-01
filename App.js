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
import { installErrorHandlers, logEvent } from "./lib/systemLog";

installErrorHandlers();
import * as Updates from "expo-updates";
import GeofenceActivityScreen from "./screens/GeofenceActivityScreen";
import LiveFlightsScreen from "./screens/LiveFlightsScreen";
import TripChatScreen from "./screens/TripChatScreen";
import HomeScreen from "./screens/HomeScreen";
import ManageUsersModal from "./screens/ManageUsersModal";

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
  { id: "flights", label: "Live Flights" },
  { id: "tracking", label: "Tracking Health" },
  { id: "geofence", label: "Geofence Activity" },
];

const CALLER_HIDDEN_TABS = ["log"];

// Bottom tab labels mapping
const BOTTOM_TAB_LABELS = {
  home: "HOME",
  trips: "TRIPS",
  live: "LIVE DRIVERS",
};

function AdminNav({ active, onSelect, onSignOut, userRole }) {
  const [open, setOpen] = useState(false);
  const tabs = userRole === "caller"
    ? ADMIN_TABS.filter((t) => !CALLER_HIDDEN_TABS.includes(t.id))
    : ADMIN_TABS;

  // Determine label: bottom tab takes priority, fallback to hamburger menu
  const activeLabel = BOTTOM_TAB_LABELS[active] || tabs.find((t) => t.id === active)?.label?.toUpperCase() || "";

  return (
    <>
      <View style={styles.adminBar}>
        <Text style={styles.adminBarTitle}>{activeLabel}</Text>
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

function AdminBottomTabs({ active, onSelect }) {
  const insets = useSafeAreaInsets();
  const tabs = [
    { id: "home", label: "Home", icon: "🏠" },
    { id: "trips", label: "Trips", icon: "🚗" },
    { id: "live", label: "Live", icon: "📍" },
  ];

  return (
    <View style={[styles.adminTabBar, { paddingBottom: insets.bottom }]}>
      {tabs.map((tab) => (
        <TouchableOpacity
          key={tab.id}
          style={[styles.adminTab, active === tab.id && styles.adminTabActive]}
          onPress={() => onSelect(tab.id)}
        >
          <Text style={styles.adminTabIcon}>{tab.icon}</Text>
          <Text style={[styles.adminTabText, active === tab.id && styles.adminTabTextActive]}>
            {tab.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
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

    let updateId = null;
    try {
      if (!__DEV__) {
        // Try to get the message from the manifest, fall back to createdAt, then updateId
        const message = Updates.manifest?.extra?.expoGo?.updateMessage
          || Updates.manifest?.message;
        const createdAt = Updates.createdAt?.toISOString?.() || null;
        updateId = message || createdAt || Updates.updateId || null;
      }
    } catch {}

    const { error } = await supabase
      .from("profiles")
      .update({ push_token: token, device_os: Platform.OS, app_update_id: updateId })
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
  const [showUpdateToast, setShowUpdateToast] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [chatTrip, setChatTrip] = useState(null);
  const [showManageUsers, setShowManageUsers] = useState(false);

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
        if (!profileLoadedRef.current) {
          await supabase.auth.signOut();
        }
        return;
      }
      if (data) {
        profileLoadedRef.current = true;
        setProfile(data);
        // Default to "home" for admin/caller, "dashboard" for driver
        setActiveTab(prev => prev ?? (data?.role === "admin" || data?.role === "caller" ? "home" : "dashboard"));
        registerForPushNotifications(s.user.id);
      }
    } catch (e) {
      console.log("loadProfile error:", e);
    }
  }

  const pendingUpdateRef = useRef(false);

  async function applyUpdate() {
    setShowUpdateToast(true);
    setTimeout(() => Updates.reloadAsync(), 1500);
  }

  useEffect(() => {
    async function checkForUpdates() {
      if (__DEV__) return;
      try {
        const update = await Updates.checkForUpdateAsync();
        if (update.isAvailable) {
          await Updates.fetchUpdateAsync();
          pendingUpdateRef.current = true;
          // Apply immediately if no active trip
          const AsyncStorageCheck = require('@react-native-async-storage/async-storage').default;
          const activeTrip = await AsyncStorageCheck.getItem('activeTrip');
          if (!activeTrip) {
            applyUpdate();
          }
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

            // Apply pending update if no active trip
            if (pendingUpdateRef.current) {
              try {
                const AsyncStorageCheck = require('@react-native-async-storage/async-storage').default;
                const activeTrip = await AsyncStorageCheck.getItem('activeTrip');
                if (!activeTrip) {
                  applyUpdate();
                }
              } catch {}
            }

            // Re-register geofence if iOS killed it while backgrounded
            const geofenceActive = await GeofenceManager.isActive();
            if (!geofenceActive && geofenceStartedRef.current) {
              console.log("[Geofence] Re-registering after iOS suspension");
              const restarted = await GeofenceManager.start();
              logEvent(
                restarted ? 'info' : 'warn',
                'geofence_re_registered',
                `Geofence re-registration ${restarted ? 'succeeded' : 'failed'} after foreground resume`,
                { device_os: Platform.OS }
              );
            }
          }
        }
        appState.current = nextAppState;
      },
    );

    notificationListener.current =
      Notifications.addNotificationReceivedListener((notification) => {
        console.log("Notification received:", notification);
      });

    responseListener.current =
      Notifications.addNotificationResponseReceivedListener(() => {
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

  const geofenceStartedRef = useRef(false);
  useEffect(() => {
    if (profile?.role === "driver" && !geofenceStartedRef.current) {
      geofenceStartedRef.current = true;
      GeofenceManager.start().then((success) => {
        logEvent(
          success ? 'info' : 'warn',
          success ? 'geofence_registered' : 'geofence_registration_failed',
          `Geofence ${success ? 'registered' : 'failed'} for ${profile.name}`,
          { driver_id: session?.user?.id, device_os: Platform.OS }
        );
        setTimeout(async () => {
          const isActive = await GeofenceManager.isActive();
          console.log("🔍 Geofence registered:", isActive);
          if (!isActive && success) {
            logEvent('warn', 'geofence_inactive_after_start',
              `Geofence reported inactive 3s after successful start for ${profile.name}`,
              { driver_id: session?.user?.id }
            );
          }
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
      // Bottom tabs
      if (activeTab === "home") return <HomeScreen key={refreshKey} onManageUsers={() => setShowManageUsers(true)} />;
      if (activeTab === "trips") return <AdminTripsScreen key={refreshKey} session={session} userRole={profile?.role} />;
      if (activeTab === "live") return <LiveDriversScreen key={refreshKey} />;
      
      // Hamburger menu screens
      if (activeTab === "overview") return <AdminOverview key={refreshKey} />;
      if (activeTab === "log") return <LogEntryScreen key={refreshKey} userRole={profile?.role} />;
      if (activeTab === "entries") return <AllEntriesScreen key={refreshKey} userRole={profile?.role} />;
      if (activeTab === "mileage") return <MileageCostsScreen key={refreshKey} />;
      if (activeTab === "availability") return <AvailabilityScreen key={refreshKey} />;
      if (activeTab === "tracking") return <AdminTrackingHealthScreen key={refreshKey} />;
      if (activeTab === "geofence") return <GeofenceActivityScreen key={refreshKey} />;
      if (activeTab === "flights") return <LiveFlightsScreen key={refreshKey} />;
    } else {
      if (activeTab === "dashboard") return <DriverDashboard key={refreshKey} session={session} />;
      if (activeTab === "trips")
        return <MyTripsScreen key={refreshKey} session={session} navigation={{ navigate: (screen, params) => { if (screen === 'TripChat') setChatTrip(params); } }} />;
      if (activeTab === "availability") return <DriverAvailabilityScreen key={refreshKey} session={session} />;
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
          <AdminBottomTabs active={activeTab} onSelect={handleTabSelect} />
          <ManageUsersModal
            visible={showManageUsers}
            onClose={() => setShowManageUsers(false)}
            session={session}
          />
          {showUpdateToast && (
            <View style={styles.updateToast}>
              <Text style={styles.updateToastText}>Applying update...</Text>
            </View>
          )}
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
        {showUpdateToast && (
          <View style={styles.updateToast}>
            <Text style={styles.updateToastText}>Applying update...</Text>
          </View>
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
  updateToast: {
    position: "absolute",
    bottom: 100,
    left: 20,
    right: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    alignItems: "center",
  },
  updateToastText: {
    ...typography.bodySm,
    color: colors.primary,
    fontWeight: "600",
  },
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
    fontSize: 20,
    fontWeight: "800",
    color: colors.textPrimary,
    letterSpacing: 0.5,
  },
  adminBarRight: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  signOutBtn: {
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
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
  
  // Admin bottom tabs
  adminTabBar: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  adminTab: {
    flex: 1,
    paddingVertical: spacing.md,
    alignItems: "center",
    gap: spacing.xs,
  },
  adminTabActive: {
    borderTopWidth: 2,
    borderTopColor: colors.primary,
  },
  adminTabIcon: {
    fontSize: 20,
  },
  adminTabText: {
    ...typography.labelSm,
    fontSize: 11,
    color: colors.textMuted,
  },
  adminTabTextActive: {
    color: colors.primary,
  },

  // Driver bottom tabs (unchanged)
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