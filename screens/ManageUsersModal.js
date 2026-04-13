import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Switch,
  Modal,
  Image,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';
import { colors, spacing, radius, typography, components } from '../lib/theme';

const EMPTY_FORM = {
  name: '',
  email: '',
  password: '',
  role: 'driver',
  phone_number: '',
  date_of_birth: '',
  can_drive_manual: false,
  willing_to_fly: false,
  drivers_license_number: '',
  hourly_wage: '',
};

export default function ManageUsersModal({ visible, onClose, session, userRole }) {
  const canSeePay = userRole === 'admin';
  const [view, setView] = useState('list'); // list | add | detail | broadcast
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [licenseImage, setLicenseImage] = useState(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [broadcastTarget, setBroadcastTarget] = useState('drivers');
  const [broadcasting, setBroadcasting] = useState(false);

  useEffect(() => {
    if (visible) {
      loadProfiles();
      setView('list');
      setSelectedUser(null);
    }
  }, [visible]);

  async function loadProfiles() {
    setLoading(true);
    const { data } = await supabase.from('profiles').select('*').order('name');
    setProfiles(data || []);
    setLoading(false);
  }

  // ── CREATE USER ──

  async function handleCreate() {
    if (!form.name || !form.email || !form.password) {
      Alert.alert('Missing Fields', 'Name, email, and password are required.');
      return;
    }
    if (form.password.length < 6) {
      Alert.alert('Weak Password', 'Password must be at least 6 characters.');
      return;
    }
    setSaving(true);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      Alert.alert('Session Expired', 'Please sign out and log in again.');
      setSaving(false);
      return;
    }

    try {
      const response = await fetch(
        'https://yincjogkjvotupzgetqg.supabase.co/functions/v1/manage-users',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpbmNqb2dranZvdHVwemdldHFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5MTc2MTAsImV4cCI6MjA4ODQ5MzYxMH0._gxry5gqeBUFRz8la2IeHW8if1M1IdAHACMKUWy1las',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            action: 'create',
            name: form.name,
            email: form.email,
            password: form.password,
            role: form.role,
          }),
        }
      );

      const result = await response.json();
      if (!response.ok) {
        Alert.alert('Error', result.error || 'Failed to create user');
        setSaving(false);
        return;
      }

      const newUserId = result.userId;

      // Upload license photo if selected
      let licensePhotoUrl = null;
      if (licenseImage && newUserId) {
        const ext = licenseImage.uri.split('.').pop() || 'jpg';
        const fileName = `${newUserId}/license.${ext}`;
        const photo = await fetch(licenseImage.uri);
        const blob = await photo.blob();

        const { error: uploadError } = await supabase.storage
          .from('driver-licenses')
          .upload(fileName, blob, { cacheControl: '3600', upsert: true, contentType: `image/${ext}` });

        if (!uploadError) {
          const { data: { publicUrl } } = supabase.storage
            .from('driver-licenses')
            .getPublicUrl(fileName);
          licensePhotoUrl = publicUrl;
        }
      }

      // Update profile with additional fields
      await supabase
        .from('profiles')
        .update({
          phone_number: form.phone_number || null,
          date_of_birth: form.date_of_birth || null,
          can_drive_manual: form.can_drive_manual,
          willing_to_fly: form.willing_to_fly,
          drivers_license_number: form.drivers_license_number || null,
          hourly_wage: form.hourly_wage ? Number(form.hourly_wage) : null,
          ...(licensePhotoUrl && { drivers_license_photo_url: licensePhotoUrl }),
        })
        .eq('id', newUserId);

      setForm(EMPTY_FORM);
      setLicenseImage(null);
      await loadProfiles();
      setView('list');
      Alert.alert('Success', `${form.name} has been created.`);
    } catch (e) {
      Alert.alert('Error', e.message || 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  // ── DELETE USER ──

  async function handleDelete(user) {
    Alert.alert(
      'Delete User',
      `Delete ${user.name}? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
              Alert.alert('Session Expired', 'Please sign out and log in again.');
              return;
            }

            if (user.drivers_license_photo_url) {
              const ext = user.drivers_license_photo_url.split('.').pop();
              await supabase.storage
                .from('driver-licenses')
                .remove([`${user.id}/license.${ext}`]);
            }

            const response = await fetch(
              'https://yincjogkjvotupzgetqg.supabase.co/functions/v1/manage-users',
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${session.access_token}`,
                  apikey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpbmNqb2dranZvdHVwemdldHFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5MTc2MTAsImV4cCI6MjA4ODQ5MzYxMH0._gxry5gqeBUFRz8la2IeHW8if1M1IdAHACMKUWy1las',
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ action: 'delete', userId: user.id }),
              }
            );

            if (!response.ok) {
              const result = await response.json();
              Alert.alert('Error', result.error || 'Failed to delete user');
              return;
            }

            await loadProfiles();
            setView('list');
            setSelectedUser(null);
          },
        },
      ]
    );
  }

  // ── EDIT USER ──

  async function handleSaveEdit() {
    setSaving(true);
    try {
      const updates = {
        phone_number: editForm.phone_number || null,
        can_drive_manual: editForm.can_drive_manual ?? false,
        willing_to_fly: editForm.willing_to_fly ?? false,
        drivers_license_number: editForm.drivers_license_number || null,
        hourly_wage: editForm.hourly_wage ? Number(editForm.hourly_wage) : null,
      };

      // Upload new license photo if picked
      if (editForm.newLicenseImage) {
        const ext = editForm.newLicenseImage.uri.split('.').pop() || 'jpg';
        const fileName = `${selectedUser.id}/license.${ext}`;
        const photo = await fetch(editForm.newLicenseImage.uri);
        const blob = await photo.blob();

        const { error: uploadError } = await supabase.storage
          .from('driver-licenses')
          .upload(fileName, blob, { cacheControl: '3600', upsert: true, contentType: `image/${ext}` });

        if (!uploadError) {
          const { data: { publicUrl } } = supabase.storage
            .from('driver-licenses')
            .getPublicUrl(fileName);
          updates.drivers_license_photo_url = publicUrl;
        }
      }

      const { error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', selectedUser.id);

      if (error) {
        Alert.alert('Error', error.message);
      } else {
        await loadProfiles();
        const { data } = await supabase.from('profiles').select('*').eq('id', selectedUser.id).single();
        if (data) setSelectedUser(data);
        setEditing(false);
      }
    } catch (e) {
      Alert.alert('Error', e.message || 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  // ── BROADCAST ──

  async function handleBroadcast() {
    if (!broadcastMessage.trim()) {
      Alert.alert('Empty Message', 'Please enter a message to broadcast.');
      return;
    }
    setBroadcasting(true);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      Alert.alert('Session Expired', 'Please sign out and log in again.');
      setBroadcasting(false);
      return;
    }

    try {
      const { data: { session: freshSession } } = await supabase.auth.getSession();
      if (!freshSession) {
        Alert.alert('Session Expired', 'Please sign out and log in again.');
        setBroadcasting(false);
        return;
      }

      const response = await fetch(
        'https://yincjogkjvotupzgetqg.supabase.co/functions/v1/notify-broadcast',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${freshSession.access_token}`,
            apikey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpbmNqb2dranZvdHVwemdldHFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5MTc2MTAsImV4cCI6MjA4ODQ5MzYxMH0._gxry5gqeBUFRz8la2IeHW8if1M1IdAHACMKUWy1las',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: broadcastMessage.trim(),
            target: broadcastTarget,
            sender_id: freshSession.user.id,
          }),
        }
      );

      const text = await response.text();
      console.log('Broadcast response:', response.status, text);
      let result;
      try { result = JSON.parse(text); } catch { result = { error: text }; }

      if (!response.ok) {
        Alert.alert('Error', `${response.status}: ${result.error || text}`);
      } else {
        const count = result.sent || 0;
        Alert.alert('Sent', `Broadcast sent to ${count} ${count === 1 ? 'recipient' : 'recipients'}.`);
        setBroadcastMessage('');
        setView('list');
      }
    } catch (e) {
      Alert.alert('Error', e.message || 'Something went wrong');
    } finally {
      setBroadcasting(false);
    }
  }

  async function pickImage(onPick) {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Photo library access is needed.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.6,
      allowsEditing: true,
    });
    if (!result.canceled && result.assets?.[0]) {
      onPick(result.assets[0]);
    }
  }

  // ── ROLE PILL ──

  function RolePill({ role }) {
    const isAdmin = role === 'admin';
    const isCaller = role === 'caller';
    const color = isAdmin ? colors.primary : isCaller ? colors.info : colors.textTertiary;
    return (
      <View style={[s.rolePill, { borderColor: color, backgroundColor: color + '15' }]}>
        <Text style={[s.rolePillText, { color }]}>
          {role?.toUpperCase()}
        </Text>
      </View>
    );
  }

  // ── LIST VIEW ──

  function renderList() {
    if (loading) {
      return (
        <View style={s.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      );
    }

    const drivers = profiles.filter((p) => p.role === 'driver');
    const admins = profiles.filter((p) => p.role !== 'driver');

    return (
      <ScrollView style={s.scrollArea} contentContainerStyle={s.scrollContent}>
        {canSeePay && (
          <TouchableOpacity
            style={s.createBtn}
            onPress={() => {
              setForm(EMPTY_FORM);
              setLicenseImage(null);
              setView('add');
            }}
          >
            <Text style={s.createBtnText}>+ CREATE USER</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={s.broadcastBtn}
          onPress={() => {
            setBroadcastMessage('');
            setBroadcastTarget('drivers');
            setView('broadcast');
          }}
        >
          <Text style={s.broadcastBtnText}>📢 BROADCAST</Text>
        </TouchableOpacity>

        {admins.length > 0 && (
          <>
            <Text style={s.groupTitle}>ADMINS & CALLERS</Text>
            {admins.map((user) => (
              <TouchableOpacity
                key={user.id}
                style={s.userRow}
                onPress={() => { setSelectedUser(user); setEditing(false); setView('detail'); }}
              >
                <View style={s.userRowLeft}>
                  <Text style={s.userName}>{user.name}</Text>
                  <Text style={s.userPhone}>{user.phone_number || 'No phone'}</Text>
                </View>
                <RolePill role={user.role} />
              </TouchableOpacity>
            ))}
          </>
        )}

        <Text style={[s.groupTitle, admins.length > 0 && { marginTop: spacing.xxl }]}>DRIVERS</Text>
        {drivers.length === 0 && (
          <Text style={s.emptyText}>No drivers found</Text>
        )}
        {drivers.map((user) => (
          <TouchableOpacity
            key={user.id}
            style={s.userRow}
            onPress={() => { setSelectedUser(user); setEditing(false); setView('detail'); }}
          >
            <View style={s.userRowLeft}>
              <Text style={s.userName}>{user.name}</Text>
              <View style={s.userBadges}>
                {user.can_drive_manual && (
                  <View style={s.badge}>
                    <Text style={s.badgeText}>MANUAL</Text>
                  </View>
                )}
                {user.willing_to_fly && (
                  <View style={[s.badge, { borderColor: colors.info, backgroundColor: colors.infoDim }]}>
                    <Text style={[s.badgeText, { color: colors.info }]}>FLY</Text>
                  </View>
                )}
              </View>
            </View>
            <Text style={s.userPhone}>{user.phone_number || '—'}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    );
  }

  // ── CREATE VIEW ──

  function renderCreate() {
    return (
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={100}
      >
        <ScrollView style={s.scrollArea} contentContainerStyle={s.scrollContent}>
          <Text style={s.fieldLabel}>NAME *</Text>
          <TextInput
            style={s.input}
            value={form.name}
            onChangeText={(v) => setForm({ ...form, name: v })}
            placeholder="Full Name"
            placeholderTextColor={colors.textMuted}
          />

          <Text style={s.fieldLabel}>EMAIL *</Text>
          <TextInput
            style={s.input}
            value={form.email}
            onChangeText={(v) => setForm({ ...form, email: v })}
            placeholder="email@example.com"
            placeholderTextColor={colors.textMuted}
            keyboardType="email-address"
            autoCapitalize="none"
          />

          <Text style={s.fieldLabel}>PASSWORD *</Text>
          <TextInput
            style={s.input}
            value={form.password}
            onChangeText={(v) => setForm({ ...form, password: v })}
            placeholder="Min 6 characters"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
          />

          <Text style={s.fieldLabel}>ROLE *</Text>
          <View style={s.roleRow}>
            {['driver', 'manager', 'caller', ...(canSeePay ? ['admin'] : [])].map((r) => (
              <TouchableOpacity
                key={r}
                style={[s.rolePick, form.role === r && s.rolePickActive]}
                onPress={() => setForm({ ...form, role: r })}
              >
                <Text style={[s.rolePickText, form.role === r && s.rolePickTextActive]}>
                  {r.toUpperCase()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={s.fieldLabel}>PHONE NUMBER</Text>
          <TextInput
            style={s.input}
            value={form.phone_number}
            onChangeText={(v) => setForm({ ...form, phone_number: v })}
            placeholder="(555) 123-4567"
            placeholderTextColor={colors.textMuted}
            keyboardType="phone-pad"
          />

          <Text style={s.fieldLabel}>DRIVER'S LICENSE NUMBER</Text>
          <TextInput
            style={s.input}
            value={form.drivers_license_number}
            onChangeText={(v) => setForm({ ...form, drivers_license_number: v })}
            placeholder="DL123456"
            placeholderTextColor={colors.textMuted}
          />

          <View style={s.switchRow}>
            <Text style={s.switchLabel}>Can drive manual</Text>
            <Switch
              value={form.can_drive_manual}
              onValueChange={(v) => setForm({ ...form, can_drive_manual: v })}
              trackColor={{ true: colors.primary }}
              thumbColor="#fff"
            />
          </View>

          <View style={s.switchRow}>
            <Text style={s.switchLabel}>Willing to fly</Text>
            <Switch
              value={form.willing_to_fly}
              onValueChange={(v) => setForm({ ...form, willing_to_fly: v })}
              trackColor={{ true: colors.primary }}
              thumbColor="#fff"
            />
          </View>

          {canSeePay && (
            <>
              <Text style={s.fieldLabel}>HOURLY WAGE ($)</Text>
              <TextInput
                style={s.textInput}
                value={form.hourly_wage}
                onChangeText={(v) => setForm({ ...form, hourly_wage: v })}
                placeholder="0.00"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
              />
            </>
          )}

          <Text style={s.fieldLabel}>DRIVER'S LICENSE PHOTO</Text>
          <TouchableOpacity
            style={s.photoBtn}
            onPress={() => pickImage(setLicenseImage)}
          >
            <Text style={s.photoBtnText}>
              {licenseImage ? 'CHANGE PHOTO' : 'SELECT PHOTO'}
            </Text>
          </TouchableOpacity>
          {licenseImage && (
            <Image source={{ uri: licenseImage.uri }} style={s.licensePreview} resizeMode="contain" />
          )}

          <TouchableOpacity
            style={[s.primaryBtn, saving && { opacity: 0.5 }]}
            onPress={handleCreate}
            disabled={saving}
          >
            <Text style={s.primaryBtnText}>
              {saving ? 'CREATING...' : 'CREATE USER'}
            </Text>
          </TouchableOpacity>

          <View style={{ height: spacing.xxxxl }} />
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── BROADCAST VIEW ──

  function renderBroadcast() {
    const targetLabels = { drivers: 'All Drivers', all: 'Everyone', admins: 'Admins Only' };
    const driverCount = profiles.filter((p) => p.role === 'driver').length;
    const allCount = profiles.length;
    const adminCount = profiles.filter((p) => p.role !== 'driver').length;
    const recipientCount = broadcastTarget === 'drivers' ? driverCount : broadcastTarget === 'all' ? allCount : adminCount;

    return (
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={100}
      >
        <ScrollView style={s.scrollArea} contentContainerStyle={s.scrollContent}>
          <Text style={s.fieldLabel}>SEND TO</Text>
          <View style={s.roleRow}>
            {['drivers', 'all', 'admins'].map((t) => (
              <TouchableOpacity
                key={t}
                style={[s.rolePick, broadcastTarget === t && s.rolePickActive]}
                onPress={() => setBroadcastTarget(t)}
              >
                <Text style={[s.rolePickText, broadcastTarget === t && s.rolePickTextActive]}>
                  {targetLabels[t]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={s.broadcastRecipientCount}>
            {recipientCount} {recipientCount === 1 ? 'recipient' : 'recipients'}
          </Text>

          <Text style={s.fieldLabel}>MESSAGE</Text>
          <TextInput
            style={[s.input, s.broadcastInput]}
            value={broadcastMessage}
            onChangeText={setBroadcastMessage}
            placeholder="Type your broadcast message..."
            placeholderTextColor={colors.textMuted}
            multiline
            textAlignVertical="top"
            maxLength={500}
          />
          <Text style={s.charCount}>{broadcastMessage.length}/500</Text>

          <TouchableOpacity
            style={[s.broadcastSendBtn, broadcasting && { opacity: 0.5 }]}
            onPress={handleBroadcast}
            disabled={broadcasting}
          >
            <Text style={s.broadcastSendBtnText}>
              {broadcasting ? 'SENDING...' : '📢 SEND BROADCAST'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── DETAIL VIEW ──

  function renderDetail() {
    if (!selectedUser) return null;
    const u = selectedUser;

    if (editing) {
      return (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={100}
        >
          <ScrollView style={s.scrollArea} contentContainerStyle={s.scrollContent}>
            <Text style={s.fieldLabel}>PHONE NUMBER</Text>
            <TextInput
              style={s.input}
              value={editForm.phone_number}
              onChangeText={(v) => setEditForm({ ...editForm, phone_number: v })}
              placeholder="(555) 123-4567"
              placeholderTextColor={colors.textMuted}
              keyboardType="phone-pad"
            />

            <Text style={s.fieldLabel}>DRIVER'S LICENSE NUMBER</Text>
            <TextInput
              style={s.input}
              value={editForm.drivers_license_number}
              onChangeText={(v) => setEditForm({ ...editForm, drivers_license_number: v })}
              placeholder="DL123456"
              placeholderTextColor={colors.textMuted}
            />

            <View style={s.switchRow}>
              <Text style={s.switchLabel}>Can drive manual</Text>
              <Switch
                value={editForm.can_drive_manual}
                onValueChange={(v) => setEditForm({ ...editForm, can_drive_manual: v })}
                trackColor={{ true: colors.primary }}
                thumbColor="#fff"
              />
            </View>

            <View style={s.switchRow}>
              <Text style={s.switchLabel}>Willing to fly</Text>
              <Switch
                value={editForm.willing_to_fly}
                onValueChange={(v) => setEditForm({ ...editForm, willing_to_fly: v })}
                trackColor={{ true: colors.primary }}
                thumbColor="#fff"
              />
            </View>

            {canSeePay && (
              <>
                <Text style={s.fieldLabel}>HOURLY WAGE ($)</Text>
                <TextInput
                  style={s.textInput}
                  value={String(editForm.hourly_wage ?? '')}
                  onChangeText={(v) => setEditForm({ ...editForm, hourly_wage: v })}
                  placeholder="0.00"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="decimal-pad"
                />
              </>
            )}

            <Text style={s.fieldLabel}>DRIVER'S LICENSE PHOTO</Text>
            <TouchableOpacity
              style={s.photoBtn}
              onPress={() => pickImage((img) => setEditForm({ ...editForm, newLicenseImage: img }))}
            >
              <Text style={s.photoBtnText}>
                {editForm.newLicenseImage ? 'CHANGE PHOTO' : 'SELECT NEW PHOTO'}
              </Text>
            </TouchableOpacity>
            {editForm.newLicenseImage && (
              <Image source={{ uri: editForm.newLicenseImage.uri }} style={s.licensePreview} resizeMode="contain" />
            )}
            {!editForm.newLicenseImage && u.drivers_license_photo_url && (
              <Image source={{ uri: u.drivers_license_photo_url }} style={s.licensePreview} resizeMode="contain" />
            )}

            <View style={s.editActions}>
              <TouchableOpacity
                style={s.cancelBtn}
                onPress={() => setEditing(false)}
              >
                <Text style={s.cancelBtnText}>CANCEL</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.primaryBtn, { flex: 1 }, saving && { opacity: 0.5 }]}
                onPress={handleSaveEdit}
                disabled={saving}
              >
                <Text style={s.primaryBtnText}>
                  {saving ? 'SAVING...' : 'SAVE CHANGES'}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={{ height: spacing.xxxxl }} />
          </ScrollView>
        </KeyboardAvoidingView>
      );
    }

    return (
      <ScrollView style={s.scrollArea} contentContainerStyle={s.scrollContent}>
        <View style={s.detailHeader}>
          <Text style={s.detailName}>{u.name}</Text>
          <RolePill role={u.role} />
        </View>

        <View style={s.detailCard}>
          <DetailRow label="EMAIL" value={u.email} />
          <DetailRow label="PHONE" value={u.phone_number} />
          <DetailRow label="DATE OF BIRTH" value={u.date_of_birth} />
          <DetailRow label="LICENSE #" value={u.drivers_license_number} />
          <DetailRow label="MANUAL TRANS" value={u.can_drive_manual ? 'Yes' : 'No'} />
          <DetailRow label="WILLING TO FLY" value={u.willing_to_fly ? 'Yes' : 'No'} />
          {canSeePay && <DetailRow label="HOURLY WAGE" value={u.hourly_wage ? `$${Number(u.hourly_wage).toFixed(2)}/hr` : 'Not set'} />}
        </View>

        {u.drivers_license_photo_url && (
          <>
            <Text style={[s.fieldLabel, { marginTop: spacing.lg }]}>LICENSE PHOTO</Text>
            <Image source={{ uri: u.drivers_license_photo_url }} style={s.licensePreview} resizeMode="contain" />
          </>
        )}

        <View style={s.detailActions}>
          {canSeePay && (
          <TouchableOpacity
            style={s.editBtn}
            onPress={() => {
              setEditForm({
                phone_number: u.phone_number || '',
                can_drive_manual: u.can_drive_manual ?? false,
                willing_to_fly: u.willing_to_fly ?? false,
                drivers_license_number: u.drivers_license_number || '',
                hourly_wage: u.hourly_wage ?? '',
                newLicenseImage: null,
              });
              setEditing(true);
            }}
          >
            <Text style={s.editBtnText}>EDIT</Text>
          </TouchableOpacity>
          )}
          {canSeePay && (
            <TouchableOpacity
              style={s.deleteBtn}
              onPress={() => handleDelete(u)}
            >
              <Text style={s.deleteBtnText}>DELETE USER</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={{ height: spacing.xxxxl }} />
      </ScrollView>
    );
  }

  function DetailRow({ label, value }) {
    return (
      <View style={s.detailRow}>
        <Text style={s.detailLabel}>{label}</Text>
        <Text style={s.detailValue}>{value || '—'}</Text>
      </View>
    );
  }

  // ── HEADER ──

  const titles = { list: 'MANAGE USERS', add: 'CREATE USER', detail: selectedUser?.name?.toUpperCase() || 'USER', broadcast: 'BROADCAST' };
  const showBack = view !== 'list';

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={s.container}>
        <View style={s.header}>
          {showBack ? (
            <TouchableOpacity
              onPress={() => {
                if (editing) { setEditing(false); return; }
                setView('list');
                setSelectedUser(null);
              }}
              style={s.backBtn}
            >
              <Text style={s.backText}>BACK</Text>
            </TouchableOpacity>
          ) : (
            <View style={s.backBtn} />
          )}
          <Text style={s.headerTitle}>{editing ? 'EDIT USER' : titles[view]}</Text>
          <TouchableOpacity onPress={onClose} style={s.closeBtn}>
            <Text style={s.closeText}>CLOSE</Text>
          </TouchableOpacity>
        </View>
        {view === 'list' && renderList()}
        {view === 'add' && renderCreate()}
        {view === 'detail' && renderDetail()}
        {view === 'broadcast' && renderBroadcast()}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    paddingTop: 60,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    ...typography.label,
    color: colors.textPrimary,
  },
  backBtn: {
    minWidth: 60,
  },
  backText: {
    ...typography.labelSm,
    color: colors.primary,
  },
  closeBtn: {
    minWidth: 60,
    alignItems: 'flex-end',
  },
  closeText: {
    ...typography.labelSm,
    color: colors.textTertiary,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.xl,
  },

  // List
  createBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  createBtnText: {
    color: colors.bg,
    fontWeight: '800',
    fontSize: 13,
    letterSpacing: 1.5,
  },
  groupTitle: {
    ...typography.label,
    letterSpacing: 2,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  userRow: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  userRowLeft: {
    flex: 1,
    marginRight: spacing.md,
  },
  userName: {
    ...typography.body,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  userPhone: {
    ...typography.caption,
    color: colors.textTertiary,
  },
  userBadges: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  badge: {
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primaryDim,
    borderRadius: radius.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
    color: colors.primary,
  },
  emptyText: {
    ...typography.bodySm,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
  rolePill: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  rolePillText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
  },

  // Form
  fieldLabel: {
    ...typography.labelSm,
    color: colors.textTertiary,
    letterSpacing: 1.5,
    marginBottom: spacing.sm,
    marginTop: spacing.lg,
  },
  input: {
    ...components.input,
    marginBottom: spacing.sm,
  },
  roleRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  rolePick: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  rolePickActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryDim,
  },
  rolePickText: {
    ...typography.labelSm,
    color: colors.textTertiary,
  },
  rolePickTextActive: {
    color: colors.primary,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: spacing.lg,
    marginTop: spacing.lg,
  },
  switchLabel: {
    ...typography.body,
    color: colors.textPrimary,
  },
  photoBtn: {
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  photoBtnText: {
    ...typography.labelSm,
    color: colors.textTertiary,
  },
  licensePreview: {
    width: '100%',
    height: 200,
    borderRadius: radius.md,
    marginTop: spacing.md,
    backgroundColor: colors.surface,
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.xxl,
  },
  primaryBtnText: {
    color: colors.bg,
    fontWeight: '800',
    fontSize: 13,
    letterSpacing: 1.5,
  },

  // Detail
  detailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  detailName: {
    ...typography.h1,
    color: colors.textPrimary,
  },
  detailCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  detailLabel: {
    ...typography.labelSm,
    color: colors.textTertiary,
    letterSpacing: 1.5,
  },
  detailValue: {
    ...typography.body,
    color: colors.textPrimary,
    textAlign: 'right',
    flex: 1,
    marginLeft: spacing.lg,
  },
  detailActions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.xxl,
  },
  editBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  editBtnText: {
    ...typography.labelSm,
    color: colors.primary,
    letterSpacing: 1.5,
  },
  deleteBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  deleteBtnText: {
    ...typography.labelSm,
    color: colors.error,
    letterSpacing: 1.5,
  },
  editActions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.xxl,
  },
  cancelBtn: {
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxl,
    alignItems: 'center',
  },
  cancelBtnText: {
    ...typography.labelSm,
    color: colors.textTertiary,
    letterSpacing: 1.5,
  },

  // Broadcast
  broadcastBtn: {
    borderWidth: 1,
    borderColor: colors.infoBorder,
    backgroundColor: colors.infoDim,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  broadcastBtnText: {
    color: colors.info,
    fontWeight: '800',
    fontSize: 13,
    letterSpacing: 1.5,
  },
  broadcastInput: {
    height: 120,
    textAlignVertical: 'top',
    paddingTop: spacing.md,
  },
  charCount: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'right',
    marginTop: spacing.xs,
  },
  broadcastRecipientCount: {
    ...typography.caption,
    color: colors.textTertiary,
    marginBottom: spacing.lg,
  },
  broadcastSendBtn: {
    backgroundColor: colors.info,
    borderRadius: radius.sm,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.xxl,
  },
  broadcastSendBtnText: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 13,
    letterSpacing: 1.5,
  },
});
