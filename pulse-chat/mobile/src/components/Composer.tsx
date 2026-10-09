import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../ui/theme';

interface Props {
  onSend: (text: string) => void;
  onTyping: (isTyping: boolean) => void;
}

export function Composer({ onSend, onTyping }: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const lastSent = useRef(0);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (idle.current) clearTimeout(idle.current);
  }, []);

  const change = (v: string) => {
    setText(v);
    const now = Date.now();
    // Throttle "typing" to one event per 3 s, then send an explicit stop after 4 s of silence.
    if (v && now - lastSent.current > 3000) {
      lastSent.current = now;
      onTyping(true);
    }
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(() => {
      lastSent.current = 0;
      onTyping(false);
    }, 4000);
  };

  const send = () => {
    const v = text.trim();
    if (!v) return;
    setText('');
    lastSent.current = 0;
    if (idle.current) clearTimeout(idle.current);
    onTyping(false);
    onSend(v);
  };

  return (
    <View style={[styles.bar, { borderTopColor: t.border, backgroundColor: t.bg, paddingBottom: Math.max(insets.bottom, 8) }]}>
      <TextInput
        value={text}
        onChangeText={change}
        placeholder="Message"
        placeholderTextColor={t.textDim}
        multiline
        maxLength={4096}
        style={[styles.input, { backgroundColor: t.surface, color: t.text }]}
      />
      <Pressable
        onPress={send}
        disabled={!text.trim()}
        accessibilityRole="button"
        accessibilityLabel="Send"
        style={[styles.send, { backgroundColor: text.trim() ? t.primary : t.border }]}
      >
        <Text style={{ color: t.onPrimary, fontSize: 18, fontWeight: '700' }}>➤</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, maxHeight: 130, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, fontSize: 16 },
  send: { width: 44, height: 44, borderRadius: 22, marginLeft: 8, alignItems: 'center', justifyContent: 'center' },
});
