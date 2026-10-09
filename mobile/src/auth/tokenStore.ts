import * as SecureStore from 'expo-secure-store';

// Android Keystore-backed. Access token is cached in memory too so hot paths avoid async I/O.
const K = { access: 'pulse.access', refresh: 'pulse.refresh', exp: 'pulse.exp', user: 'pulse.user' };

let memAccess: string | null = null;
let memExp = 0;

export async function saveTokens(access: string, refresh: string, expiresInSec: number): Promise<void> {
  memAccess = access;
  memExp = Date.now() + expiresInSec * 1000;
  await Promise.all([
    SecureStore.setItemAsync(K.access, access),
    SecureStore.setItemAsync(K.refresh, refresh),
    SecureStore.setItemAsync(K.exp, String(memExp)),
  ]);
}

export async function getAccessToken(): Promise<string | null> {
  if (memAccess) return memAccess;
  memAccess = await SecureStore.getItemAsync(K.access);
  memExp = Number(await SecureStore.getItemAsync(K.exp)) || 0;
  return memAccess;
}

export const isExpiringSoon = (): boolean => Date.now() > memExp - 60_000;
export const getRefreshToken = () => SecureStore.getItemAsync(K.refresh);

export const saveUser = (json: string) => SecureStore.setItemAsync(K.user, json);
export const loadUser = () => SecureStore.getItemAsync(K.user);

export async function clear(): Promise<void> {
  memAccess = null;
  memExp = 0;
  await Promise.all(Object.values(K).map((k) => SecureStore.deleteItemAsync(k)));
}
