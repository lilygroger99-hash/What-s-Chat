import NetInfo from '@react-native-community/netinfo';
import * as Notifications from 'expo-notifications';
import { AppState, type AppStateStatus } from 'react-native';
import { io, type Socket } from 'socket.io-client';
import { create } from 'zustand';
import { api, getAccessToken, refreshAccessToken } from '../api/http';
import { API_URL } from '../config';
import * as repo from '../db/repo';
import type { Receipt, ServerChat, ServerMessage, SyncResult } from '../types';

// ------------------------------------------------------------------ observable UI state
export const useConnection = create<{ state: 'connecting' | 'online' | 'offline' }>(() => ({ state: 'offline' }));

/** chatId -> user ids currently typing. Entries expire on their own (a lost "stop" must not stick). */
export const useTyping = create<{ byChat: Record<string, string[]> }>(() => ({ byChat: {} }));
const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

function setTyping(chatId: string, userId: string, on: boolean) {
  const k = `${chatId}:${userId}`;
  clearTimeout(typingTimers.get(k));
  useTyping.setState((s) => {
    const cur = new Set(s.byChat[chatId] ?? []);
    on ? cur.add(userId) : cur.delete(userId);
    return { byChat: { ...s.byChat, [chatId]: [...cur] } };
  });
  if (on) typingTimers.set(k, setTimeout(() => setTyping(chatId, userId, false), 6000));
}

const PERMANENT_SEND_ERRORS = new Set(['validation_failed', 'not_a_member', 'forbidden', 'chat_not_found']);

/**
 * Owns the socket and everything that must keep working across reconnects:
 *  - catch-up sync (seq cursors) after every (re)connect and on foreground
 *  - outbox flushing (at-least-once send + server idempotency = effectively once)
 *  - delivered/read receipts, presence, typing
 */
class Engine {
  private socket: Socket | null = null;
  private me: string | null = null;
  private activeChat: string | null = null;
  private appActive = AppState.currentState === 'active';
  private cleanups: (() => void)[] = [];

  private syncing = false;
  private syncAgain = false;
  private flushing = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  // ---------------------------------------------------------------- lifecycle
  start(userId: string) {
    if (this.socket && this.me === userId) return;
    this.stop();
    this.me = userId;
    useConnection.setState({ state: 'connecting' });

    const socket = io(API_URL, {
      path: '/socket.io',
      transports: ['websocket'],
      // Called on EVERY (re)connect attempt, so the handshake always carries a fresh token.
      auth: (cb) => {
        getAccessToken()
          .then((token) => cb({ token: token ?? '' }))
          .catch(() => cb({ token: '' }));
      },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 15_000,
      randomizationFactor: 0.5,
      timeout: 10_000,
    });
    this.socket = socket;

    socket.on('connect', () => {
      useConnection.setState({ state: 'online' });
      void this.sync().then(() => this.flushOutbox());
      void this.refreshChatMeta();
    });
    socket.on('disconnect', () => useConnection.setState({ state: 'offline' }));
    socket.on('connect_error', (err: Error & { data?: { code?: string } }) => {
      useConnection.setState({ state: 'offline' });
      const code = err.data?.code ?? err.message;
      // Server rejected our token (expired/revoked): force a refresh so the next attempt succeeds.
      if (code === 'token_expired' || code === 'invalid_token') void refreshAccessToken().catch(() => {});
    });
    socket.on('auth:expired', () => {
      void refreshAccessToken()
        .then(() => {
          socket.disconnect();
          socket.connect();
        })
        .catch(() => {});
    });

    socket.on('message:new', (m: ServerMessage) => void this.onMessage(m));
    socket.on('receipt:update', (r: Receipt) => void this.onReceipt(r));
    socket.on('typing', (p: { chatId: string; userId: string; isTyping: boolean }) => setTyping(p.chatId, p.userId, p.isTyping));
    socket.on('presence', (p: { userId: string; online: boolean; lastSeen: string | null }) =>
      void repo.setPresence(p.userId, p.online, p.lastSeen),
    );

    // Lifecycle hooks
    const appSub = AppState.addEventListener('change', (s: AppStateStatus) => {
      this.appActive = s === 'active';
      if (!this.appActive) return;
      if (!socket.connected) socket.connect();
      else void this.sync().then(() => this.flushOutbox());
      if (this.activeChat) void this.markRead(this.activeChat);
    });
    const netUnsub = NetInfo.addEventListener((n) => {
      if (n.isConnected && n.isInternetReachable !== false && !socket.connected) socket.connect();
    });
    this.cleanups.push(() => appSub.remove(), netUnsub);
  }

  stop() {
    this.cleanups.forEach((c) => c());
    this.cleanups = [];
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
    this.me = null;
    useConnection.setState({ state: 'offline' });
  }

