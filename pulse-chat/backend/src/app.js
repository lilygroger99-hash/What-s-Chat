import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { env } from './config/env.js';
import { pool } from './db/pool.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { redis } from './redis.js';
import { apiRouter } from './routes/api.js';
import { authRouter } from './routes/auth.js';
import { logger } from './utils/logger.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/healthz' } }));
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGINS ? env.CORS_ORIGINS.split(',') : false }));
  app.use(express.json({ limit: '32kb' }));

  // Liveness (process) vs readiness (dependencies) — Docker healthcheck uses readiness.
  app.get('/healthz', async (_req, res) => {
    try {
      await Promise.all([pool.query('SELECT 1'), redis.ping()]);
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  app.use('/v1/auth', authRouter);
  app.use('/v1', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
