import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Tick } from '../types';
import { clock } from '../ui/format';
import { useTheme } from '../ui/theme';
import { Ticks } from './Ticks';

interface Props {
  content: string;
  createdAt: string;
  mine: boolean;
  tick: Tick | null;
  onRetry?: () => void;
}

export const MessageBubble = memo(function MessageBubble({ content, createdAt, mine, tick, onRetry }: Props) {
  const t = useTheme();
  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
      <Pressable
        disabled={tick !== 'failed'}
        onPress={onRetry}
        style={[styles.bubble, { backgroundColor: mine ? t.bubbleMine : t.bubbleTheirs }]}
      >
        <Text style={{ color: t.text, fontSize: 16 }} selectable>
          {content}
        </Text>
        <View style={styles.meta}>
          <Text style={{ color: t.textDim, fontSize: 11 }}>{tick === 'failed' ? 'Tap to retry' : clock(createdAt)}</Text>
          {mine && tick ? <View style={{ marginLeft: 4 }}><Ticks tick={tick} /></View> : null}
        </View>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  row: { paddingHorizontal: 10, paddingVertical: 2, flexDirection: 'row' },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '82%', borderRadius: 14, paddingHorizontal: 12, paddingTop: 7, paddingBottom: 4 },
  meta: { flexDirection: 'row', alignSelf: 'flex-end', alignItems: 'center', marginTop: 2 },
});
