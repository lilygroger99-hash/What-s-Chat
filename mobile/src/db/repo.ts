import type { SQLiteDatabase } from 'expo-sqlite';
import type { LocalChat, LocalMessage, LocalParticipant, Receipt, ServerChat, ServerMessage, Tick } from '../types';
import { getDb } from './db';
import { emit } from './events';

// ---------------------------------------------------------------- writes from the network

export async function upsertChats(chats: ServerChat[]): Promise<void> {
  if (!chats.length) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const c of chats) {
      await db.runAsync(
        `INSERT INTO chats (id, type, title, last_seq, unread, my_read_seq, my_delivered_seq, updated_at)
         VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET type=excluded.type, title=excluded.title,
           last_seq=MAX(chats.last_seq, excluded.last_seq),
           my_read_seq=MAX(chats.my_read_seq, excluded.my_read_seq),
           my_delivered_seq=MAX(chats.my_delivered_seq, excluded.my_delivered_seq),
           updated_at=MAX(chats.updated_at, excluded.updated_at)`,
        [c.id, c.type, c.title, c.lastSeq, c.unread, c.myReadSeq, c.myDeliveredSeq, c.updatedAt],
      );
      for (const p of c.participants) {
        await db.runAsync(
          `INSERT INTO participants (chat_id, user_id, name, phone, role, delivered_seq, read_seq, online, last_seen)
           VALUES (?,?,?,?,?,?,?,?,?)
           ON CONFLICT(chat_id, user_id) DO UPDATE SET name=excluded.name, phone=excluded.phone, role=excluded.role,
             delivered_seq=MAX(participants.delivered_seq, excluded.delivered_seq),
             read_seq=MAX(participants.read_seq, excluded.read_seq),
             online=excluded.online, last_seen=excluded.last_seen`,
          [c.id, p.userId, p.name, p.phone, p.role, p.lastDeliveredSeq, p.lastReadSeq, p.online ? 1 : 0, p.lastSeen],
        );
      }
      await recomputeUnread(db, c.id);
    }
  });
  emit('chats');
}

/**
 * Apply server messages (idempotent, any order). Returns chat ids where a gap remains
 * (a seq we know exists but do not hold) so the caller can trigger a targeted re-sync.
 */
export async function applyMessages(msgs: ServerMessage[], myUserId: string): Promise<{ gaps: string[]; touched: string[] }> {
  if (!msgs.length) return { gaps: [], touched: [] };
  const db = await getDb();
  const touched = new Set<string>();
  await db.withTransactionAsync(async () => {
    for (const m of msgs) {
      // Reconcile with our optimistic row (same client_msg_id) or insert a new one.
      await db.runAsync(
        `INSERT INTO messages (client_msg_id, id, chat_id, seq, sender_id, type, content, created_at, state)
         VALUES (?,?,?,?,?,?,?,?, 'sent')
         ON CONFLICT(client_msg_id) DO UPDATE SET id=excluded.id, seq=excluded.seq, created_at=excluded.created_at,
           content=excluded.content, state='sent'`,
        [m.clientMsgId, m.id, m.chatId, m.seq, m.senderId, m.type, m.deleted ? '' : m.content, m.createdAt],
      );
      touched.add(m.chatId);
    }
    for (const chatId of touched) {
      await db.runAsync(
        `UPDATE chats SET last_seq = MAX(last_seq, (SELECT COALESCE(MAX(seq),0) FROM messages WHERE chat_id = ?1)),
           updated_at = MAX(updated_at, (SELECT COALESCE(MAX(created_at),'') FROM messages WHERE chat_id = ?1))
         WHERE id = ?1`,
        [chatId],
      );
      await advanceSyncedSeq(db, chatId);
      await recomputeUnread(db, chatId);
    }
  });

  const gaps: string[] = [];
  for (const chatId of touched) {
    const c = await db.getFirstAsync<LocalChat>('SELECT * FROM chats WHERE id = ?', [chatId]);
    if (c && c.synced_seq < c.last_seq) gaps.push(chatId);
  }
  touched.forEach((id) => emit(`messages:${id}`));
  emit('chats');
  void myUserId;
  return { gaps, touched: [...touched] };
}

