import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from '../api/http';

/**
 * Notifications are shown by the OS from a *generic* FCM payload ("New message" + chatId);
 * the app renders real content locally after syncing over your own server. Google never sees
 * message text or contacts. Requires google-services.json at build time (see docs/BUILD_ORDER.md).
 * Without it the app still works; messages simply arrive while the app is running.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let registeredToken: string | null = null;

export async function registerForPush(): Promise<void> {
  if (Platform.OS !== 'android' || !Device.isDevice) return;
  await Notifications.setNotificationChannelAsync('messages', {
    name: 'Messages',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 200, 100, 200],
  });

  const existing = await Notifications.getPermissionsAsync();
  const granted = existing.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return;

  try {
    // Native FCM token (NOT an Expo push token): no Expo push service in the path.
    const { data } = await Notifications.getDevicePushTokenAsync();
    if (typeof data !== 'string' || data === registeredToken) return;
    await api('PUT', '/v1/devices/push-token', { token: data, platform: 'android' });
    registeredToken = data;
  } catch {
    // No google-services.json / Play Services unavailable: run without push.
  }
}

export async function unregisterPush(): Promise<void> {
  if (!registeredToken) return;
  await api('DELETE', '/v1/devices/push-token', { token: registeredToken, platform: 'android' }).catch(() => {});
  registeredToken = null;
}
