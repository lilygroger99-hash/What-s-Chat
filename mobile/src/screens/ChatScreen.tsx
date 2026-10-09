import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useLayoutEffect, useMemo } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSession } from '../auth/session';
import { Composer } from '../components/Composer';
import { MessageBubble } from '../components/MessageBubble';
import { useLiveQuery } from '../db/events';
import * as repo from '../db/repo';
import type { RootStackParamList } from '../navigation';
import { engine, useTyping } from '../realtime/engine';
import { lastSeenText } from '../ui/format';
import { useTheme } from '../ui/theme';

export function ChatScreen({ route, navigation }: NativeStackScreenProps<RootStackParamList, 'Chat'>) {
  const { chatId, title } = route.params;
  const t = useTheme();
  const me = useSession((s) => s.user)!;
  const typing = useTyping((s) => s.byChat[chatId] ?? []);

  const messages = useLiveQuery([`messages:${chatId}`], () => repo.listMessages(chatId, 300), [chatId]);
  const participants = useLiveQuery([`messages:${chatId}`, 'chats'], () => repo.getParticipants(chatId), [chatId]);

  const others = useMemo(() => (participants ?? []).filter((p) => p.user_id !== me.id), [participants, me.id]);
  const peer = others[0];

  // While this screen is focused, incoming messages are marked read immediately.
  useEffect(() => {
    engine.setActiveChat(chatId);
    return () => engine.setActiveChat(null);
  }, [chatId]);

  const subtitle = typing.some((u) => u !== me.id)
    ? 'typing…'
    : peer?.online
      ? 'online'
      : peer
        ? lastSeenText(peer.last_seen)
        : '';

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <View>
          <Text style={{ color: t.text, fontSize: 17, fontWeight: '600' }} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={{ color: subtitle === 'typing…' || subtitle === 'online' ? t.primary : t.textDim, fontSize: 12 }}>{subtitle}</Text> : null}
        </View>
      ),
    });
  }, [navigation, title, subtitle, t]);

  // Inverted list: newest first.
  const data = useMemo(() => [...(messages ?? [])].reverse(), [messages]);

  const send = useCallback(
    (text: string) => void engine.sendText(chatId, text, Crypto.randomUUID()),
    [chatId],
  );
  const onTyping = useCallback((on: boolean) => engine.sendTyping(chatId, on), [chatId]);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: t.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <FlatList
        inverted
        data={data}
        keyExtractor={(m) => m.client_msg_id}
        contentContainerStyle={{ paddingVertical: 8 }}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => {
          const mine = item.sender_id === me.id;
          return (
            <MessageBubble
              content={item.content}
              createdAt={item.created_at}
              mine={mine}
              tick={mine ? repo.tickFor(item, others) : null}
              onRetry={() => void engine.retry(item.client_msg_id, chatId)}
            />
          );
        }}
      />
      <Composer onSend={send} onTyping={onTyping} />
    </KeyboardAvoidingView>
  );
}