/** Walk forward from synced_seq while the next seq is present locally. */
async function advanceSyncedSeq(db: SQLiteDatabase, chatId: string): Promise<void> {
  const c = await db.getFirstAsync<{ synced_seq: number }>('SELECT synced_seq FROM chats WHERE id = ?', [chatId]);
  let synced = c?.synced_seq ?? 0;
  const rows = await db.getAllAsync<{ seq: number }>(
    'SELECT seq FROM messages WHERE chat_id = ? AND seq > ? ORDER BY seq ASC',
    [chatId, synced],
  );
  for (const r of rows) {
    if (r.seq !== synced + 1) break;
    synced = r.seq;
  }
  await db.runAsync('UPDATE chats SET synced_seq = ? WHERE id = ?', [synced, chatId]);
}

async function recomputeUnread(db: SQLiteDatabase, chatId: string): Promise<void> {
  await db.runAsync(
    `UPDATE chats SET unread = (
       SELECT COUNT(*) FROM messages m
        WHERE m.chat_id = chats.id AND m.seq > chats.my_read_seq
          AND m.sender_id <> (SELECT value FROM kv WHERE key = 'me'))
     WHERE id = ?`,
    [chatId],
  );
}

export async function applyReceipts(receipts: Receipt[]): Promise<void> {
  if (!receipts.length) return;
  const db = await getDb();
  const chatIds = new Set<string>();
  await db.withTransactionAsync(async () => {
    for (const r of receipts) {
      await db.runAsync(
        `UPDATE participants SET delivered_seq = MAX(delivered_seq, ?), read_seq = MAX(read_seq, ?)
          WHERE chat_id = ? AND user_id = ?`,
        [r.deliveredSeq, r.readSeq, r.chatId, r.userId],
      );
      chatIds.add(r.chatId);
    }
  });
  chatIds.forEach((id) => emit(`messages:${id}`));
}

export async function setPresence(userId: string, online: boolean, lastSeen: string | null): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE participants SET online = ?, last_seen = COALESCE(?, last_seen) WHERE user_id = ?',
    [online ? 1 : 0, lastSeen, userId],
  );
  emit('chats');
}

export async function setMyCursor(chatId: string, kind: 'read' | 'delivered', seq: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    kind === 'read'
      ? 'UPDATE chats SET my_read_seq = MAX(my_read_seq, ?1), my_delivered_seq = MAX(my_delivered_seq, ?1) WHERE id = ?2'
      : 'UPDATE chats SET my_delivered_seq = MAX(my_delivered_seq, ?1) WHERE id = ?2',
    [seq, chatId],
  );
  if (kind === 'read') await recomputeUnread(db, chatId);
  emit('chats');
}

// ---------------------------------------------------------------- outbox (optimistic sends)

