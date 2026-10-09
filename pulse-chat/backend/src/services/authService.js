import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { query, withTx } from '../db/pool.js';
import { redis } from '../redis.js';
import { revokedKey } from '../middleware/auth.js';
import { unauthorized } from '../utils/errors.js';
import { newRefreshToken, sha256, signAccessToken } from '../utils/tokens.js';
import { logger } from '../utils/logger.js';
import { userDto } from './dto.js';

const refreshTtlMs = () => env.REFRESH_TTL_DAYS * 24 * 3600 * 1000;

async function insertSession(client, { userId, familyId, device, ip }) {
  const refreshToken = newRefreshToken();
  await client.query(
    `INSERT INTO sessions (family_id, user_id, token_hash, device_name, platform, ip, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [familyId, userId, sha256(refreshToken), device?.name ?? null, device?.platform ?? null, ip ?? null,
      new Date(Date.now() + refreshTtlMs())],
  );
  return refreshToken;
}

function tokenPair(userId, familyId, refreshToken) {
  return {
    accessToken: signAccessToken({ userId, familyId }),
    refreshToken,
    expiresIn: env.ACCESS_TTL_SEC,
  };
}

/** Called after OTP verification succeeded. Creates the user on first login. */
export async function loginWithPhone({ phone, device, ip }) {
  return withTx(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO users (phone) VALUES ($1)
       ON CONFLICT (phone) DO UPDATE SET updated_at = now()
       RETURNING *, (xmax = 0) AS is_new`,
      [phone],
    );
    const user = rows[0];
    const familyId = crypto.randomUUID();
    const refreshToken = await insertSession(c, { userId: user.id, familyId, device, ip });
    return { user: userDto(user), isNewUser: user.is_new, ...tokenPair(user.id, familyId, refreshToken) };
  });
}

/**
 * Refresh-token rotation with reuse detection:
 *  - each refresh token is single use; using it mints a new one in the same family
 *  - presenting an already-used token means it leaked (or a client bug) -> revoke the whole family
 */
export async function refresh({ refreshToken, ip }) {
  const hash = sha256(refreshToken);
  let reuseFamily = null;

  const result = await withTx(async (c) => {
    // FOR UPDATE: two concurrent refreshes with the same token serialise here; the loser sees used_at set.
    const { rows } = await c.query('SELECT * FROM sessions WHERE token_hash = $1 FOR UPDATE', [hash]);
    const s = rows[0];
    if (!s) throw unauthorized('invalid_refresh_token');
    if (s.revoked_at || s.expires_at < new Date()) throw unauthorized('invalid_refresh_token');
    if (s.used_at) {
      reuseFamily = s.family_id;
      return null;
    }
    await c.query('UPDATE sessions SET used_at = now() WHERE id = $1', [s.id]);
    const next = await insertSession(c, {
      userId: s.user_id,
      familyId: s.family_id,
      device: { name: s.device_name, platform: s.platform },
      ip,
    });
    return tokenPair(s.user_id, s.family_id, next);
  });

  if (reuseFamily) {
    logger.warn({ familyId: reuseFamily }, 'refresh token reuse detected; revoking family');
    await revokeFamily(reuseFamily);
    throw unauthorized('refresh_token_reused');
  }
  return result;
}

export async function revokeFamily(familyId) {
  await query('UPDATE sessions SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [familyId]);
  // Kill still-valid access tokens of that family until they expire naturally.
  await redis.set(revokedKey(familyId), '1', 'EX', env.ACCESS_TTL_SEC + 60);
}

export async function logout({ refreshToken }) {
  const { rows } = await query('SELECT family_id FROM sessions WHERE token_hash = $1', [sha256(refreshToken)]);
  if (rows[0]) await revokeFamily(rows[0].family_id);
}

/** Housekeeping, run periodically from server.js. */
export async function purgeExpiredSessions() {
  await query("DELETE FROM sessions WHERE expires_at < now() - interval '1 day'");
}
