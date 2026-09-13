import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { many, one, withTransaction } from '../db/pool.js';
import { priceSelection } from '../services/pricing.js';
import { requireAuth } from '../middleware/auth.js';
import { FieldErrors, str, email as validEmail, url as validUrl, id as validId } from '../utils/validate.js';
import { notFound } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export const requestsRouter = Router();

const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'That is a lot of requests in one hour. Try again later or email us.' },
});

/** Submit a project request. Works signed in or as a guest. */
requestsRouter.post('/', submitLimiter, async (req, res, next) => {
  try {
    const b = req.body || {};
    const errors = new FieldErrors();
    const contactName  = str(b.contact_name, { field: 'contact_name', required: true, min: 2, max: 120, errors });
    const contactEmail = validEmail(b.contact_email, { field: 'contact_email', errors });
    const title        = str(b.title, { field: 'title', required: true, min: 3, max: 160, errors });
    const description  = str(b.description, { field: 'description', required: true, min: 20, max: 4000, errors });
    const timeline     = str(b.timeline, { field: 'timeline', max: 120, errors });
    const budgetRange  = str(b.budget_range, { field: 'budget_range', max: 120, errors });
    const referenceUrl = validUrl(b.reference_url, { errors });
    errors.throwIfAny();

    // Prices come from the database, never from the request body.
    const priced = await priceSelection(b.items || []);

    const request = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO project_requests
           (user_id, contact_name, contact_email, title, description, timeline,
            budget_range, reference_url, status, estimate_total_cents)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'submitted',$9)
         RETURNING *`,
        [req.user?.id ?? null, contactName, contactEmail, title, description,
         timeline || null, budgetRange || null, referenceUrl || null, priced.total_cents]
      );
      const created = rows[0];
      for (const item of priced.items) {
        await client.query(
          `INSERT INTO project_request_items
             (request_id, service_id, name_snapshot, pricing_type, quantity, unit_price_cents)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [created.id, item.service_id, item.name_snapshot, item.pricing_type, item.quantity, item.unit_price_cents]
        );
      }
      return created;
    });

    logger.info('request_submitted', { requestId: request.id, items: priced.items.length });
    res.status(201).json({
      request: { id: request.id, title: request.title, status: request.status,
                 estimate_total_cents: request.estimate_total_cents },
      dropped_service_ids: priced.dropped_service_ids,
      linked_to_account: Boolean(req.user),
    });
  } catch (err) {
    next(err);
  }
});

/** A customer's own requests. */
requestsRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const requests = await many(
      `SELECT r.id, r.title, r.status, r.estimate_total_cents, r.created_at,
              q.id AS quote_id, q.status AS quote_status, q.total_cents AS quote_total_cents
         FROM project_requests r
         LEFT JOIN LATERAL (
           SELECT id, status, total_cents FROM quotes
            WHERE request_id = r.id AND status <> 'draft'
            ORDER BY created_at DESC LIMIT 1
         ) q ON true
        WHERE r.user_id = $1
        ORDER BY r.created_at DESC`,
      [req.user.id]
    );
    res.json({ requests });
  } catch (err) {
    next(err);
  }
});

requestsRouter.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const requestId = validId(req.params.id);
    // The user_id filter is the access check - a customer can only read their own.
    const request = await one(
      'SELECT * FROM project_requests WHERE id = $1 AND user_id = $2',
      [requestId, req.user.id]
    );
    if (!request) throw notFound('We could not find that request on your account.');

    request.items = await many(
      `SELECT name_snapshot, quantity, unit_price_cents,
              (quantity * unit_price_cents)::int AS line_total_cents
         FROM project_request_items WHERE request_id = $1 ORDER BY id`,
      [requestId]
    );
    request.quotes = await many(
      `SELECT id, status, total_cents, currency, expires_at, sent_at, accepted_at
         FROM quotes WHERE request_id = $1 AND status <> 'draft' ORDER BY created_at DESC`,
      [requestId]
    );
    res.json({ request });
  } catch (err) {
    next(err);
  }
});