  // ---------------------------------------------------------------- helpers
  private call<T>(event: string, payload: unknown, timeoutMs = 8000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const s = this.socket;
      if (!s?.connected) return reject(new Error('offline'));
      s.timeout(timeoutMs).emit(event, payload, (err: Error | null, res: T) => (err ? reject(err) : resolve(res)));
    });
  }

  // ---------------------------------------------------------------- catch-up sync
  /**
   * Pull everything newer than our contiguous cursors. Single-flight; calls arriving mid-flight
   * set a flag so exactly one more pass runs (no lost wake-ups, no stampede).
   */
  async sync(): Promise<void> {
    if (!this.me) return;
    if (this.syncing) {
      this.syncAgain = true;
      return;
    }
    this.syncing = true;
    try {
      do {
        this.syncAgain = false;
        for (;;) {
          const cursors = await repo.getCursors();
          const res = await this.call<SyncResult & { ok: boolean }>('sync', { cursors }, 20_000);
          if (!res.ok) break;
          await repo.upsertChats(res.chats);
          await repo.applyMessages(res.messages, this.me);
          await repo.applyReceipts(res.receipts);
          if (!res.hasMore || res.messages.length === 0) break;
        }
        await this.ackDelivered();
        if (this.activeChat && this.appActive) await this.markRead(this.activeChat);
      } while (this.syncAgain);
    } catch {
      /* offline or timed out: the next connect/foreground event retries */
    } finally {
      this.syncing = false;
    }
  }

  /** Refresh participant names / presence / last seen (not covered by seq cursors). */
  private async refreshChatMeta() {
    try {
      const { chats } = await api<{ chats: ServerChat[] }>('GET', '/v1/chats');
      await repo.upsertChats(chats);
    } catch {
      /* non-critical */
    }
  }

  // ---------------------------------------------------------------- incoming
  private async onMessage(m: ServerMessage) {
    if (!this.me) return;
    if (!(await repo.getChat(m.chatId))) return void this.sync(); // chat we have never seen: sync fetches it whole
    const { gaps } = await repo.applyMessages([m], this.me);
    if (gaps.length) {
      void this.sync(); // seq jump => something was missed; close the gap
      return;
    }
    if (m.senderId === this.me) return;
    await this.ackDelivered();
    if (this.activeChat === m.chatId && this.appActive) await this.markRead(m.chatId);
    else if (!this.appActive || this.activeChat !== m.chatId) void this.notifyLocal(m);
  }

  private async onReceipt(r: Receipt) {
    await repo.applyReceipts([r]);
    // Another device of mine read the chat: mirror it so unread badges agree everywhere.
    if (r.userId === this.me) {
      await repo.setMyCursor(r.chatId, 'delivered', r.deliveredSeq);
      if (r.readSeq > 0) await repo.setMyCursor(r.chatId, 'read', r.readSeq);
    }
  }

  private async ackDelivered() {
    for (const { id, seq } of await repo.deliveredAcksOwed()) {
      try {
        await this.call('message:delivered', { chatId: id, upToSeq: seq });
        await repo.setMyCursor(id, 'delivered', seq);
      } catch {
        return; // offline; owed acks are recomputed from the DB on the next sync
      }
    }
  }

  private async notifyLocal(m: ServerMessage) {
    try {
      const parts = await repo.getParticipants(m.chatId);
      const sender = parts.find((p) => p.user_id === m.senderId);
      await Notifications.scheduleNotificationAsync({
        content: {
          title: sender?.name || sender?.phone || 'New message',
          body: m.content.slice(0, 200),
          data: { chatId: m.chatId },
        },
        trigger: null,
      });
    } catch {
      /* notification permission not granted */
    }
  }

  // ---------------------------------------------------------------- public API for screens
  setActiveChat(chatId: string | null) {
    this.activeChat = chatId;
    if (chatId) void this.markRead(chatId);
  }

  async markRead(chatId: string) {
    const seq = await repo.readAckOwed(chatId);
    if (seq === null || !this.appActive) return;
    try {
      await this.call('message:read', { chatId, upToSeq: seq });
      await repo.setMyCursor(chatId, 'read', seq);
    } catch {
      /* retried when the chat is next opened / on next sync */
    }
  }

  sendTyping(chatId: string, isTyping: boolean) {
    if (this.socket?.connected) this.socket.emit('typing', { chatId, isTyping });
  }

  /** Optimistic send: write to the local outbox first (instant UI), then try the network. */
  async sendText(chatId: string, text: string, clientMsgId: string) {
    if (!this.me) return;
    await repo.enqueueText(chatId, this.me, clientMsgId, text);
    void this.flushOutbox();
  }

  async retry(clientMsgId: string, chatId: string) {
    await repo.retryFailed(clientMsgId, chatId);
    void this.flushOutbox();
  }

  /**
   * Send pending messages strictly in creation order, one at a time. On any transient problem
   * we stop (preserving order) and retry later; the server dedupes by clientMsgId, so a message
   * whose ack was lost is simply resent and acknowledged again.
   */
  async flushOutbox() {
    if (this.flushing || !this.socket?.connected || !this.me) return;
    this.flushing = true;
    let retryInMs = 0;
    try {
      for (const m of await repo.pendingOutbox()) {
        let res: { ok: boolean; message?: ServerMessage; error?: string; retryAfterSec?: number };
        try {
          res = await this.call('message:send', {
            chatId: m.chat_id,
            clientMsgId: m.client_msg_id,
            type: 'text',
            content: m.content,
          });
        } catch {
          retryInMs = 3000; // timeout / disconnect
          break;
        }
        if (res.ok && res.message) {
          await repo.applyMessages([res.message], this.me);
        } else if (res.error && PERMANENT_SEND_ERRORS.has(res.error)) {
          await repo.markFailed(m.client_msg_id, m.chat_id);
        } else {
          retryInMs = Math.max(3000, (res.retryAfterSec ?? 0) * 1000);
          break;
        }
      }
    } finally {
      this.flushing = false;
    }
    if (retryInMs) {
      this.flushTimer && clearTimeout(this.flushTimer);
      this.flushTimer = setTimeout(() => void this.flushOutbox(), retryInMs);
    }
  }
}

export const engine = new Engine();
