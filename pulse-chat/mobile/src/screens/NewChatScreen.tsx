import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { api, ApiError } from '../api/http';
import * as repo from '../db/repo';
import type { RootStackParamList } from '../navigation';
import type { ServerChat, User } from '../types';
import { useTheme } from '../ui/theme';

export function NewChatScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'NewChat'>) {
  const t = useTheme();
  const [phone, setPhone] = useState('+');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const normalized = '+' + phone.replace(/\D/g, '');
  const valid = /^\+[1-9][0-9]{7,14}$/.test(normalized);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const { users } = await api<{ users: User[] }>('POST', '/v1/users/lookup', { phones: [normalized] });
      if (!users.length) {
        setError('This number is not registered on Pulse yet.');
        return;
      }
      const chat = await api<ServerChat>('POST', '/v1/chats/direct', { userId: users[0].id });
      await repo.upsertChats([chat]);
      const peer = chat.participants.find((p) => p.userId === users[0].id);
      navigation.replace('Chat', { chatId: chat.id, title: peer?.name || peer?.phone || normalized });
    } catch (e) {
      setError(e instanceof ApiError && e.status === 429 ? 'Too many lookups. Try again later.' : 'Something went wrong. Check your connection.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <Text style={{ color: t.textDim, marginBottom: 16 }}>Enter the phone number of the person you want to chat with.</Text>
      <TextInput
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        autoFocus
        placeholder="+92 300 1234567"
        placeholderTextColor={t.textDim}
        style={[styles.input, { backgroundColor: t.surface, color: t.text }]}
      />
      {error ? <Text style={{ color: t.danger, marginTop: 12 }}>{error}</Text> : null}
      <Pressable
        onPress={start}
        disabled={!valid || busy}
        style={[styles.button, { backgroundColor: valid && !busy ? t.primary : t.border }]}
      >
        {busy ? <ActivityIndicator color={t.onPrimary} /> : <Text style={{ color: t.onPrimary, fontWeight: '700', fontSize: 16 }}>Start chat</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 24 },
  input: { borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 18 },
  button: { marginTop: 20, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
});
