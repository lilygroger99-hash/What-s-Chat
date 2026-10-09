import { Redis } from 'ioredis';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';

const clients = new Set();

function make(name) {
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableAutoPipelining: true,
    retryStrategy: (times) => Math.min(times * 200, 3000),
  });
  clients.add(client);
  client.on('error', (err) => logger.error({ err: err.message, client: name }, 'redis error'));
  return client;
}

export const redis = make('main');
/** Dedicated connections for the socket.io adapter (pub/sub cannot share a data connection). */
export const makePubSub = () => ({ pub: make('adapter-pub'), sub: make('adapter-sub') });

/** Close every Redis connection (data + adapter pub/sub). */
export const closeRedis = () => clients.forEach((c) => c.disconnect());
