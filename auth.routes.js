import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { query, one, withTransaction } from '../db/pool.js';
import { publicUser, requireAuth } from '../middleware/auth.js';
import { FieldErrors, str, email as validEmail } from '../utils/validate.js';
import { conflict, unauthorized } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export const authRouter = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Wait a few minutes and try again.' },
});

authRouter.get('/me', (req, res) => {
  res.json({ user: publicUser(req.user) });
});

authRouter.post('/signup', authLimiter, async (req, res, next) => {
  try {
    const errors = new FieldErrors();
    const name = str(req.body?.name, { field: 'name', required: true, min: 2, max: 120, errors });
    const email = validEmail(req.body?.email, { errors });
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (password.length < 10) errors.add('password', 'Use at least 10 characters.');
    if (password.length > 200) errors.add('password', 'That password is too long.');
    errors.throwIfAny();

    const existing = await one('SELECT id FROM users WHERE lower(email) = $1', [email]);
    if (existing) throw conflict('An account with that email already exists. Try logging in.');

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3)
         RETURNING id, email, name, role`,
        [email, passwordHash, name]
      );
      const created = rows[0];
      // Link any guest requests submitted with this email to the new account.
      await client.query(
        `UPDATE project_requests SET user_id = $1, updated_at = now()
          WHERE user_id IS NULL AND lower(contact_email) = $2`,
        [created.id, email]
      );
      await client.query(
        `UPDATE quotes q SET user_id = $1, updated_at = now()
           FROM project_requests r
          WHERE q.request_id = r.id AND q.user_id IS NULL AND r.user_id = $1`,
        [created.id]
      );
      return created;
    });

    // Regenerate the session id on privilege change (prevents session
    // fixation). The CSRF token is carried across so the open page stays valid.
    const csrfToken = req.session.csrfToken;
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = user.id;
      req.session.csrfToken = csrfToken;
      logger.info('user_signed_up', { userId: user.id });
      res.status(201).json({ user: publicUser(user) });
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/login', authLimiter, async (req, res, next) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!email || !password) throw unauthorized('Enter your email and password.');

    const user = await one(
      'SELECT id, email, name, role, password_hash FROM users WHERE lower(email) = $1',
      [email]
    );
    // Always run a hash comparison so timing does not reveal whether the
    // account exists.
    const hash = user?.password_hash || '$2a$12$0000000000000000000000000000000000000000000000000000';
    const ok = await bcrypt.compare(password, hash);
    if (!user || !ok) throw unauthorized('That email and password do not match.');

    const csrfToken = req.session.csrfToken;
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = user.id;
      req.session.csrfToken = csrfToken;
      logger.info('user_logged_in', { userId: user.id });
      res.json({ user: publicUser(user) });
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/logout', (req, res, next) => {
  if (!req.session) return res.json({ ok: true });
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('atrio.sid', { path: '/' });
    res.json({ ok: true });
  });
});

authRouter.post('/password', requireAuth, async (req, res, next) => {
  try {
    const current = typeof req.body?.current_password === 'string' ? req.body.current_password : '';
    const next_ = typeof req.body?.new_password === 'string' ? req.body.new_password : '';
    const errors = new FieldErrors();
    if (next_.length < 10) errors.add('new_password', 'Use at least 10 characters.');
    errors.throwIfAny();

    const row = await one('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const ok = await bcrypt.compare(current, row.password_hash);
    if (!ok) throw unauthorized('Your current password is not correct.');

    await query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [
      await bcrypt.hash(next_, 12),
      req.user.id,
    ]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
