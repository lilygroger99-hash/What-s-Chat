import { Text, View } from 'react-native';
import { initials } from '../ui/format';
import { useTheme } from '../ui/theme';

export function Avatar({ name, phone, online, size = 46 }: { name: string; phone: string; online?: boolean; size?: number }) {
  const t = useTheme();
  return (
    <View style={{ width: size, height: size }}>
      <View
        style={{
          width: size, height: size, borderRadius: size / 2, backgroundColor: t.primary,
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Text style={{ color: t.onPrimary, fontSize: size * 0.42, fontWeight: '600' }}>{initials(name, phone)}</Text>
      </View>
      {online ? (
        <View
          style={{
            position: 'absolute', right: 0, bottom: 0, width: size * 0.28, height: size * 0.28,
            borderRadius: size, backgroundColor: t.online, borderWidth: 2, borderColor: t.bg,
          }}
        />
      ) : null}
    </View>
  );
}
