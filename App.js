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

function TabBar({ active, onSelect }) {
  return (
    <View style={styles.tabBar}>
      <TouchableOpacity
        style={[styles.tab, active === 'dashboard' && styles.tabActive]}
        onPress={() => onSelect('dashboard')}
      >
        <Text style={[styles.tabText, active === 'dashboard' && styles.tabTextActive]}>
          DASHBOARD
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.tab, active === 'drive' && styles.tabActive]}
        onPress={() => onSelect('drive')}
      >
        <Text style={[styles.tabText, active === 'drive' && styles.tabTextActive]}>
          DRIVE
        </Text>
      </TouchableOpacity>
    </View>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
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

  return (
    <View style={styles.appContainer}>
      <View style={styles.screen}>
        {activeTab === 'dashboard'
          ? <DriverDashboard session={session} />
          : <DriveScreen session={session} />
        }
      </View>
      <TabBar active={activeTab} onSelect={setActiveTab} />
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