import crypto from 'node:crypto';
import { forbidden } from '../utils/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Issues a per-session token and requires it on every state-changing request. */
export function csrfProtection(req, _res, next) {
  if (req.session && !req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  if (SAFE_METHODS.has(req.method)) return next();

  const sent = req.get('x-csrf-token') || req.body?._csrf;
  const expected = req.session?.csrfToken;
  if (!expected || !sent || sent.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected))) {
    return next(forbidden('Your session expired. Refresh the page and try again.'));
  }
  next();
}

export function csrfTokenHandler(req, res) {
  res.json({ csrfToken: req.session.csrfToken });
}
