import { create } from 'zustand';
import { api, publicApi, setSessionLostHandler } from '../api/http';
import { resetDb } from '../db/db';
import { setMe } from '../db/repo';
import { engine } from '../realtime/engine';
import type { AuthResult, User } from '../types';
import * as tokens from './tokenStore';

interface SessionState {
  status: 'loading' | 'signedOut' | 'signedIn';
  user: User | null;
  bootstrap: () => Promise<void>;
  requestOtp: (phone: string, email?: string) => Promise<void>;
  verifyOtp: (phone: string, code: string) => Promise<AuthResult>;
  updateProfile: (name: string, about?: string) => Promise<void>;
  logout: (sessionAlreadyDead?: boolean) => Promise<void>;
}

export const useSession = create<SessionState>((set, get) => ({
  status: 'loading',
  user: null,

  async bootstrap() {
    setSessionLostHandler(() => void get().logout(true));
    try {
      const raw = await tokens.loadUser();
      if (raw && (await tokens.getRefreshToken())) {
        const user = JSON.parse(raw) as User;
        await setMe(user.id);
        set({ status: 'signedIn', user });
        engine.start(user.id);
        return;
      }
    } catch {
      /* fall through to signed out */
    }
    set({ status: 'signedOut', user: null });
  },

  async requestOtp(phone, email) {
    await publicApi('POST', '/v1/auth/otp/request', { phone, ...(email ? { email } : {}) });
  },

  async verifyOtp(phone, code) {
    const r = await publicApi<AuthResult>('POST', '/v1/auth/otp/verify', {
      phone,
      code,
      device: { name: 'Android', platform: 'android' },
    });
    // Account switch on the same device: never show the previous user's chats.
    const prev = get().user;
    if (prev && prev.id !== r.user.id) await resetDb();
    await tokens.saveTokens(r.accessToken, r.refreshToken, r.expiresIn);
    await tokens.saveUser(JSON.stringify(r.user));
    await setMe(r.user.id);
    set({ status: 'signedIn', user: r.user });
    engine.start(r.user.id);
    return r;
  },

  async updateProfile(name, about) {
    const user = await api<User>('PATCH', '/v1/me', { name, ...(about ? { about } : {}) });
    await tokens.saveUser(JSON.stringify(user));
    set({ user });
  },

  async logout(sessionAlreadyDead = false) {
    engine.stop();
    try {
      const rt = await tokens.getRefreshToken();
      if (rt && !sessionAlreadyDead) await api('POST', '/v1/auth/logout', { refreshToken: rt }).catch(() => {});
    } finally {
      await tokens.clear();
      await resetDb();
      set({ status: 'signedOut', user: null });
    }
  },
}));
