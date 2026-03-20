import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  Linking,
  RefreshControl,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { supabase } from '../lib/supabase';

export default function DriverPhoneBookModal({ visible, onClose }) {
  const [drivers, setDrivers] = useState([]);
  const [filteredDrivers, setFilteredDrivers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (visible) {
      loadDrivers();
    }
  }, [visible]);

  useEffect(() => {
    filterDrivers();
  }, [searchQuery, drivers]);

  async function loadDrivers() {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, name, phone_number')
        .eq('role', 'driver')
        .order('name');

      if (error) throw error;
      setDrivers(data || []);
    } catch (error) {
      console.error('Error loading drivers:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  function filterDrivers() {
    if (!searchQuery.trim()) {
      setFilteredDrivers(drivers);
      return;
    }

    const filtered = drivers.filter((driver) =>
      driver.name?.toLowerCase().includes(searchQuery.toLowerCase())
    );
    setFilteredDrivers(filtered);
  }

  function handleCallDriver(phoneNumber) {
    if (!phoneNumber) return;
    
    // Remove any formatting and just keep digits
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    Linking.openURL(`tel:${cleanPhone}`);
  }

  function formatPhoneNumber(phone) {
    if (!phone) return null;
    
    // Remove all non-digits
    const cleaned = phone.replace(/\D/g, '');
    
    // Format as (XXX) XXX-XXXX
    if (cleaned.length === 10) {
      return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    }
    
    // Return as-is if not 10 digits
    return phone;
  }

  function renderDriver({ item }) {
    const hasPhone = !!item.phone_number;

    return (
      <TouchableOpacity
        style={styles.driverCard}
        onPress={() => handleCallDriver(item.phone_number)}
        disabled={!hasPhone}
        activeOpacity={hasPhone ? 0.7 : 1}
      >
        <View style={styles.driverInfo}>
          <Text style={styles.driverName}>{item.name}</Text>
          {hasPhone ? (
            <TouchableOpacity
              onPress={() => handleCallDriver(item.phone_number)}
              style={styles.phoneButton}
            >
              <Text style={styles.phoneIcon}>📞</Text>
              <Text style={styles.phoneNumber}>
                {formatPhoneNumber(item.phone_number)}
              </Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.noPhone}>No phone number</Text>
          )}
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>DRIVER DIRECTORY</Text>
              <Text style={styles.subtitle}>{drivers.length} drivers</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Search Bar */}
          <View style={styles.searchContainer}>
            <Text style={styles.searchIcon}>🔍</Text>
            <TextInput
              style={styles.searchInput}
              placeholder="Search by name..."
              placeholderTextColor="#555"
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="words"
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity
                onPress={() => setSearchQuery('')}
                style={styles.clearButton}
              >
                <Text style={styles.clearIcon}>✕</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Driver List */}
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#f5a623" />
              <Text style={styles.loadingText}>Loading drivers...</Text>
            </View>
          ) : (
            <FlatList
              data={filteredDrivers}
              renderItem={renderDriver}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={() => {
                    setRefreshing(true);
                    loadDrivers();
                  }}
                  tintColor="#f5a623"
                />
              }
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyIcon}>📭</Text>
                  <Text style={styles.emptyText}>
                    {searchQuery ? 'No drivers found' : 'No drivers yet'}
                  </Text>
                </View>
              }
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#0a0a0a',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  title: {
    fontSize: 24,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 13,
    color: '#888',
    marginTop: 4,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    fontSize: 20,
    color: '#888',
    fontWeight: '700',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111',
    margin: 16,
    marginBottom: 8,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1a1a1a',
  },
  searchIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    height: 48,
    fontSize: 15,
    color: '#fff',
  },
  clearButton: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#1a1a1a',
  },
  clearIcon: {
    fontSize: 12,
    color: '#888',
  },
  listContent: {
    padding: 16,
    paddingTop: 8,
    paddingBottom: 32,
  },
  driverCard: {
    backgroundColor: '#111',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1a1a1a',
  },
  driverInfo: {
    gap: 8,
  },
  driverName: {
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 4,
  },
  phoneButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0a0a0a',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    alignSelf: 'flex-start',
  },
  phoneIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  phoneNumber: {
    fontSize: 15,
    fontWeight: '600',
    color: '#f5a623',
    letterSpacing: 0.3,
  },
  noPhone: {
    fontSize: 13,
    color: '#555',
    fontStyle: 'italic',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 48,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 14,
    color: '#888',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 48,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 15,
    color: '#888',
  },
});