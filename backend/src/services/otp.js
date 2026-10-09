import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { redis } from '../redis.js';
import { logger, maskPhone } from '../utils/logger.js';
import { badRequest, unauthorized } from '../utils/errors.js';
import { timingSafeEqual } from '../utils/tokens.js';

const key = (phone) => `otp:${phone}`;

const hmac = (phone, code) =>
  crypto.createHmac('sha256', env.OTP_HMAC_SECRET).update(`${phone}:${code}`).digest('hex');

const generateCode = () => String(crypto.randomInt(0, 10 ** env.OTP_LENGTH)).padStart(env.OTP_LENGTH, '0');

// ---------------------------------------------------------------- delivery providers
const providers = {
  /** Dev only: prints the code. Refused in production by config/env.js. */
  async console({ phone, code }) {
    logger.warn({ phone: maskPhone(phone), code }, 'DEV OTP');
  },

  /**
   * Generic HTTP->SMS bridge, e.g. a self-hosted Android SMS gateway app or any
   * provider with a simple POST API. Adapt the body to your gateway.
   */
  async http({ phone, code }) {
    if (!env.OTP_HTTP_URL) throw new Error('OTP_HTTP_URL not configured');
    const res = await fetch(env.OTP_HTTP_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(env.OTP_HTTP_TOKEN ? { authorization: `Bearer ${env.OTP_HTTP_TOKEN}` } : {}),
      },
      body: JSON.stringify({ to: phone, message: `Your Pulse code is ${code}. Valid for ${Math.round(env.OTP_TTL_SEC / 60)} minutes.` }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`SMS gateway responded ${res.status}`);
  },

  /**
   * Email OTP. NOTE: this proves control of the email address, not of the phone
   * number — acceptable for a private/family deployment, not for open registration.
   */
  async smtp({ phone, code, email }) {
    if (!env.SMTP_URL) throw new Error('SMTP_URL not configured');
    if (!email) throw badRequest('email_required', 'email is required for smtp OTP delivery');
    const { default: nodemailer } = await import('nodemailer');
    const transport = nodemailer.createTransport(env.SMTP_URL);
    await transport.sendMail({
      from: env.SMTP_FROM,
      to: email,
      subject: 'Your Pulse verification code',
      text: `Your code for ${maskPhone(phone)} is ${code}. It expires in ${Math.round(env.OTP_TTL_SEC / 60)} minutes.`,
    });
  },
};

// ---------------------------------------------------------------- public API
export async function requestOtp({ phone, email }) {
  const code = generateCode();
  // Overwrites any previous code: only the latest is valid. Attempts reset on re-issue
  // (re-issue itself is rate limited per phone + IP at the route layer).
  await redis.multi().hset(key(phone), { h: hmac(phone, code), attempts: 0 }).expire(key(phone), env.OTP_TTL_SEC).exec();
  try {
    await providers[env.OTP_PROVIDER]({ phone, code, email });
  } catch (err) {
    await redis.del(key(phone));
    if (err.status) throw err;
    logger.error({ err: err.message, phone: maskPhone(phone) }, 'OTP delivery failed');
    throw Object.assign(new Error('otp_delivery_failed'), { status: 502, code: 'otp_delivery_failed' });
  }
}

/** Throws unauthorized('invalid_code') on mismatch; code is single-use. */
export async function verifyOtp({ phone, code }) {
  const k = key(phone);
  const attempts = await redis.hincrby(k, 'attempts', 1);
  const stored = await redis.hget(k, 'h');
  // hincrby on a missing key creates it with no TTL — make sure it expires.
  if (!stored) {
    await redis.del(k);
    throw unauthorized('invalid_code');
  }
  if (attempts > env.OTP_MAX_ATTEMPTS) {
    await redis.del(k);
    throw unauthorized('too_many_attempts');
  }
  if (!timingSafeEqual(stored, hmac(phone, code))) throw unauthorized('invalid_code');
  await redis.del(k); // single use
}
