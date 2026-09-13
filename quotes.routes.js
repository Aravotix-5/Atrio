import { Router } from 'express';
import { many, one, withTransaction } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { getQuoteWithItems } from '../services/quotes.js';
import { id as validId, str, FieldErrors } from '../utils/validate.js';
import { notFound, badRequest } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export const quotesRouter = Router();

const CUSTOMER_VISIBLE = ['sent', 'accepted', 'declined', 'expired'];

quotesRouter.use(requireAuth);

quotesRouter.get('/', async (req, res, next) => {
  try {
    const quotes = await many(
      `SELECT q.id, q.status, q.total_cents, q.currency, q.expires_at, q.sent_at,
              q.accepted_at, r.title AS request_title,
              EXISTS (SELECT 1 FROM payments p WHERE p.quote_id = q.id AND p.status = 'paid') AS paid
         FROM quotes q
         JOIN project_requests r ON r.id = q.request_id
        WHERE q.user_id = $1 AND q.status = ANY($2)
        ORDER BY q.created_at DESC`,
      [req.user.id, CUSTOMER_VISIBLE]
    );
    res.json({ quotes });
  } catch (err) {
    next(err);
  }
});

quotesRouter.get('/:id', async (req, res, next) => {
  try {
    const quote = await loadOwnQuote(req.params.id, req.user.id);
    res.json({ quote: toCustomerQuote(quote) });
  } catch (err) {
    next(err);
  }
});

/** Accept a quote. This creates the project and unlocks payment. */
quotesRouter.post('/:id/accept', async (req, res, next) => {
  try {
    const quote = await loadOwnQuote(req.params.id, req.user.id);
    if (quote.status === 'accepted') return res.json({ quote: toCustomerQuote(quote), already: true });
    if (quote.status !== 'sent') throw badRequest('This quote cannot be accepted right now.');
    if (quote.expires_at && new Date(quote.expires_at) < new Date()) {
      throw badRequest('This quote has expired. Ask Atrio for an updated one.');
    }

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE quotes SET status = 'accepted', accepted_at = now(), updated_at = now() WHERE id = $1`,
        [quote.id]
      );
      await client.query(
        `UPDATE project_requests SET status = 'accepted', updated_at = now() WHERE id = $1`,
        [quote.request_id]
      );
      await client.query(
        `INSERT INTO projects (quote_id, request_id, user_id, title, status)
         VALUES ($1, $2, $3, $4, 'payment_pending')
         ON CONFLICT (quote_id) DO NOTHING`,
        [quote.id, quote.request_id, req.user.id, quote.request_title]
      );
    });

    logger.info('quote_accepted', { quoteId: quote.id, userId: req.user.id });
    const updated = await getQuoteWithItems(quote.id);
    res.json({ quote: toCustomerQuote(updated) });
  } catch (err) {
    next(err);
  }
});

/** Decline / ask for changes. */
quotesRouter.post('/:id/decline', async (req, res, next) => {
  try {
    const quote = await loadOwnQuote(req.params.id, req.user.id);
    if (quote.status !== 'sent') throw badRequest('This quote cannot be changed right now.');
    const errors = new FieldErrors();
    const reason = str(req.body?.reason, { field: 'reason', required: true, min: 5, max: 1000, errors });
    errors.throwIfAny();

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE quotes SET status = 'declined', declined_at = now(), decline_reason = $2, updated_at = now()
          WHERE id = $1`,
        [quote.id, reason]
      );
      await client.query(
        `UPDATE project_requests SET status = 'under_review', updated_at = now() WHERE id = $1`,
        [quote.request_id]
      );
      await client.query(
        `INSERT INTO notes (entity_type, entity_id, author_id, body, internal)
         VALUES ('quote', $1, $2, $3, false)`,
        [quote.id, req.user.id, `Customer requested changes: ${reason}`]
      );
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

async function loadOwnQuote(rawId, userId) {
  const quoteId = validId(rawId, { field: 'quote id' });
  const owner = await one('SELECT user_id, status FROM quotes WHERE id = $1', [quoteId]);
  if (!owner || owner.user_id !== userId || !CUSTOMER_VISIBLE.includes(owner.status)) {
    // Same message whether it does not exist or belongs to someone else.
    throw notFound('We could not find that quote on your account.');
  }
  return getQuoteWithItems(quoteId);
}

/** Strips internal fields before a quote goes to a customer. */
function toCustomerQuote(quote) {
  return {
    id: quote.id,
    request_id: quote.request_id,
    request_title: quote.request_title,
    status: quote.status,
    subtotal_cents: quote.subtotal_cents,
    adjustment_cents: quote.adjustment_cents,
    adjustment_label: quote.adjustment_label,
    total_cents: quote.total_cents,
    currency: quote.currency,
    notes: quote.notes,
    expires_at: quote.expires_at,
    sent_at: quote.sent_at,
    accepted_at: quote.accepted_at,
    project_id: quote.project_id,
    project_status: quote.project_status,
    items: quote.items,
    payment_status: quote.payments.find((p) => p.status === 'paid')?.status
      ?? quote.payments[0]?.status ?? null,
  };
}
