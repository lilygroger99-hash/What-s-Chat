import http from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { migrate } from './db/migrate.js';
import { pool } from './db/pool.js';
import { closeRedis } from './redis.js';
import { purgeExpiredSessions } from './services/authService.js';
import { createRealtime } from './sockets/index.js';
import { logger } from './utils/logger.js';

export async function start({ port = env.PORT } = {}) {
  await migrate();

  const app = createApp();
  const server = http.createServer(app);
  const io = createRealtime(server);

  await new Promise((resolve) => server.listen(port, resolve));
  logger.info({ port, env: env.NODE_ENV }, 'pulse backend listening');

  const purge = setInterval(() => purgeExpiredSessions().catch((err) => logger.error({ err }, 'purge failed')), 6 * 3600_000);
  purge.unref();

  let closing = false;
  async function shutdown(signal) {
    if (closing) return;
    closing = true;
    logger.info({ signal }, 'shutting down');
    clearInterval(purge);
    // Tell clients to reconnect (they will sync), stop accepting, drain, close deps.
    await new Promise((r) => io.close(r));
    server.close();
    await pool.end().catch(() => {});
    closeRedis();
  }
  return { server, io, shutdown };
}

// Run when executed directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  start()
    .then(({ shutdown }) => {
      for (const sig of ['SIGTERM', 'SIGINT']) {
        process.on(sig, () => shutdown(sig).then(() => process.exit(0)));
      }
    })
    .catch((err) => {
      logger.fatal({ err }, 'failed to start');
      process.exit(1);
    });
}
