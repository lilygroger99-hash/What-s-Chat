import { redis } from '../redis.js';
import { unauthorized } from '../utils/errors.js';
import { verifyAccessToken } from '../utils/tokens.js';

export const revokedKey = (familyId) => `revoked:family:${familyId}`;

/** Verifies the JWT and that its session family was not revoked (logout / token reuse). */
export async function authenticateToken(token) {
  const claims = verifyAccessToken(token);
  if (await redis.exists(revokedKey(claims.familyId))) throw unauthorized('session_revoked');
  return claims;
}

export async function requireAuth(req, _res, next) {
  try {
    const header = req.get('authorization') ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) throw unauthorized('missing_token');
    req.auth = await authenticateToken(token);
    next();
  } catch (err) {
    next(err);
  }
}
