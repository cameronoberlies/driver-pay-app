import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { supabase } from './lib/supabase';
import LoginScreen from './screens/LoginScreen';
import DriverDashboard from './screens/DriverDashboard';
import DriveScreen from './screens/DriveScreen';
import AdminOverview from './screens/AdminOverview';
import LogEntryScreen from './screens/LogEntryScreen';
import AllEntriesScreen from './screens/AllEntriesScreen';

const DRIVER_TABS = ['dashboard', 'drive'];
const ADMIN_TABS = ['overview', 'drive', 'log', 'entries'];

const TAB_LABELS = {
  dashboard: 'DASHBOARD',
  drive: 'DRIVE',
  overview: 'OVERVIEW',
  log: 'LOG',
  entries: 'ENTRIES',
};

function TabBar({ active, onSelect, role }) {
  const tabs = role === 'admin' ? ADMIN_TABS : DRIVER_TABS;
  return (
    <View style={styles.tabBar}>
      {tabs.map(t => (
        <TouchableOpacity
          key={t}
          style={[styles.tab, active === t && styles.tabActive]}
          onPress={() => onSelect(t)}
        >
          <Text style={[styles.tabText, active === t && styles.tabTextActive]}>
            {TAB_LABELS[t]}
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

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      if (session) {
        const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
        setProfile(data);
        setActiveTab(data?.role === 'admin' ? 'overview' : 'dashboard');
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session);
      if (session) {
        const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
        setProfile(data);
        setActiveTab(data?.role === 'admin' ? 'overview' : 'dashboard');
      } else {
        setProfile(null);
        setActiveTab(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#f5a623" size="large" />
      </View>
    );
  }

  if (!session) return <LoginScreen />;

  function renderScreen() {
    if (profile?.role === 'admin') {
      if (activeTab === 'overview') return <AdminOverview session={session} profile={profile} />;
      if (activeTab === 'drive') return <DriveScreen session={session} />;
      if (activeTab === 'log') return <LogEntryScreen session={session} profile={profile} />;
      if (activeTab === 'entries') return <AllEntriesScreen session={session} profile={profile} />;
    } else {
      if (activeTab === 'dashboard') return <DriverDashboard session={session} />;
      if (activeTab === 'drive') return <DriveScreen session={session} />;
    }
    return null;
  }

  return (
    <View style={styles.appContainer}>
      <View style={styles.screen}>
        {renderScreen()}
      </View>
      <TabBar active={activeTab} onSelect={setActiveTab} role={profile?.role} />
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center' },
  appContainer: { flex: 1, backgroundColor: '#0a0a0a' },
  screen: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
    backgroundColor: '#0a0a0a',
  },
  tab: {
    flex: 1,
    paddingVertical: 16,
    alignItems: 'center',
  },
  tabActive: {
    borderTopWidth: 2,
    borderTopColor: '#f5a623',
  },
  tabText: { fontSize: 11, color: '#444', letterSpacing: 2, fontWeight: '700' },
  tabTextActive: { color: '#f5a623' },
});