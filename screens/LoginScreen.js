import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { supabase } from '../lib/supabase';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetMode, setResetMode] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please enter your email and password.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      Alert.alert('Login Failed', error.message);
    }
    setLoading(false);
  };

  const handlePasswordReset = async () => {
    if (!email) {
      Alert.alert('Error', 'Please enter your email address.');
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: 'driverpay://reset-password', // Deep link for mobile app
    });
    setLoading(false);

    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    Alert.alert(
      'Check Your Email',
      'We sent you a password reset link. Check your email and follow the instructions.',
      [
        {
          text: 'OK',
          onPress: () => setResetMode(false),
        },
      ]
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        <View style={styles.logoBlock}>
          <Text style={styles.logoText}>
            DRIVER<Text style={styles.logoAccent}>PAY</Text>
          </Text>
          <Text style={styles.logoSub}>Driver Portal</Text>
        </View>

        <View style={styles.form}>
          {resetMode && (
            <Text style={styles.resetInfo}>
              Enter your email address and we'll send you a link to reset your
              password.
            </Text>
          )}

          <Text style={styles.label}>EMAIL</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholderTextColor="#555"
            placeholder="you@driverportal.live"
          />

          {!resetMode && (
            <>
              <Text style={styles.label}>PASSWORD</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                placeholderTextColor="#555"
                placeholder="••••••••"
              />
            </>
          )}

          {resetMode ? (
            <>
              <TouchableOpacity
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={handlePasswordReset}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#0a0a0a" />
                ) : (
                  <Text style={styles.buttonText}>SEND RESET LINK →</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.backToLogin}
                onPress={() => setResetMode(false)}
              >
                <Text style={styles.backToLoginText}>← Back to Login</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={handleLogin}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#0a0a0a" />
                ) : (
                  <Text style={styles.buttonText}>SIGN IN →</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.forgotPassword}
                onPress={() => setResetMode(true)}
              >
                <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingTop: 60,
  },
  logoBlock: { marginBottom: 48 },
  logoText: {
    fontSize: 38,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 2,
  },
  logoAccent: { color: '#f5a623' },
  logoSub: {
    fontSize: 12,
    color: '#555',
    letterSpacing: 3,
    marginTop: 4,
  },
  form: { gap: 8 },
  resetInfo: {
    fontSize: 13,
    color: '#888',
    marginBottom: 16,
    lineHeight: 20,
  },
  label: {
    fontSize: 11,
    color: '#888',
    letterSpacing: 2,
    marginBottom: 4,
    marginTop: 16,
  },
  input: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#ffffff',
    fontSize: 15,
  },
  button: {
    backgroundColor: '#f5a623',
    borderRadius: 6,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 28,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: {
    color: '#0a0a0a',
    fontWeight: '800',
    fontSize: 14,
    letterSpacing: 2,
  },
  forgotPassword: {
    marginTop: 20,
    alignItems: 'center',
  },
  forgotPasswordText: {
    color: '#f5a623',
    fontSize: 13,
    fontWeight: '600',
  },
  backToLogin: {
    marginTop: 20,
    alignItems: 'center',
  },
  backToLoginText: {
    color: '#888',
    fontSize: 13,
    fontWeight: '600',
  },
});