import 'dotenv/config';
import crypto from 'node:crypto';

const env = process.env;
const isProduction = env.NODE_ENV === 'production';

function required(name, fallback) {
  const value = env[name];
  if (value && value.trim() !== '') return value.trim();
  if (fallback !== undefined) return fallback;
  throw new Error(
    `Missing required environment variable ${name}. ` +
      'See .env.example and the README for what to set.'
  );
}

function bool(name, fallback = false) {
  const value = (env[name] || '').toLowerCase().trim();
  if (value === '') return fallback;
  return value === 'true' || value === '1' || value === 'yes';
}

let sessionSecret = env.SESSION_SECRET?.trim();
if (!sessionSecret) {
  if (isProduction) {
    throw new Error('SESSION_SECRET must be set in production.');
  }
  sessionSecret = crypto.randomBytes(32).toString('hex');
  console.warn('[config] SESSION_SECRET not set - using a temporary dev secret. Logins reset on restart.');
}

export const config = {
  isProduction,
  port: Number(env.PORT || 3000),
  appUrl: (env.APP_URL || `http://localhost:${Number(env.PORT || 3000)}`).replace(/\/$/, ''),
  databaseUrl: required('DATABASE_URL'),
  databaseSsl: bool('DATABASE_SSL', isProduction),
  sessionSecret,
  admin: {
    email: env.ADMIN_EMAIL?.trim() || '',
    password: env.ADMIN_PASSWORD || '',
    name: env.ADMIN_NAME?.trim() || 'Atrio Admin',
  },
  stripe: {
    secretKey: env.STRIPE_SECRET_KEY?.trim() || '',
    webhookSecret: env.STRIPE_WEBHOOK_SECRET?.trim() || '',
    get configured() {
      return Boolean(env.STRIPE_SECRET_KEY?.trim());
    },
  },
  currency: 'usd',
};
