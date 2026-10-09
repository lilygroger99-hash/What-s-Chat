import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'body.code',
      'body.refreshToken',
      '*.refreshToken',
      '*.accessToken',
    ],
    censor: '[redacted]',
  },
});

/** 923001234567 -> +92300***4567 — never log full phone numbers. */
export function maskPhone(phone) {
  if (!phone || phone.length < 8) return '***';
  return `${phone.slice(0, 5)}***${phone.slice(-4)}`;
}
