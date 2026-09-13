import { ApiError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';

export function notFoundHandler(req, res, next) {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'That endpoint does not exist.' });
  }
  next();
}

/**
 * Central error handler. Users get a plain message; stack traces, SQL and
 * configuration stay on the server.
 */
// eslint-disable-next-line no-unused-vars -- Express needs all four arguments
export function errorHandler(err, req, res, _next) {
  const isKnown = err instanceof ApiError;
  const status = isKnown ? err.status : 500;

  if (status >= 500) {
    logger.error('request_failed', {
      method: req.method,
      path: req.path,
      message: err.message,
      stack: config.isProduction ? undefined : err.stack,
    });
  } else {
    logger.warn('request_rejected', { method: req.method, path: req.path, status, message: err.message });
  }

  // ApiError messages are written for users, so they are safe to show even
  // when the status is 5xx (for example "payments are not set up yet").
  const body = {
    error: isKnown ? err.message : 'Something went wrong on our end. Please try again.',
  };
  if (err.details) body.fields = err.details;

  if (req.path.startsWith('/api/')) return res.status(status).json(body);
  res.status(status).type('text/plain').send(body.error);
}
