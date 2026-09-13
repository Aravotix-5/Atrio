/**
 * Tiny structured logger. Never log passwords, password hashes, session
 * contents, Stripe secrets or full request bodies.
 */
const REDACTED = '[redacted]';
const SENSITIVE = new Set(['password', 'password_hash', 'confirm_password', 'secret', 'token', 'authorization', 'cookie']);

export function safeMeta(meta = {}) {
  const out = {};
  for (const [key, value] of Object.entries(meta)) {
    out[key] = SENSITIVE.has(key.toLowerCase()) ? REDACTED : value;
  }
  return out;
}

function write(level, message, meta) {
  const line = { level, message, time: new Date().toISOString(), ...safeMeta(meta) };
  const text = JSON.stringify(line);
  if (level === 'error') console.error(text);
  else if (level === 'warn') console.warn(text);
  else console.log(text);
}

export const logger = {
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  error: (message, meta) => write('error', message, meta),
};
