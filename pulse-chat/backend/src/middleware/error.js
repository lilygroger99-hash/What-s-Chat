import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export function notFoundHandler(_req, res) {
  res.status(404).json({ error: { code: 'not_found' } });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    if (err.retryAfterSec) res.set('Retry-After', String(err.retryAfterSec));
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: { code: 'payload_too_large' } });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'invalid_json' } });
  (req.log ?? logger).error({ err }, 'unhandled error');
  res.status(500).json({ error: { code: 'internal_error' } });
}
