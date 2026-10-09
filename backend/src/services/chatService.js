import { query, withTx } from '../db/pool.js';
import { badRequest, forbidden, notFound } from '../utils/errors.js';
import { messageDto } from './dto.js';
import * as presence from './presence.js';

// ------------------------------------------------------------------ membership cache
// Hot path (typing indicators, receipts) must not hit Postgres on every event.
// Entries live 30 s: a removed group member could keep emitting typing for <=30 s (Phase 2 note).
const MEMBER_TTL_MS = 30_000;
const memberCache = new Map(); // chatId -> { ids: string[], exp: number }

export async function chatMembers(chatId) {
  const hit = memberCache.get(chatId);
  if (hit && hit.exp > Date.now()) return hit.ids;
  const { rows } = await query('SELECT user_id FROM chat_participants WHERE chat_id = $1', [chatId]);
  const ids = rows.map((r) => r.user_id);
  if (memberCache.size > 20_000) memberCache.clear();
  memberCache.set(chatId, { ids, exp: Date.now() + MEMBER_TTL_MS });
  return ids;
}

export const invalidateMembers = (chatId) => memberCache.delete(chatId);

export async function assertMember(userId, chatId) {
  const ids = await chatMembers(chatId);
  if (!ids.includes(userId)) throw forbidden('not_a_member');
  return ids;
}

// ------------------------------------------------------------------ direct chats
const directKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);

export async function getOrCreateDirectChat(userId, peerId) {
  if (userId === peerId) throw badRequest('cannot_chat_with_self');
  const peer = await query('SELECT 1 FROM users WHERE id = $1', [peerId]);
  if (!peer.rowCount) throw notFound('user_not_found');

  const chatId = await withTx(async (c) => {
    // direct_key UNIQUE makes concurrent creates by both sides converge on one row.
    const ins = await c.query(
      `INSERT INTO chats (type, direct_key, created_by) VALUES ('direct', $1, $2)
       ON CONFLICT (direct_key) DO NOTHING RETURNING id`,
      [directKey(userId, peerId), userId],
    );
    if (ins.rowCount) {
      await c.query(
        `INSERT INTO chat_participants (chat_id, user_id, role) VALUES ($1,$2,'member'),($1,$3,'member')`,
        [ins.rows[0].id, userId, peerId],
      );
      return ins.rows[0].id;
    }
    return (await c.query('SELECT id FROM chats WHERE direct_key = $1', [directKey(userId, peerId)])).rows[0].id;
  });
  return getChatForUser(userId, chatId);
}

// ------------------------------------------------------------------ chat list
const CHAT_SELECT = `
  SELECT c.id, c.type, c.title, c.avatar_url, c.last_seq, c.updated_at,
         me.last_read_seq AS my_read_seq, me.last_delivered_seq AS my_delivered_seq,
         (SELECT count(*) FROM messages m
           WHERE m.chat_id = c.id AND m.seq > me.last_read_seq AND m.sender_id <> me.user_id) AS unread,
         (SELECT row_to_json(lm) FROM (
            SELECT id, chat_id, seq, sender_id, client_msg_id, type, content, reply_to, created_at, deleted_at
            FROM messages WHERE chat_id = c.id ORDER BY seq DESC LIMIT 1) lm) AS last_message,
         (SELECT json_agg(json_build_object(
                   'userId', u.id, 'name', u.name, 'phone', u.phone, 'avatarUrl', u.avatar_url,
                   'about', u.about, 'role', p.role, 'lastSeen', u.last_seen_at,
                   'lastDeliveredSeq', p.last_delivered_seq, 'lastReadSeq', p.last_read_seq))
            FROM chat_participants p JOIN users u ON u.id = p.user_id
            WHERE p.chat_id = c.id) AS participants
    FROM chat_participants me
    JOIN chats c ON c.id = me.chat_id`;

function chatDto(row, online) {
  const participants = (row.participants ?? []).map((p) => ({ ...p, online: online?.get(p.userId) ?? false }));
  const lm = row.last_message;
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    avatarUrl: row.avatar_url,
    lastSeq: row.last_seq,
    updatedAt: new Date(row.updated_at).toISOString(),
    unread: Number(row.unread),
    myReadSeq: row.my_read_seq,
    myDeliveredSeq: row.my_delivered_seq,
    lastMessage: lm ? messageDto({ ...lm, created_at: lm.created_at, deleted_at: lm.deleted_at }) : null,
    participants,
  };
}

async function withPresence(rows) {
  const ids = [...new Set(rows.flatMap((r) => (r.participants ?? []).map((p) => p.userId)))];
  const online = ids.length ? await presence.onlineMap(ids) : new Map();
  return rows.map((r) => chatDto(r, online));
}

export async function listChats(userId) {
  const { rows } = await query(`${CHAT_SELECT} WHERE me.user_id = $1 ORDER BY c.updated_at DESC LIMIT 500`, [userId]);
  return withPresence(rows);
}

export async function getChatForUser(userId, chatId) {
  const { rows } = await query(`${CHAT_SELECT} WHERE me.user_id = $1 AND c.id = $2`, [userId, chatId]);
  if (!rows.length) throw notFound('chat_not_found');
  return (await withPresence(rows))[0];
}

/** Ids of every user that shares at least one chat with `userId` (presence fan-out targets). */
export async function peerIds(userId) {
  const { rows } = await query(
    `SELECT DISTINCT p2.user_id FROM chat_participants p1
       JOIN chat_participants p2 ON p2.chat_id = p1.chat_id AND p2.user_id <> p1.user_id
      WHERE p1.user_id = $1`,
    [userId],
  );
  return rows.map((r) => r.user_id);
}
