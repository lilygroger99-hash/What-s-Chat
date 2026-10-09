import { Text } from 'react-native';
import type { Tick } from '../types';
import { useTheme } from '../ui/theme';

/** WhatsApp-style status glyphs: clock (queued) -> ✓ sent -> ✓✓ delivered -> blue ✓✓ read. */
export function Ticks({ tick }: { tick: Tick }) {
  const t = useTheme();
  switch (tick) {
    case 'pending':
      return <Text style={{ color: t.tickDim, fontSize: 11 }} accessibilityLabel="Sending">🕓</Text>;
    case 'failed':
      return <Text style={{ color: t.danger, fontSize: 12, fontWeight: '700' }} accessibilityLabel="Failed">!</Text>;
    case 'sent':
      return <Text style={{ color: t.tickDim, fontSize: 12 }} accessibilityLabel="Sent">✓</Text>;
    case 'delivered':
      return <Text style={{ color: t.tickDim, fontSize: 12 }} accessibilityLabel="Delivered">✓✓</Text>;
    case 'read':
      return <Text style={{ color: t.tickRead, fontSize: 12 }} accessibilityLabel="Read">✓✓</Text>;
  }
}
