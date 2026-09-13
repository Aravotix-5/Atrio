import { many } from '../db/pool.js';
import { badRequest } from '../utils/errors.js';

let cache = null;
let cachedAt = 0;
const TTL_MS = 60_000;

export async function getStatuses(domain) {
  const now = Date.now();
  if (!cache || now - cachedAt > TTL_MS) {
    const rows = await many('SELECT domain, key, label, description, sort_order, is_terminal FROM statuses ORDER BY domain, sort_order');
    cache = rows;
    cachedAt = now;
  }
  return domain ? cache.filter((s) => s.domain === domain) : cache;
}

export async function assertStatus(domain, key) {
  const allowed = await getStatuses(domain);
  if (!allowed.some((s) => s.key === key)) {
    throw badRequest(`"${key}" is not a valid ${domain} status.`);
  }
  return key;
}

export function clearStatusCache() {
  cache = null;
}
