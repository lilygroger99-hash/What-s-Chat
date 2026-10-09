import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

// Return bigint (seq) as JS number: per-chat seq will never approach 2^53.
pg.types.setTypeParser(20, (v) => Number(v));

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: env.PG_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => logger.error({ err }, 'idle pg client error'));

export const query = (text, params) => pool.query(text, params);

/** Run fn inside a transaction. fn receives a dedicated client. */
export async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* connection is likely dead; pool will discard it */
    }
    throw err;
  } finally {
    client.release();
  }
}
