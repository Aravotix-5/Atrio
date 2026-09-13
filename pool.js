import pg from 'pg';
import { config } from '../config.js';

// Postgres returns BIGINT (int8) as a string by default to avoid precision loss.
// Our ids are small, so parse them as numbers for friendlier JSON.
pg.types.setTypeParser(20, (value) => (value === null ? null : Number(value)));
// NUMERIC -> number (only used by aggregate counts).
pg.types.setTypeParser(1700, (value) => (value === null ? null : Number(value)));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : false,
  max: config.isProduction ? 10 : 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => {
  // A pooled idle client failed. Log it; the pool will replace the client.
  console.error('[db] idle client error:', err.message);
});

/**
 * Run a parameterised query. Always pass values as `params` - never build SQL
 * by concatenating user input.
 */
export function query(text, params) {
  return pool.query(text, params);
}

/** Convenience: first row or null. */
export async function one(text, params) {
  const { rows } = await pool.query(text, params);
  return rows[0] ?? null;
}

/** Convenience: all rows. */
export async function many(text, params) {
  const { rows } = await pool.query(text, params);
  return rows;
}

/** Run several statements in a single transaction. */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* connection already gone */
    }
    throw err;
  } finally {
    client.release();
  }
}
