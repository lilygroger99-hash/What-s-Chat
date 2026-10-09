import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import * as chats from '../services/chatService.js';
import { userDto } from '../services/dto.js';
import * as messages from '../services/messageService.js';
import { pushTokens } from '../services/push.js';
import { notFound } from '../utils/errors.js';
import * as s from './schemas.js';

export const apiRouter = Router();
apiRouter.use(requireAuth);
apiRouter.use(rateLimit({ prefix: 'api_user', points: 300, duration: 60 }, (req) => req.auth.userId));

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

// ---------------------------------------------------------------- profile / users
apiRouter.get('/me', wrap(async (req, res) => {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.auth.userId]);
  if (!rows[0]) throw notFound('user_not_found');
  res.json(userDto(rows[0]));
}));

apiRouter.patch('/me', validate(s.profilePatch), wrap(async (req, res) => {
  const { name, about } = req.valid.body;
  const { rows } = await query(
    `UPDATE users SET name = COALESCE($2, name), about = COALESCE($3, about), updated_at = now()
      WHERE id = $1 RETURNING *`,
    [req.auth.userId, name ?? null, about ?? null],
  );
  res.json(userDto(rows[0]));
}));

// Contact discovery: which of these numbers are registered? Tight limit: it is an enumeration oracle.
apiRouter.post(
  '/users/lookup',
  rateLimit({ prefix: 'lookup', points: 20, duration: 3600 }, (req) => req.auth.userId),
  validate(s.lookupBody),
  wrap(async (req, res) => {
    const { rows } = await query('SELECT * FROM users WHERE phone = ANY($1) AND id <> $2', [
      req.valid.body.phones,
      req.auth.userId,
    ]);
    res.json({ users: rows.map(userDto) });
  }),
);

// ---------------------------------------------------------------- chats
apiRouter.get('/chats', wrap(async (req, res) => {
  res.json({ chats: await chats.listChats(req.auth.userId) });
}));

apiRouter.post('/chats/direct', validate(s.directChatBody), wrap(async (req, res) => {
  res.json(await chats.getOrCreateDirectChat(req.auth.userId, req.valid.body.userId));
}));

apiRouter.get('/chats/:chatId/messages', validate(s.historyQuery, 'query'), wrap(async (req, res) => {
  const chatId = s.uuid.parse(req.params.chatId);
  const { beforeSeq, afterSeq, limit } = req.valid.query;
  res.json({ messages: await messages.listMessages({ userId: req.auth.userId, chatId, beforeSeq, afterSeq, limit }) });
}));

// ---------------------------------------------------------------- sync (also available over the socket)
apiRouter.post('/sync', validate(s.syncBody), wrap(async (req, res) => {
  res.json(await messages.syncForUser({ userId: req.auth.userId, cursors: req.valid.body.cursors }));
}));

// ---------------------------------------------------------------- push tokens
apiRouter.put('/devices/push-token', validate(s.pushTokenBody), wrap(async (req, res) => {
  await pushTokens.register(req.auth.userId, req.valid.body.token, req.valid.body.platform);
  res.status(204).end();
}));
apiRouter.delete('/devices/push-token', validate(s.pushTokenBody), wrap(async (req, res) => {
  await pushTokens.remove(req.auth.userId, req.valid.body.token);
  res.status(204).end();
}));
