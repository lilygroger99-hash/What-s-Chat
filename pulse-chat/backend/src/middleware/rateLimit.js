import { RateLimiterMemory, RateLimiterRedis } from 'rate-limiter-flexible';
import { redis } from '../redis.js';
import { tooMany } from '../utils/errors.js';

/**
 * Build a limiter backed by Redis (shared across app instances) that degrades to an
 * in-process limiter if Redis is unavailable, rather than failing open or closed.
 */
export function makeLimiter({ prefix, points, duration, blockDuration = 0 }) {
  return new RateLimiterRedis({
    storeClient: redis,
    keyPrefix: `rl:${prefix}`,
    points,
    duration,
    blockDuration,
    insuranceLimiter: new RateLimiterMemory({ points, duration, blockDuration }),
  });
}

/** Consume 1 point for `key`; throws a 429 AppError (with Retry-After) when exhausted. */
export async function consume(limiter, key) {
  try {
    await limiter.consume(key);
  } catch (rej) {
    if (rej instanceof Error) throw rej; // real error, not a limit rejection
    const err = tooMany();
    err.retryAfterSec = Math.max(1, Math.ceil(rej.msBeforeNext / 1000));
    throw err;
  }
}

/** Express middleware factory. keyFn defaults to the client IP. */
export function rateLimit(opts, keyFn = (req) => req.ip) {
  const limiter = makeLimiter(opts);
  return async (req, _res, next) => {
    try {
      await consume(limiter, keyFn(req));
      next();
    } catch (err) {
      next(err);
    }
  };
}
