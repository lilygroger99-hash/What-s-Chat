import { query, withTx } from '../db/pool.js';
import { forbidden } from '../utils/errors.js';
import { messageDto } from './dto.js';
import { getChatForUser } from './chatService.js';

const MSG_COLS = 'id, chat_id, seq, sender_id, client_msg_id, type, content, reply_to, created_at, deleted_at';

/**
 * Persist a message and assign it the next per-chat sequence number.
 *
 * Ordering guarantee: `SELECT ... FOR UPDATE` on the chat row serialises all senders of
 * that chat; seq is allocated and the message inserted inside that critical section, and
 * the lock is held until COMMIT. Therefore commit order == seq order, with no gaps visible
 * to readers (a rolled-back transaction never consumed a seq because the increment is
 * rolled back with it).
 *
 * Idempotency: (chat_id, sender_id, client_msg_id) is unique and checked under the same
 * lock, so a client retry after a lost ack returns the original row.
 */
export async function sendMessage({ senderId, chatId, clientMsgId, type = 'text', content, replyTo = null }) {
  return withTx(async (c) => {
    const lock = await c.query(
      `SELECT c.last_seq FROM chats c
         JOIN chat_participants p ON p.chat_id = c.id AND p.user_id = $2
        WHERE c.id = $1 FOR UPDATE OF c`,
      [chatId, senderId],
    );
    if (!lock.rowCount) throw forbidden('not_a_member');

    const dup = await c.query(
      `SELECT ${MSG_COLS} FROM messages WHERE chat_id = $1 AND sender_id = $2 AND client_msg_id = $3`,
      [chatId, senderId, clientMsgId],
    );
    if (dup.rowCount) return { message: messageDto(dup.rows[0]), duplicate: true };

    const seq = lock.rows[0].last_seq + 1;
    const ins = await c.query(
      `INSERT INTO messages (chat_id, seq, sender_id, client_msg_id, type, content, reply_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${MSG_COLS}`,
      [chatId, seq, senderId, clientMsgId, type, content, replyTo],
    );
    await c.query('UPDATE chats SET last_seq = $2, updated_at = now() WHERE id = $1', [chatId, seq]);
    // Sending implies the sender has seen everything up to here on this chat.
    await c.query(
      `UPDATE chat_participants
          SET last_delivered_seq = GREATEST(last_delivered_seq, $3), last_read_seq = GREATEST(last_read_seq, $3)
        WHERE chat_id = $1 AND user_id = $2`,
      [chatId, senderId, seq],
    );
    return { message: messageDto(ins.rows[0]), duplicate: false };
  });
}

/** Page backwards through history: newest `limit` messages with seq < beforeSeq. Returned ascending. */
export async function listMessages({ userId, chatId, beforeSeq, afterSeq, limit }) {
  await assertMemberDb(userId, chatId);
  let rows;
  if (afterSeq != null) {
    ({ rows } = await query(
      `SELECT ${MSG_COLS} FROM messages WHERE chat_id = $1 AND seq > $2 ORDER BY seq ASC LIMIT $3`,
      [chatId, afterSeq, limit],
    ));
  } else {
    ({ rows } = await query(
      `SELECT ${MSG_COLS} FROM messages WHERE chat_id = $1 AND ($2::bigint IS NULL OR seq < $2)
        ORDER BY seq DESC LIMIT $3`,
      [chatId, beforeSeq ?? null, limit],
    ));
    rows.reverse();
  }
  return rows.map(messageDto);
}

async function assertMemberDb(userId, chatId) {
  const r = await query('SELECT 1 FROM chat_participants WHERE chat_id = $1 AND user_id = $2', [chatId, userId]);
  if (!r.rowCount) throw forbidden('not_a_member');
}

/**
 * Advance a receipt cursor. Monotonic (never moves backwards) and clamped to chat.last_seq.
 * Returns the updated cursors, or null if nothing changed (so callers can skip the broadcast).
 */
export async function advanceReceipt({ userId, chatId, kind, upToSeq }) {
  const sql =
    kind === 'read'
      ? `UPDATE chat_participants p
            SET last_read_seq = LEAST($3::bigint, c.last_seq),
                last_delivered_seq = GREATEST(p.last_delivered_seq, LEAST($3::bigint, c.last_seq))
           FROM chats c
          WHERE c.id = p.chat_id AND p.chat_id = $1 AND p.user_id = $2 AND p.last_read_seq < LEAST($3::bigint, c.last_seq)
        RETURNING p.last_delivered_seq, p.last_read_seq`
      : `UPDATE chat_participants p
            SET last_delivered_seq = LEAST($3::bigint, c.last_seq)
           FROM chats c
          WHERE c.id = p.chat_id AND p.chat_id = $1 AND p.user_id = $2 AND p.last_delivered_seq < LEAST($3::bigint, c.last_seq)
        RETURNING p.last_delivered_seq, p.last_read_seq`;
  const { rows } = await query(sql, [chatId, userId, upToSeq]);
  if (!rows.length) return null;
  return { chatId, userId, deliveredSeq: rows[0].last_delivered_seq, readSeq: rows[0].last_read_seq };
}

/**
 * Catch-up after (re)connect or push wake-up.
 *
 * `cursors` maps chatId -> highest seq the client already holds contiguously.
 * Returns, bounded by `budget` messages:
 *   - messages with seq > cursor, per chat, ascending
 *   - chats the client has never seen (full chat DTO so it can render them)
 *   - the receipt cursors of every participant of the user's chats (fixes stale ticks)
 *   - hasMore: call again with advanced cursors until false
 */
export async function syncForUser({ userId, cursors = {}, budget = 500 }) {
  const mine = await query(
    `SELECT c.id, c.last_seq FROM chat_participants p JOIN chats c ON c.id = p.chat_id WHERE p.user_id = $1`,
    [userId],
  );

  const messages = [];
  const newChats = [];
  let remaining = budget;
  let hasMore = false;

  for (const { id, last_seq: lastSeq } of mine.rows) {
    const known = cursors[id];
    if (known === undefined) newChats.push(id);
    const from = known ?? 0;
    if (lastSeq <= from) continue;
    if (remaining <= 0) {
      hasMore = true;
      continue;
    }
    const { rows } = await query(
      `SELECT ${MSG_COLS} FROM messages WHERE chat_id = $1 AND seq > $2 ORDER BY seq ASC LIMIT $3`,
      [id, from, remaining],
    );
    messages.push(...rows.map(messageDto));
    remaining -= rows.length;
    if (rows.length && rows[rows.length - 1].seq < lastSeq) hasMore = true;
  }

  const chats = await Promise.all(newChats.map((id) => getChatForUser(userId, id)));

  const rc = await query(
    `SELECT p.chat_id, p.user_id, p.last_delivered_seq, p.last_read_seq
       FROM chat_participants p
      WHERE p.chat_id = ANY($1::uuid[])`,
    [mine.rows.map((r) => r.id)],
  );
  const receipts = rc.rows.map((r) => ({
    chatId: r.chat_id,
    userId: r.user_id,
    deliveredSeq: r.last_delivered_seq,
    readSeq: r.last_read_seq,
  }));

  return { messages, chats, receipts, hasMore };
}
