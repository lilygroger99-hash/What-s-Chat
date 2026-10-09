import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { env } from '../config/env.js';
import { authenticateToken } from '../middleware/auth.js';
import { consume, makeLimiter } from '../middleware/rateLimit.js';
import { makePubSub } from '../redis.js';
import * as s from '../routes/schemas.js';
import * as chats from '../services/chatService.js';
import * as messages from '../services/messageService.js';
import * as presence from '../services/presence.js';
import { notifyNewMessage } from '../services/push.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export const userRoom = (userId) => `user:${userId}`;

const sendLimiter = makeLimiter({ prefix: 'sock_send', points: 30, duration: 10 }); // 3 msg/s sustained
const typingLimiter = makeLimiter({ prefix: 'sock_typing', points: 20, duration: 10 });
const receiptLimiter = makeLimiter({ prefix: 'sock_receipt', points: 60, duration: 10 });
const syncLimiter = makeLimiter({ prefix: 'sock_sync', points: 20, duration: 60 });
const connectLimiter = makeLimiter({ prefix: 'sock_connect', points: 30, duration: 60 });

export function createRealtime(httpServer) {
  const io = new Server(httpServer, {
    path: '/socket.io',
    serveClient: false,
    cors: { origin: env.CORS_ORIGINS ? env.CORS_ORIGINS.split(',') : false },
    // Detect dead mobile connections quickly, but tolerate flaky links.
    pingInterval: 20_000,
    pingTimeout: 25_000,
    maxHttpBufferSize: 64 * 1024, // text only in Phase 1; media goes over HTTP
    transports: ['websocket'], // WebSocket only => no sticky sessions needed when running several replicas
  });

  const { pub, sub } = makePubSub();
  io.adapter(createAdapter(pub, sub));

  // ------------------------------------------------------------ auth
  io.use(async (socket, next) => {
    try {
      await consume(connectLimiter, socket.handshake.address);
      const token = socket.handshake.auth?.token;
      if (typeof token !== 'string') return next(new AppError(401, 'missing_token'));
      const claims = await authenticateToken(token);
      socket.data.userId = claims.userId;
      socket.data.familyId = claims.familyId;
      socket.data.exp = claims.exp;
      next();
    } catch (err) {
      next(Object.assign(new Error(err.code ?? 'unauthorized'), { data: { code: err.code ?? 'unauthorized' } }));
    }
  });

  io.on('connection', (socket) => onConnection(io, socket).catch((err) => {
    logger.error({ err }, 'connection setup failed');
    socket.disconnect(true);
  }));

  return io;
}

async function onConnection(io, socket) {
  const { userId } = socket.data;
  const log = logger.child({ userId, sid: socket.id });
  socket.join(userRoom(userId));

  // Access tokens are short lived: tell the client to refresh + reconnect instead of
  // letting a long-lived socket outlive its credential (and a revoked session).
  const ttl = Math.max(1000, socket.data.exp * 1000 - Date.now());
  const expiryTimer = setTimeout(() => {
    socket.emit('auth:expired');
    setTimeout(() => socket.disconnect(true), 2000).unref();
  }, ttl);

  // IMPORTANT: no `await` may precede handler registration below. Socket.io delivers events the
  // moment the client sees 'connect'; a handler attached after an await would silently miss an
  // immediate client emit (e.g. the first `sync`). Presence work therefore runs in the background.
  const connected = presence.connect(userId, socket.id);
  const heartbeat = setInterval(() => presence.touch(userId, socket.id).catch(() => {}), presence.HEARTBEAT_MS);
  connected
    .then((cameOnline) => cameOnline && broadcastPresence(io, userId, true))
    .catch((err) => log.error({ err }, 'presence connect failed'));

  /** Wrap a handler: validate payload, rate limit, ack {ok,...} / {ok:false,error}. */
  const on = (event, schema, limiter, handler) =>
    socket.on(event, async (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        if (limiter) await consume(limiter, userId);
        const parsed = schema.safeParse(payload);
        if (!parsed.success) throw new AppError(400, 'validation_failed', parsed.error.issues[0]?.message);
        reply({ ok: true, ...(await handler(parsed.data)) });
      } catch (err) {
        if (!(err instanceof AppError)) log.error({ err, event }, 'socket handler error');
        reply({ ok: false, error: err instanceof AppError ? err.code : 'internal_error', retryAfterSec: err.retryAfterSec });
      }
    });

  // ---------------------------------------------------------- message:send
  on('message:send', s.sockSend, sendLimiter, async (data) => {
    const { message, duplicate } = await messages.sendMessage({ senderId: userId, ...data });
    if (!duplicate) {
      const members = await chats.chatMembers(data.chatId);
      // Emitted to every member's personal room (incl. the sender's other devices).
      io.to(members.map(userRoom)).emit('message:new', message);
      void pushOfflineMembers(members, userId, data.chatId, log);
    }
    return { message, duplicate };
  });

  // ---------------------------------------------------------- receipts
  const receipt = (kind) => async ({ chatId, upToSeq }) => {
    await chats.assertMember(userId, chatId);
    const updated = await messages.advanceReceipt({ userId, chatId, kind, upToSeq });
    if (updated) {
      const members = await chats.chatMembers(chatId);
      io.to(members.map(userRoom)).emit('receipt:update', updated);
    }
    return {};
  };
  on('message:delivered', s.sockReceipt, receiptLimiter, receipt('delivered'));
  on('message:read', s.sockReceipt, receiptLimiter, receipt('read'));

  // ---------------------------------------------------------- typing (ephemeral: never persisted)
  on('typing', s.sockTyping, typingLimiter, async ({ chatId, isTyping }) => {
    const members = await chats.assertMember(userId, chatId);
    const others = members.filter((m) => m !== userId).map(userRoom);
    if (others.length) io.to(others).emit('typing', { chatId, userId, isTyping });
    return {};
  });

  // ---------------------------------------------------------- sync (missed messages after reconnect)
  on('sync', s.sockSync, syncLimiter, async ({ cursors }) => messages.syncForUser({ userId, cursors }));

  // ---------------------------------------------------------- teardown
  socket.on('disconnect', async (reason) => {
    clearTimeout(expiryTimer);
    clearInterval(heartbeat);
    try {
      await connected.catch(() => {}); // never let the connect write land after the disconnect cleanup
      if (await presence.disconnect(userId, socket.id)) await broadcastPresence(io, userId, false);
    } catch (err) {
      log.error({ err }, 'disconnect cleanup failed');
    }
    log.debug({ reason }, 'socket disconnected');
  });
}

async function broadcastPresence(io, userId, online) {
  const peers = await chats.peerIds(userId);
  if (!peers.length) return;
  io.to(peers.map(userRoom)).emit('presence', { userId, online, lastSeen: online ? null : new Date().toISOString() });
}

async function pushOfflineMembers(members, senderId, chatId, log) {
  try {
    for (const uid of members) {
      if (uid === senderId) continue;
      if (!(await presence.isOnline(uid))) await notifyNewMessage({ userId: uid, chatId });
    }
  } catch (err) {
    log.error({ err }, 'push fan-out failed');
  }
}
