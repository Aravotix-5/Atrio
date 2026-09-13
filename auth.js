import { many } from '../db/pool.js';
import { unauthorized, forbidden } from '../utils/errors.js';

/**
 * Loads the signed-in user from the session on every request.
 * The session only stores a user id - roles are re-read from the database so a
 * demoted account loses access immediately.
 */
export async function attachUser(req, _res, next) {
  req.user = null;
  const userId = req.session?.userId;
  if (!userId) return next();
  try {
    const rows = await many('SELECT id, email, name, role, created_at FROM users WHERE id = $1', [userId]);
    if (rows.length === 0) {
      req.session.destroy(() => {});
      return next();
    }
    req.user = rows[0];
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

export function requireAdmin(req, _res, next) {
  if (!req.user) return next(unauthorized());
  if (!['admin', 'staff'].includes(req.user.role)) return next(forbidden('Admin access only.'));
  next();
}

export const publicUser = (user) =>
  user && { id: user.id, email: user.email, name: user.name, role: user.role };
