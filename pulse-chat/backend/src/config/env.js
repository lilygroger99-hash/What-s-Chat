import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  LOG_LEVEL: z.string().default('info'),

  DATABASE_URL: z.string().min(1),
  PG_POOL_MAX: z.coerce.number().int().default(20),
  REDIS_URL: z.string().min(1).default('redis://redis:6379'),

  // Reverse-proxy hops in front of Express: the nginx container (which resolves the real client IP) = 1.
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),
  CORS_ORIGINS: z.string().default(''),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be >= 32 chars'),
  ACCESS_TTL_SEC: z.coerce.number().int().default(900),
  REFRESH_TTL_DAYS: z.coerce.number().int().default(60),

  OTP_HMAC_SECRET: z.string().min(32, 'OTP_HMAC_SECRET must be >= 32 chars'),
  OTP_PROVIDER: z.enum(['console', 'http', 'smtp']).default('console'),
  OTP_TTL_SEC: z.coerce.number().int().default(300),
  OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(6),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().default(5),
  // http provider: POST {to, message} with bearer token. Works with self-hosted
  // Android SMS gateways or any HTTP->SMS bridge.
  OTP_HTTP_URL: z.string().optional(),
  OTP_HTTP_TOKEN: z.string().optional(),
  // smtp provider (email OTP alternative).
  SMTP_URL: z.string().optional(),
  SMTP_FROM: z.string().default('Pulse <no-reply@localhost>'),

  MESSAGE_MAX_CHARS: z.coerce.number().int().default(4096),

  // Optional: FCM used ONLY as a wake-up/notification transport (generic payload, no content).
  FCM_SERVICE_ACCOUNT_PATH: z.string().optional(),
  PUSH_ENABLED: bool.default('false'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:\n', parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';

if (isProd && env.OTP_PROVIDER === 'console') {
  // eslint-disable-next-line no-console
  console.error('OTP_PROVIDER=console is not allowed in production (codes would be logged).');
  process.exit(1);
}
