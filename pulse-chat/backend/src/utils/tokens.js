import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { unauthorized } from './errors.js';

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest();

/** 256-bit opaque refresh token (base64url). Only its SHA-256 is stored. */
export const newRefreshToken = () => crypto.randomBytes(32).toString('base64url');

export function signAccessToken({ userId, familyId }) {
  return jwt.sign({ sid: familyId }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    subject: userId,
    expiresIn: env.ACCESS_TTL_SEC,
    issuer: 'pulse',
  });
}

export function verifyAccessToken(token) {
  try {
    const p = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'], issuer: 'pulse' });
    return { userId: p.sub, familyId: p.sid, exp: p.exp };
  } catch (err) {
    throw unauthorized(err.name === 'TokenExpiredError' ? 'token_expired' : 'invalid_token');
  }
}

export const timingSafeEqual = (a, b) => {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
};