export async function enqueueText(chatId: string, myUserId: string, clientMsgId: string, content: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO messages (client_msg_id, chat_id, sender_id, type, content, created_at, state)
     VALUES (?,?,?,'text',?,?, 'pending')`,
    [clientMsgId, chatId, myUserId, content, new Date().toISOString()],
  );
  await db.runAsync('UPDATE chats SET updated_at = ? WHERE id = ?', [new Date().toISOString(), chatId]);
  emit(`messages:${chatId}`);
  emit('chats');
}

export async function pendingOutbox(): Promise<LocalMessage[]> {
  const db = await getDb();
  return db.getAllAsync<LocalMessage>("SELECT * FROM messages WHERE state = 'pending' ORDER BY created_at ASC");
}

export async function markFailed(clientMsgId: string, chatId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE messages SET state = 'failed' WHERE client_msg_id = ?", [clientMsgId]);
  emit(`messages:${chatId}`);
}

export async function retryFailed(clientMsgId: string, chatId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE messages SET state = 'pending' WHERE client_msg_id = ? AND state = 'failed'", [clientMsgId]);
  emit(`messages:${chatId}`);
}

// ---------------------------------------------------------------- receipts I owe the server

/** Chats where I hold contiguous messages beyond what I last acknowledged as delivered. */
export async function deliveredAcksOwed(): Promise<{ id: string; seq: number }[]> {
  const db = await getDb();
  return db.getAllAsync('SELECT id, synced_seq AS seq FROM chats WHERE synced_seq > my_delivered_seq');
}

export async function readAckOwed(chatId: string): Promise<number | null> {
  const db = await getDb();
  const c = await db.getFirstAsync<LocalChat>('SELECT * FROM chats WHERE id = ?', [chatId]);
  return c && c.synced_seq > c.my_read_seq ? c.synced_seq : null;
}

// ---------------------------------------------------------------- reads

export async function getCursors(): Promise<Record<string, number>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string; synced_seq: number }>('SELECT id, synced_seq FROM chats');
  return Object.fromEntries(rows.map((r) => [r.id, r.synced_seq]));
}

export async function getChat(chatId: string): Promise<LocalChat | null> {
  const db = await getDb();
  return db.getFirstAsync<LocalChat>('SELECT * FROM chats WHERE id = ?', [chatId]);
}

export async function getParticipants(chatId: string): Promise<LocalParticipant[]> {
  const db = await getDb();
  return db.getAllAsync<LocalParticipant>('SELECT * FROM participants WHERE chat_id = ?', [chatId]);
}

export interface ChatListItem extends LocalChat {
  peer_name: string;
  peer_phone: string;
  peer_online: number;
  last_content: string | null;
  last_sender: string | null;
  last_time: string | null;
}

export async function listChats(myUserId: string): Promise<ChatListItem[]> {
  const db = await getDb();
  return db.getAllAsync<ChatListItem>(
    `SELECT c.*,
            COALESCE(p.name, '') AS peer_name, COALESCE(p.phone, '') AS peer_phone, COALESCE(p.online, 0) AS peer_online,
            m.content AS last_content, m.sender_id AS last_sender, m.created_at AS last_time
       FROM chats c
       LEFT JOIN participants p ON p.chat_id = c.id AND p.user_id <> ?1 AND c.type = 'direct'
       LEFT JOIN messages m ON m.client_msg_id = (
              SELECT client_msg_id FROM messages WHERE chat_id = c.id ORDER BY COALESCE(seq, 9007199254740991) DESC, created_at DESC LIMIT 1)
      ORDER BY COALESCE(m.created_at, c.updated_at) DESC`,
    [myUserId],
  );
}

/** Newest `limit` messages, returned oldest -> newest (pending ones, which have no seq, sort last). */
export async function listMessages(chatId: string, limit = 200): Promise<LocalMessage[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<LocalMessage>(
    `SELECT * FROM messages WHERE chat_id = ?
      ORDER BY COALESCE(seq, 9007199254740991) DESC, created_at DESC LIMIT ?`,
    [chatId, limit],
  );
  return rows.reverse();
}

export async function highestIncomingSeq(chatId: string, myUserId: string): Promise<number> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ s: number | null }>(
    'SELECT MAX(seq) AS s FROM messages WHERE chat_id = ? AND sender_id <> ?',
    [chatId, myUserId],
  );
  return r?.s ?? 0;
}

// ---------------------------------------------------------------- kv (current user id for SQL joins)

export async function setMe(userId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("INSERT INTO kv (key, value) VALUES ('me', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [userId]);
}

// ---------------------------------------------------------------- tick calculation

/**
 * Status of one of MY messages, derived from receipt cursors (WhatsApp semantics):
 *   pending(clock) -> sent(✓) -> delivered(✓✓ grey) -> read(✓✓ blue)
 * With several recipients (groups, Phase 2) a tick advances only when ALL of them reached it.
 */
export function tickFor(m: LocalMessage, others: LocalParticipant[]): Tick {
  if (m.state === 'pending') return 'pending';
  if (m.state === 'failed') return 'failed';
  const seq = m.seq ?? Number.MAX_SAFE_INTEGER;
  if (!others.length) return 'sent';
  if (others.every((p) => p.read_seq >= seq)) return 'read';
  if (others.every((p) => p.delivered_seq >= seq)) return 'delivered';
  return 'sent';
}
