import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ApiError } from '../api/http';
import { useSession } from '../auth/session';
import type { RootStackParamList } from '../navigation';
import { useTheme } from '../ui/theme';

export function OtpScreen({ route }: NativeStackScreenProps<RootStackParamList, 'Otp'>) {
  const { phone, email } = route.params;
  const t = useTheme();
  const { verifyOtp, requestOtp } = useSession();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(30);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const submit = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      await verifyOtp(phone, value); // root navigator switches screens when the session becomes signedIn
    } catch (e) {
      setBusy(false);
      setCode('');
      setError(
        e instanceof ApiError && e.code === 'too_many_attempts'
          ? 'Too many wrong attempts. Request a new code.'
          : e instanceof ApiError && e.status === 429
            ? 'Too many attempts. Please wait a few minutes.'
            : e instanceof ApiError && e.status === 401
              ? 'That code is not valid or has expired.'
              : 'Network problem. Try again.',
      );
    }
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: t.bg }]}>
      <Text style={[styles.title, { color: t.text }]}>Verify {phone}</Text>
      <Text style={{ color: t.textDim, marginBottom: 24 }}>Enter the 6-digit code we sent{email ? ` to ${email}` : ''}.</Text>
      <TextInput
        value={code}
        onChangeText={(v) => {
          const d = v.replace(/\D/g, '').slice(0, 6);
          setCode(d);
          if (d.length === 6) void submit(d);
        }}
        keyboardType="number-pad"
        autoComplete="sms-otp"
        textContentType="oneTimeCode"
        maxLength={6}
        autoFocus
        style={[styles.input, { backgroundColor: t.surface, color: t.text }]}
        accessibilityLabel="Verification code"
      />
      {busy ? <ActivityIndicator style={{ marginTop: 20 }} color={t.primary} /> : null}
      {error ? <Text style={{ color: t.danger, marginTop: 12 }}>{error}</Text> : null}
      <Pressable
        disabled={cooldown > 0}
        onPress={() => {
          setCooldown(30);
          void requestOtp(phone, email).catch(() => setError('Could not resend the code.'));
        }}
        style={{ marginTop: 24 }}
      >
        <Text style={{ color: cooldown > 0 ? t.textDim : t.primary, textAlign: 'center' }}>
          {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
        </Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 24, justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 8 },
  input: { borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 28, letterSpacing: 8, textAlign: 'center' },
});
