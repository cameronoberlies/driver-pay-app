import React, { useEffect, useState, useRef } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Modal, AppState,
} from "react-native";
import { supabase } from "./lib/supabase";
import LoginScreen from "./screens/LoginScreen";
import DriverDashboard from "./screens/DriverDashboard";
import DriveScreen from "./screens/DriveScreen";
import AdminOverview from "./screens/AdminOverview";
import LogEntryScreen from "./screens/LogEntryScreen";
import AllEntriesScreen from "./screens/AllEntriesScreen";
import MileageCostsScreen from "./screens/MileageCostsScreen";
import AvailabilityScreen from "./screens/AvailabilityScreen";
import LiveDriversScreen from "./screens/LiveDriversScreen";

const ADMIN_TABS = [
  { id: "overview", label: "Overview" },
  { id: "log", label: "Log Entry" },
  { id: "entries", label: "All Entries" },
  { id: "mileage", label: "Mileage Costs" },
  { id: "availability", label: "Availability" },
  { id: "live", label: "Live Drivers" },
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
  return (
    <View style={styles.tabBar}>
      {["dashboard", "drive"].map((t) => (
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

export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const appState = useRef(AppState.currentState);

  async function loadProfile(s) {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", s.user.id)
      .single();
    if (data) {
      setProfile(data);
      setActiveTab(data?.role === "admin" ? "overview" : "dashboard");
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      if (session) await loadProfile(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session);
      if (session) await loadProfile(session);
      else { setProfile(null); setActiveTab(null); }
    });

    const appStateSubscription = AppState.addEventListener("change", (nextAppState) => {
      if (appState.current.match(/inactive|background/) && nextAppState === "active") {
        setRefreshKey((k) => k + 1);
      }
      appState.current = nextAppState;
    });

    return () => {
      subscription.unsubscribe();
      appStateSubscription.remove();
    };
  }, []);

  async function handleSignOut() {
    await supabase.from("driver_locations").delete().eq("driver_id", session.user.id);
    await supabase.auth.signOut();
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
    if (isAdmin) {
      if (activeTab === "overview") return <AdminOverview key={refreshKey} session={session} />;
      if (activeTab === "log") return <LogEntryScreen key={refreshKey} session={session} />;
      if (activeTab === "entries") return <AllEntriesScreen key={refreshKey} session={session} />;
      if (activeTab === "mileage") return <MileageCostsScreen key={refreshKey} session={session} />;
      if (activeTab === "availability") return <AvailabilityScreen key={refreshKey} session={session} />;
      if (activeTab === "live") return <LiveDriversScreen key={refreshKey} session={session} />;
    } else {
      if (activeTab === "dashboard") return <DriverDashboard key={refreshKey} session={session} />;
      if (activeTab === "drive") return <DriveScreen session={session} />;
    }
    return null;
  }

  if (isAdmin) {
    return (
      <View style={styles.app}>
        <AdminNav active={activeTab} onSelect={handleTabSelect} onSignOut={handleSignOut} />
        <View style={styles.screen}>{renderScreen()}</View>
      </View>
    );
  }

  return (
    <View style={styles.app}>
      <View style={styles.screen}>{renderScreen()}</View>
      <DriverTabBar active={activeTab} onSelect={handleTabSelect} />
    </View>
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