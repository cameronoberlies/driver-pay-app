// ANDROID IN-APP UPDATE CHECKER
// Add to App.js or create UpdateChecker.js component

import React, { useEffect, useState } from 'react';
import { Alert, Linking, Platform } from 'react-native';
import * as Application from 'expo-application';
import AsyncStorage from '@react-native-async-storage/async-storage';

const DISMISSED_VERSION_KEY = 'dismissed_update_version';

// The sideload build uses this package name; the Play Store build uses
// com.cameronoberlies.driverpay and must NEVER hit this code path or it
// prompts users to install the GitHub APK on top of their Play Store app
// (which Android treats as a separate install, not an update). Previously
// gated on getInstallReferrerAsync but that throws unpredictably on
// restored / non-Vending Play installs and the .catch() fell through to
// checking anyway.
const SIDELOAD_PACKAGE = 'com.driverportal.app';
const VERSION_CHECK_URL = 'https://api.github.com/repos/cameronoberlies/driver-pay-app/releases/latest';

export function useUpdateChecker() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    if (Application.applicationId !== SIDELOAD_PACKAGE) return;
    checkForUpdates();
  }, []);

  // In checkForUpdates function:
async function checkForUpdates() {
  try {
    const currentVersion = Application.nativeApplicationVersion; // e.g., "1.0.2"

    const response = await fetch(VERSION_CHECK_URL);
    const data = await response.json();
    
    // GitHub API returns:
    // { "tag_name": "v1.0.2", "assets": [{ "browser_download_url": "..." }] }
    const latestVersion = data.tag_name.replace('v', ''); // "v1.0.2" → "1.0.2"
    const downloadUrl = data.assets[0]?.browser_download_url;

    if (!downloadUrl) {
      console.log('No APK found in release');
      return;
    }

    if (isNewerVersion(latestVersion, currentVersion)) {
      // Skip if user already dismissed this version
      const dismissed = await AsyncStorage.getItem(DISMISSED_VERSION_KEY);
      if (dismissed === latestVersion) return;

      setUpdateAvailable(true);

      Alert.alert(
        '🚀 Update Available',
        `Version ${latestVersion} is now available. You're on ${currentVersion}.`,
        [
          {
            text: 'Later',
            style: 'cancel',
            onPress: () => AsyncStorage.setItem(DISMISSED_VERSION_KEY, latestVersion),
          },
          {
            text: 'Update Now',
            onPress: () => Linking.openURL(downloadUrl),
          }
        ]
      );
    }
  } catch (error) {
    console.log('Update check failed:', error);
  }
}

  function isNewerVersion(latest, current) {
    const latestParts = latest.split('.').map(Number);
    const currentParts = current.split('.').map(Number);

    for (let i = 0; i < 3; i++) {
      if (latestParts[i] > currentParts[i]) return true;
      if (latestParts[i] < currentParts[i]) return false;
    }
    return false;
  }

  return { updateAvailable };
}

