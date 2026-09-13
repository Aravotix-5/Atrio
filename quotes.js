import { query, one, many } from '../db/pool.js';
import { notFound } from '../utils/errors.js';

/** Recalculates a quote's stored totals from its line items. Server-side only. */
export async function recalculateQuote(quoteId, client = null) {
  const run = client ? (text, params) => client.query(text, params) : query;
  const { rows } = await run(
    `SELECT COALESCE(SUM(unit_price_cents * quantity), 0)::int AS subtotal
       FROM quote_items WHERE quote_id = $1`,
    [quoteId]
  );
  const subtotal = rows[0].subtotal;
  const updated = await run(
    `UPDATE quotes
        SET subtotal_cents = $2,
            total_cents = GREATEST($2 + adjustment_cents, 0),
            updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [quoteId, subtotal]
  );
  if (updated.rows.length === 0) throw notFound('Quote not found.');
  return updated.rows[0];
}

export async function getQuoteWithItems(quoteId) {
  const quote = await one(
    `SELECT q.*, r.title AS request_title, r.contact_name, r.contact_email,
            p.id AS project_id, p.status AS project_status
       FROM quotes q
       JOIN project_requests r ON r.id = q.request_id
       LEFT JOIN projects p ON p.quote_id = q.id
      WHERE q.id = $1`,
    [quoteId]
  );
  if (!quote) return null;
  quote.items = await many(
    `SELECT id, service_id, description, quantity, unit_price_cents,
            (quantity * unit_price_cents)::int AS line_total_cents, sort_order
       FROM quote_items WHERE quote_id = $1 ORDER BY sort_order, id`,
    [quoteId]
  );
  quote.payments = await many(
    `SELECT id, status, amount_cents, currency, paid_at, created_at
       FROM payments WHERE quote_id = $1 ORDER BY created_at DESC`,
    [quoteId]
  );
  return quote;
}

/** True once a payment for this quote has succeeded. */
export async function quoteIsPaid(quoteId) {
  const row = await one(`SELECT 1 FROM payments WHERE quote_id = $1 AND status = 'paid' LIMIT 1`, [quoteId]);
  return Boolean(row);
}
