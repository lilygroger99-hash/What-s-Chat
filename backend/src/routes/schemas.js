import { z } from 'zod';
import { env } from '../config/env.js';

/** Strip C0/C1 control chars (keeps \n and \t) and zero-width/bidi override chars used for spoofing. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/g;
export const cleanText = (s) => s.normalize('NFC').replace(CONTROL, '');

export const phone = z
  .string()
  .trim()
  .regex(/^\+[1-9][0-9]{7,14}$/, 'must be E.164, e.g. +923001234567');

export const uuid = z.string().uuid();

export const messageText = z
  .string()
  .max(env.MESSAGE_MAX_CHARS)
  .transform(cleanText)
  .refine((s) => s.trim().length > 0, 'empty message');

export const otpRequest = z.object({ phone, email: z.string().email().max(254).optional() });

export const otpVerify = z.object({
  phone,
  code: z.string().regex(/^[0-9]{4,8}$/),
  device: z
    .object({ name: z.string().max(80).optional(), platform: z.string().max(20).optional() })
    .optional(),
});

export const refreshBody = z.object({ refreshToken: z.string().min(20).max(200) });

export const profilePatch = z
  .object({
    name: z.string().max(60).transform(cleanText).optional(),
    about: z.string().max(140).transform(cleanText).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'nothing to update');

export const lookupBody = z.object({ phones: z.array(phone).min(1).max(200) });

export const directChatBody = z.object({ userId: uuid });

export const historyQuery = z.object({
  beforeSeq: z.coerce.number().int().positive().optional(),
  afterSeq: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const syncBody = z.object({
  cursors: z.record(uuid, z.number().int().min(0)).default({}),
});

export const pushTokenBody = z.object({
  token: z.string().min(20).max(4096),
  platform: z.enum(['android']).default('android'),
});

// ---- socket payloads
export const sockSend = z.object({
  chatId: uuid,
  clientMsgId: uuid,
  type: z.literal('text').default('text'), // Phase 2 widens this
  content: messageText,
  replyTo: uuid.nullish(),
});
export const sockReceipt = z.object({ chatId: uuid, upToSeq: z.number().int().positive() });
export const sockTyping = z.object({ chatId: uuid, isTyping: z.boolean() });
export const sockSync = syncBody;
