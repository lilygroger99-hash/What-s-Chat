import { useLayoutEffect } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSession } from '../auth/session';
import { Avatar } from '../components/Avatar';
import { useLiveQuery } from '../db/events';
import * as repo from '../db/repo';
import type { RootStackParamList } from '../navigation';
import { engine, useConnection, useTyping } from '../realtime/engine';
import { listTime } from '../ui/format';
import { useTheme } from '../ui/theme';

export function ChatListScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Chats'>) {
  const t = useTheme();
  const me = useSession((s) => s.user)!;
  const logout = useSession((s) => s.logout);
  const conn = useConnection((s) => s.state);
  const typing = useTyping((s) => s.byChat);
  const chats = useLiveQuery(['chats'], () => repo.listChats(me.id), [me.id]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() =>
            Alert.alert('Pulse', me.phone, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Log out', style: 'destructive', onPress: () => void logout() },
            ])
          }
          accessibilityLabel="Account"
          hitSlop={12}
        >
          <Text style={{ color: t.text, fontSize: 22 }}>⋮</Text>
        </Pressable>
      ),
    });
  }, [navigation, me.phone, logout, t.text]);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {conn !== 'online' ? (
        <View style={[styles.banner, { backgroundColor: t.surface }]}>
          <Text style={{ color: t.textDim, fontSize: 12 }}>{conn === 'connecting' ? 'Connecting…' : 'Waiting for network…'}</Text>
        </View>
      ) : null}
      <FlatList
        data={chats ?? []}
        keyExtractor={(c) => c.id}
        renderItem={({ item }) => {
          const title = item.peer_name || item.peer_phone || item.title || 'Chat';
          const isTyping = (typing[item.id] ?? []).length > 0;
          const mineLast = item.last_sender === me.id;
          return (
            <Pressable
              onPress={() => navigation.navigate('Chat', { chatId: item.id, title })}
              onLongPress={() => void engine.sync()}
              style={styles.row}
            >
              <Avatar name={item.peer_name} phone={item.peer_phone} online={item.peer_online === 1} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <View style={styles.line}>
                  <Text style={[styles.title, { color: t.text }]} numberOfLines={1}>{title}</Text>
                  <Text style={{ color: item.unread ? t.primary : t.textDim, fontSize: 12 }}>{listTime(item.last_time)}</Text>
                </View>
                <View style={styles.line}>
                  <Text style={{ color: isTyping ? t.primary : t.textDim, flex: 1 }} numberOfLines={1}>
                    {isTyping ? 'typing…' : item.last_content ? `${mineLast ? 'You: ' : ''}${item.last_content}` : 'No messages yet'}
                  </Text>
                  {item.unread > 0 ? (
                    <View style={[styles.badge, { backgroundColor: t.primary }]}>
                      <Text style={{ color: t.onPrimary, fontSize: 12, fontWeight: '700' }}>{item.unread > 99 ? '99+' : item.unread}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <Text style={{ color: t.textDim, textAlign: 'center', marginTop: 80, paddingHorizontal: 32 }}>
            No chats yet. Tap + to start a conversation with someone who has Pulse.
          </Text>
        }
      />
      <Pressable
        onPress={() => navigation.navigate('NewChat')}
        accessibilityLabel="New chat"
        style={[styles.fab, { backgroundColor: t.primary }]}
      >
        <Text style={{ color: t.onPrimary, fontSize: 30, marginTop: -2 }}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { paddingVertical: 6, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10 },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 },
  title: { fontSize: 16, fontWeight: '600', flex: 1, marginRight: 8 },
  badge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  fab: { position: 'absolute', right: 20, bottom: 24, width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', elevation: 4 },
});
