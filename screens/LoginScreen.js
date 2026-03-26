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
import { colors, spacing, radius, typography, components } from '../lib/theme';
import useResponsive from '../lib/useResponsive';

export default function LoginScreen() {
  const { isTablet } = useResponsive();
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

        <View style={[styles.form, isTablet && { maxWidth: 450, alignSelf: 'center', width: '100%' }]}>
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
            placeholderTextColor={colors.textMuted}
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
                placeholderTextColor={colors.textMuted}
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
                  <ActivityIndicator color={colors.bg} />
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
                  <ActivityIndicator color={colors.bg} />
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
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xxxl,
    paddingTop: 60,
  },
  logoBlock: {
    marginBottom: spacing.xxxxl,
  },
  logoText: {
    ...typography.displayLg,
    fontSize: 38,
    color: colors.textPrimary,
    letterSpacing: 2,
  },
  logoAccent: {
    color: colors.primary,
  },
  logoSub: {
    ...typography.label,
    color: colors.textTertiary,
    letterSpacing: 3,
    marginTop: spacing.xs,
  },
  form: {
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xxl,
  },
  resetInfo: {
    ...typography.bodySm,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  label: {
    ...typography.label,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    marginTop: spacing.lg,
  },
  input: {
    ...components.input,
    borderRadius: radius.sm,
  },
  button: {
    ...components.buttonPrimary,
    borderRadius: radius.md,
    paddingVertical: 18,
    marginTop: 28,
  },
  buttonDisabled: {
    ...components.buttonDisabled,
  },
  buttonText: {
    ...components.buttonPrimaryText,
    letterSpacing: 2,
  },
  forgotPassword: {
    marginTop: spacing.xl,
    alignItems: 'center',
  },
  forgotPasswordText: {
    ...typography.bodySm,
    color: colors.primary,
    fontWeight: '600',
  },
  backToLogin: {
    marginTop: spacing.xl,
    alignItems: 'center',
  },
  backToLoginText: {
    ...typography.bodySm,
    color: colors.textSecondary,
    fontWeight: '600',
  },
});
