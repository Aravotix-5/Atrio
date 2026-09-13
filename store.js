/**
 * The in-progress project selection.
 *
 * Kept in localStorage on purpose: it is a temporary, harmless draft so the
 * customer does not lose their work when they navigate or refresh. Nothing
 * here is trusted - the server re-prices every selection from the database.
 */
const KEY = 'atrio.builder.v1';

function read() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function write(value) {
  try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* private mode */ }
  document.dispatchEvent(new CustomEvent('atrio:selection', { detail: value }));
}

export const selection = {
  all: read,
  has: (id) => Boolean(read()[id]),
  quantity: (id) => read()[id] || 0,
  count: () => Object.keys(read()).length,
  toggle(id, quantity = 1) {
    const current = read();
    if (current[id]) delete current[id];
    else current[id] = quantity;
    write(current);
    return Boolean(current[id]);
  },
  set(id, quantity) {
    const current = read();
    if (quantity <= 0) delete current[id];
    else current[id] = quantity;
    write(current);
  },
  remove(id) { const c = read(); delete c[id]; write(c); },
  clear() { write({}); },
  items: () => Object.entries(read()).map(([id, quantity]) => ({ service_id: Number(id), quantity })),
};
