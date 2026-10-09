import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ApiError } from '../api/http';
import { useSession } from '../auth/session';
import { OTP_VIA_EMAIL } from '../config';
import type { RootStackParamList } from '../navigation';
import { useTheme } from '../ui/theme';

export function PhoneScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Phone'>) {
  const t = useTheme();
  const requestOtp = useSession((s) => s.requestOtp);
  const [phone, setPhone] = useState('+');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalized = '+' + phone.replace(/\D/g, '');
  const valid = /^\+[1-9][0-9]{7,14}$/.test(normalized) && (!OTP_VIA_EMAIL || /\S+@\S+\.\S+/.test(email));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await requestOtp(normalized, OTP_VIA_EMAIL ? email.trim() : undefined);
      navigation.navigate('Otp', { phone: normalized, email: OTP_VIA_EMAIL ? email.trim() : undefined });
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 429
          ? `Too many attempts. Try again in ${Math.ceil((e.retryAfterSec ?? 60) / 60)} min.`
          : 'Could not send the code. Check your number and connection.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: t.bg }]}>
      <Text style={[styles.title, { color: t.text }]}>Welcome to Pulse</Text>
      <Text style={{ color: t.textDim, marginBottom: 24 }}>Enter your phone number with country code. We will send you a verification code.</Text>
      <TextInput
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        autoComplete="tel"
        placeholder="+92 300 1234567"
        placeholderTextColor={t.textDim}
        style={[styles.input, { backgroundColor: t.surface, color: t.text }]}
        accessibilityLabel="Phone number"
      />
      {OTP_VIA_EMAIL ? (
        <TextInput
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          placeholder="Email for the code"
          placeholderTextColor={t.textDim}
          style={[styles.input, { backgroundColor: t.surface, color: t.text, marginTop: 12 }]}
        />
      ) : null}
      {error ? <Text style={{ color: t.danger, marginTop: 12 }}>{error}</Text> : null}
      <Pressable
        onPress={submit}
        disabled={!valid || busy}
        style={[styles.button, { backgroundColor: valid && !busy ? t.primary : t.border }]}
      >
        {busy ? <ActivityIndicator color={t.onPrimary} /> : <Text style={{ color: t.onPrimary, fontWeight: '700', fontSize: 16 }}>Send code</Text>}
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 24, justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 8 },
  input: { borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 18 },
  button: { marginTop: 20, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
});
