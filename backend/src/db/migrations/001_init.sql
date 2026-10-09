-- Pulse Chat — initial schema (Phase 1, with Phase 2 tables created up-front
-- so Phase 2 does not need a risky data migration).
-- gen_random_uuid() is built in since PostgreSQL 13.

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         text NOT NULL UNIQUE CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  name          text NOT NULL DEFAULT '',
  about         text NOT NULL DEFAULT 'Hey there! I am using Pulse.',
  avatar_url    text,
  last_seen_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- One row per issued refresh token. family_id groups a rotation chain
-- (== one login on one device); reuse of a spent token revokes the family.
CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id    uuid NOT NULL,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   bytea NOT NULL UNIQUE,          -- SHA-256 of the opaque refresh token
  device_name  text,
  platform     text,
  ip           inet,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,                    -- set when rotated
  revoked_at   timestamptz
);
CREATE INDEX sessions_user_idx   ON sessions (user_id);
CREATE INDEX sessions_family_idx ON sessions (family_id);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

CREATE TABLE chats (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type        text NOT NULL CHECK (type IN ('direct', 'group')),
  -- 'minUserId:maxUserId' for direct chats; makes get-or-create race-free.
  direct_key  text UNIQUE,
  title       text,
  avatar_url  text,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  -- Monotonic per-chat sequence. Incremented under row lock => total order per chat.
  last_seq    bigint NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((type = 'direct') = (direct_key IS NOT NULL))
);

CREATE TABLE chat_participants (
  chat_id            uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role               text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  -- Receipt cursors: "everything with seq <= cursor". O(1) writes per receipt,
  -- instead of one row per (message, recipient).
  last_delivered_seq bigint NOT NULL DEFAULT 0,
  last_read_seq      bigint NOT NULL DEFAULT 0,
  joined_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, user_id)
);
CREATE INDEX chat_participants_user_idx ON chat_participants (user_id);

CREATE TABLE messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id       uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  seq           bigint NOT NULL,
  sender_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Client-generated idempotency key: a retried send never creates a duplicate.
  client_msg_id uuid NOT NULL,
  type          text NOT NULL DEFAULT 'text'
                CHECK (type IN ('text', 'image', 'video', 'audio', 'file', 'system')),
  content       text NOT NULL DEFAULT '',
  reply_to      uuid REFERENCES messages(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  UNIQUE (chat_id, seq),
  UNIQUE (chat_id, sender_id, client_msg_id)
);
-- UNIQUE (chat_id, seq) already serves "messages after seq N in chat X" scans.

-- Phase 2 (media sharing). Created now, unused in Phase 1.
CREATE TABLE media (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  uuid REFERENCES messages(id) ON DELETE CASCADE,
  owner_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  object_key  text NOT NULL,            -- MinIO / NAS path, never a public URL
  mime_type   text NOT NULL,
  size_bytes  bigint NOT NULL,
  width       int,
  height      int,
  duration_ms int,
  thumb_key   text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_message_idx ON media (message_id);

CREATE TABLE push_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      text NOT NULL UNIQUE,
  platform   text NOT NULL DEFAULT 'android',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_tokens_user_idx ON push_tokens (user_id);
