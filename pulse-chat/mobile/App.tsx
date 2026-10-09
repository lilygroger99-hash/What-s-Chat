import { NavigationContainer, DarkTheme, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, useColorScheme, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useSession } from './src/auth/session';
import { navigationRef, type RootStackParamList } from './src/navigation';
import { registerForPush } from './src/push/register';
import { ChatListScreen } from './src/screens/ChatListScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { NewChatScreen } from './src/screens/NewChatScreen';
import { OtpScreen } from './src/screens/OtpScreen';
import { PhoneScreen } from './src/screens/PhoneScreen';
import { ProfileSetupScreen } from './src/screens/ProfileSetupScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const scheme = useColorScheme();
  const status = useSession((s) => s.status);
  const hasName = useSession((s) => Boolean(s.user?.name));

  useEffect(() => {
    void useSession.getState().bootstrap();
  }, []);

  useEffect(() => {
    if (status === 'signedIn' && hasName) void registerForPush();
  }, [status, hasName]);

  // Tapping a notification opens that chat.
  useEffect(() => {
    const open = (chatId?: unknown) => {
      if (typeof chatId === 'string' && navigationRef.isReady()) navigationRef.navigate('Chat', { chatId, title: 'Chat' });
    };
    Notifications.getLastNotificationResponseAsync().then((r) => open(r?.notification.request.content.data?.chatId)).catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener((r) => open(r.notification.request.content.data?.chatId));
    return () => sub.remove();
  }, []);

  if (status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer ref={navigationRef} theme={scheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack.Navigator>
          {status === 'signedOut' ? (
            <>
              <Stack.Screen name="Phone" component={PhoneScreen} options={{ headerShown: false }} />
              <Stack.Screen name="Otp" component={OtpScreen} options={{ title: '' }} />
            </>
          ) : !hasName ? (
            <Stack.Screen name="ProfileSetup" component={ProfileSetupScreen} options={{ headerShown: false }} />
          ) : (
            <>
              <Stack.Screen name="Chats" component={ChatListScreen} options={{ title: 'Pulse' }} />
              <Stack.Screen name="NewChat" component={NewChatScreen} options={{ title: 'New chat' }} />
              <Stack.Screen name="Chat" component={ChatScreen} />
            </>
          )}
        </Stack.Navigator>
        <StatusBar style="auto" />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
