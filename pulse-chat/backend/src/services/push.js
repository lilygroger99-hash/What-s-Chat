import { env } from '../config/env.js';
import { query } from '../db/pool.js';
import { logger } from '../utils/logger.js';

/**
 * Push is used only as a doorbell: the payload is a generic "New message" plus the chat id.
 * Message text, sender name and phone numbers NEVER transit Google's servers. The app
 * connects, syncs over your own WSS endpoint, and renders the content locally.
 */
let messagingPromise = null;

async function getMessaging() {
  if (!env.PUSH_ENABLED || !env.FCM_SERVICE_ACCOUNT_PATH) return null;
  messagingPromise ??= (async () => {
    try {
      const { readFile } = await import('node:fs/promises');
      const admin = (await import('firebase-admin')).default;
      const cred = JSON.parse(await readFile(env.FCM_SERVICE_ACCOUNT_PATH, 'utf8'));
      const app = admin.initializeApp({ credential: admin.credential.cert(cred) });
      return admin.messaging(app);
    } catch (err) {
      logger.error({ err: err.message }, 'FCM init failed; push disabled');
      return null;
    }
  })();
  return messagingPromise;
}

export async function notifyNewMessage({ userId, chatId }) {
  const messaging = await getMessaging();
  if (!messaging) return;
  const { rows } = await query('SELECT token FROM push_tokens WHERE user_id = $1', [userId]);
  if (!rows.length) return;
  const res = await messaging.sendEachForMulticast({
    tokens: rows.map((r) => r.token),
    notification: { title: 'Pulse', body: 'New message' },
    data: { type: 'new_message', chatId },
    android: { priority: 'high', collapseKey: chatId, notification: { channelId: 'messages', tag: chatId } },
  });
  // Prune tokens FCM says are dead.
  const dead = [];
  res.responses.forEach((r, i) => {
    const code = r.error?.code;
    if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
      dead.push(rows[i].token);
    }
  });
  if (dead.length) await query('DELETE FROM push_tokens WHERE token = ANY($1)', [dead]);
}

export const pushTokens = {
  async register(userId, token, platform = 'android') {
    // A token belongs to exactly one user (handles account switch on the same device).
    await query(
      `INSERT INTO push_tokens (user_id, token, platform) VALUES ($1,$2,$3)
       ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, updated_at = now()`,
      [userId, token, platform],
    );
  },
  async remove(userId, token) {
    await query('DELETE FROM push_tokens WHERE user_id = $1 AND token = $2', [userId, token]);
  },
};
