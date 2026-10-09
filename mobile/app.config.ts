import type { ExpoConfig } from 'expo/config';

/**
 * Build-time configuration. Set these in the environment of the build (GitHub Actions secrets / .env):
 *   API_URL          https://chat.your-domain.example   (public HTTPS endpoint of your NAS)
 *   ALLOW_CLEARTEXT  1  only for local dev against http://  (never in release builds)
 *   GOOGLE_SERVICES_FILE  path to google-services.json   (optional; only needed for FCM push)
 */
const config: ExpoConfig = {
  name: 'Pulse',
  slug: 'pulse-chat',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  scheme: 'pulse',
  platforms: ['android'],
  android: {
    package: 'com.pulsechat.app', // change before publishing: this is your permanent app id
    versionCode: 1,
    adaptiveIcon: {
      backgroundColor: '#0B1E2D',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    permissions: ['POST_NOTIFICATIONS'],
    predictiveBackGestureEnabled: false,
    ...(process.env.GOOGLE_SERVICES_FILE ? { googleServicesFile: process.env.GOOGLE_SERVICES_FILE } : {}),
  },
  plugins: [
    'expo-secure-store',
    'expo-sqlite',
    ['expo-notifications', { color: '#2E7DFF' }],
    [
      'expo-build-properties',
      { android: { usesCleartextTraffic: process.env.ALLOW_CLEARTEXT === '1' } },
    ],
  ],
  extra: {
    apiUrl: process.env.API_URL ?? 'http://10.0.2.2:8080', // 10.0.2.2 = host machine from the Android emulator
    otpViaEmail: process.env.OTP_VIA_EMAIL === '1',
  },
};

export default config;
