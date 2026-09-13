import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { pool } from '../db/pool.js';
import { config } from '../config.js';

const PgStore = connectPgSimple(session);

export const sessionMiddleware = session({
  name: 'atrio.sid',
  store: new PgStore({
    pool,
    tableName: 'user_sessions',
    createTableIfMissing: false, // the migration owns this table
    pruneSessionInterval: 60 * 15,
  }),
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,                 // JavaScript cannot read the session cookie
    secure: config.isProduction,    // HTTPS only in production
    sameSite: 'lax',                // blocks cross-site form posts
    maxAge: 1000 * 60 * 60 * 24 * 14,
    path: '/',
  },
});
