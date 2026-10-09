import * as SQLite from 'expo-sqlite';

/**
 * Local database = the UI's single source of truth. Screens never render network responses
 * directly: network -> repo writes -> change events -> live queries -> UI. That is what makes
 * offline reading, optimistic sends, and crash recovery work with one code path.
 */
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

const MIGRATIONS: string[] = [
  // v1
  `
  CREATE TABLE chats (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT,
    last_seq INTEGER NOT NULL DEFAULT 0,        -- highest seq the server has told us about
    synced_seq INTEGER NOT NULL DEFAULT 0,      -- highest seq such that 1..synced_seq are ALL held locally
    unread INTEGER NOT NULL DEFAULT 0,
    my_read_seq INTEGER NOT NULL DEFAULT 0,
    my_delivered_seq INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE participants (
    chat_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'member',
    delivered_seq INTEGER NOT NULL DEFAULT 0,
    read_seq INTEGER NOT NULL DEFAULT 0,
    online INTEGER NOT NULL DEFAULT 0,
    last_seen TEXT,
    PRIMARY KEY (chat_id, user_id)
  );
  -- client_msg_id is the stable local key and doubles as the server idempotency key,
  -- so a message row IS its own outbox entry while state = 'pending'.
  CREATE TABLE messages (
    client_msg_id TEXT PRIMARY KEY,
    id TEXT,
    chat_id TEXT NOT NULL,
    seq INTEGER,
    sender_id TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'text',
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'sent'
  );
  CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE UNIQUE INDEX messages_chat_seq ON messages (chat_id, seq) WHERE seq IS NOT NULL;
  CREATE INDEX messages_chat_time ON messages (chat_id, created_at);
  CREATE INDEX messages_pending ON messages (state, created_at) WHERE state = 'pending';
  `,
];

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  dbPromise ??= (async () => {
    const db = await SQLite.openDatabaseAsync('pulse.db');
    await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    let version = row?.user_version ?? 0;
    for (; version < MIGRATIONS.length; version++) {
      await db.withExclusiveTransactionAsync(async (txn) => {
        await txn.execAsync(MIGRATIONS[version]);
        await txn.execAsync(`PRAGMA user_version = ${version + 1}`);
      });
    }
    return db;
  })();
  return dbPromise;
}

/** Wipe all user data (logout / account switch). */
export async function resetDb(): Promise<void> {
  const db = await getDb();
  await db.execAsync('DELETE FROM messages; DELETE FROM participants; DELETE FROM chats; DELETE FROM kv;');
}
