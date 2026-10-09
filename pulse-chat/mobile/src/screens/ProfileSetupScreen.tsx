import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession } from '../auth/session';
import { useTheme } from '../ui/theme';

export function ProfileSetupScreen() {
  const t = useTheme();
  const updateProfile = useSession((s) => s.updateProfile);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await updateProfile(name.trim());
    } catch {
      setError('Could not save your name. Try again.');
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: t.bg }]}>
      <Text style={[styles.title, { color: t.text }]}>Your name</Text>
      <Text style={{ color: t.textDim, marginBottom: 24 }}>This is how people will see you.</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        maxLength={60}
        autoFocus
        placeholder="Name"
        placeholderTextColor={t.textDim}
        style={[styles.input, { backgroundColor: t.surface, color: t.text }]}
      />
      {error ? <Text style={{ color: t.danger, marginTop: 12 }}>{error}</Text> : null}
      <Pressable
        onPress={save}
        disabled={!name.trim() || busy}
        style={[styles.button, { backgroundColor: name.trim() && !busy ? t.primary : t.border }]}
      >
        {busy ? <ActivityIndicator color={t.onPrimary} /> : <Text style={{ color: t.onPrimary, fontWeight: '700', fontSize: 16 }}>Continue</Text>}
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
