import { redis } from '../redis.js';
import { query } from '../db/pool.js';

/**
 * Presence = a Redis sorted set per user: member = socketId, score = expiry (ms).
 * Each live socket refreshes its score on a heartbeat, so a crashed app instance or a
 * dead NAS connection can never leave a user "online" forever (a plain counter would).
 */
const key = (userId) => `presence:${userId}`;
export const PRESENCE_TTL_MS = 60_000;
export const HEARTBEAT_MS = 25_000;

export async function touch(userId, socketId) {
  const now = Date.now();
  await redis
    .multi()
    .zremrangebyscore(key(userId), '-inf', now)
    .zadd(key(userId), now + PRESENCE_TTL_MS, socketId)
    .pexpire(key(userId), PRESENCE_TTL_MS * 2)
    .exec();
}

/** Returns true if this was the user's first live connection (offline -> online transition). */
export async function connect(userId, socketId) {
  const was = await isOnline(userId);
  await touch(userId, socketId);
  return !was;
}

/** Returns true if this was the user's last live connection (online -> offline transition). */
export async function disconnect(userId, socketId) {
  await redis.zrem(key(userId), socketId);
  const online = await isOnline(userId);
  if (!online) {
    await query('UPDATE users SET last_seen_at = now() WHERE id = $1', [userId]);
    return true;
  }
  return false;
}

export async function isOnline(userId) {
  const now = Date.now();
  await redis.zremrangebyscore(key(userId), '-inf', now);
  return (await redis.zcard(key(userId))) > 0;
}

export async function onlineMap(userIds) {
  const now = Date.now();
  const pipe = redis.pipeline();
  for (const id of userIds) pipe.zcount(key(id), now, '+inf');
  const res = await pipe.exec();
  return new Map(userIds.map((id, i) => [id, res[i][1] > 0]));
}
