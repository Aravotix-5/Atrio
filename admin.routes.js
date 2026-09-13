import { Router } from 'express';
import { many, one, query, withTransaction } from '../db/pool.js';
import { requireAdmin } from '../middleware/auth.js';
import { getAllServices, getAllCategories } from '../services/catalog.js';
import { getQuoteWithItems, recalculateQuote } from '../services/quotes.js';
import { assertStatus, getStatuses } from '../services/statuses.js';
import { slugify, uniqueSlug } from '../utils/slug.js';
import {
  FieldErrors, str, intIn, dollarsToCents, email, id as validId,
} from '../utils/validate.js';
import { badRequest, notFound, conflict } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export const adminRouter = Router();

// Every route below is admin-only, enforced on the server for each request.
adminRouter.use(requireAdmin);

/* ------------------------------------------------------------------ overview */

adminRouter.get('/overview', async (_req, res, next) => {
  try {
    const [counts] = await many(`
      SELECT
        (SELECT count(*) FROM users WHERE role = 'customer')                       AS customers,
        (SELECT count(*) FROM project_requests WHERE status IN ('submitted','under_review')) AS open_requests,
        (SELECT count(*) FROM quotes WHERE status = 'sent')                        AS quotes_awaiting,
        (SELECT count(*) FROM projects WHERE status NOT IN ('completed','cancelled')) AS active_projects,
        (SELECT COALESCE(SUM(amount_cents), 0) FROM payments WHERE status = 'paid') AS paid_cents,
        (SELECT count(*) FROM services WHERE active = true)                        AS active_services
    `);
    res.json({ overview: counts });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/statuses', async (_req, res, next) => {
  try {
    res.json({ statuses: await getStatuses() });
  } catch (err) {
    next(err);
  }
});

/* ----------------------------------------------------------------- customers */

adminRouter.get('/customers', async (req, res, next) => {
  try {
    const search = str(req.query.search, { field: 'search', max: 120 });
    const customers = await many(
      `SELECT u.id, u.name, u.email, u.role, u.created_at,
              (SELECT count(*) FROM project_requests r WHERE r.user_id = u.id) AS request_count,
              (SELECT count(*) FROM projects p WHERE p.user_id = u.id) AS project_count
         FROM users u
        WHERE ($1 = '' OR u.name ILIKE '%' || $1 || '%' OR u.email ILIKE '%' || $1 || '%')
        ORDER BY u.created_at DESC
        LIMIT 200`,
      [search]
    );
    res.json({ customers });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/customers/:id', async (req, res, next) => {
  try {
    const userId = validId(req.params.id);
    const customer = await one('SELECT id, name, email, role, created_at FROM users WHERE id = $1', [userId]);
    if (!customer) throw notFound('No such customer.');
    customer.requests = await many(
      `SELECT id, title, status, estimate_total_cents, created_at FROM project_requests
        WHERE user_id = $1 ORDER BY created_at DESC`, [userId]
    );
    customer.projects = await many(
      `SELECT id, title, status, created_at FROM projects WHERE user_id = $1 ORDER BY created_at DESC`, [userId]
    );
    customer.payments = await many(
      `SELECT id, amount_cents, currency, status, paid_at FROM payments
        WHERE user_id = $1 ORDER BY created_at DESC`, [userId]
    );
    res.json({ customer });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ services */

adminRouter.get('/services', async (_req, res, next) => {
  try {
    res.json({ services: await getAllServices(), categories: await getAllCategories() });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/services', async (req, res, next) => {
  try {
    const data = await readServiceBody(req.body);
    const slug = await uniqueSlug(
      slugify(data.name, 'service'),
      async (candidate) => Boolean(await one('SELECT 1 FROM services WHERE slug = $1', [candidate]))
    );
    const service = await one(
      `INSERT INTO services (category_id, name, slug, description, details, price_cents,
                             pricing_type, unit_label, max_quantity, active, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [data.category_id, data.name, slug, data.description, data.details, data.price_cents,
       data.pricing_type, data.unit_label, data.max_quantity, data.active, data.sort_order]
    );
    logger.info('service_created', { serviceId: service.id, by: req.user.id });
    res.status(201).json({ service });
  } catch (err) {
    next(err);
  }
});

adminRouter.patch('/services/:id', async (req, res, next) => {
  try {
    const serviceId = validId(req.params.id);
    const existing = await one('SELECT * FROM services WHERE id = $1', [serviceId]);
    if (!existing) throw notFound('No such service.');
    const data = await readServiceBody({ ...existing, ...req.body, price: req.body.price });
    const service = await one(
      `UPDATE services SET category_id=$2, name=$3, description=$4, details=$5, price_cents=$6,
              pricing_type=$7, unit_label=$8, max_quantity=$9, active=$10, sort_order=$11, updated_at=now()
        WHERE id=$1 RETURNING *`,
      [serviceId, data.category_id, data.name, data.description, data.details, data.price_cents,
       data.pricing_type, data.unit_label, data.max_quantity, data.active, data.sort_order]
    );
    logger.info('service_updated', { serviceId, by: req.user.id });
    res.json({ service });
  } catch (err) {
    next(err);
  }
});

/** Deactivates by default; permanently deletes only if nothing references it. */
adminRouter.delete('/services/:id', async (req, res, next) => {
  try {
    const serviceId = validId(req.params.id);
    const used = await one(
      `SELECT 1 FROM project_request_items WHERE service_id = $1
        UNION ALL SELECT 1 FROM quote_items WHERE service_id = $1 LIMIT 1`,
      [serviceId]
    );
    if (used || req.query.hard !== 'true') {
      const service = await one(
        'UPDATE services SET active = false, updated_at = now() WHERE id = $1 RETURNING *', [serviceId]
      );
      if (!service) throw notFound('No such service.');
      return res.json({ service, deactivated: true });
    }
    await query('DELETE FROM services WHERE id = $1', [serviceId]);
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/categories', async (req, res, next) => {
  try {
    const errors = new FieldErrors();
    const name = str(req.body?.name, { field: 'name', required: true, min: 2, max: 80, errors });
    const description = str(req.body?.description, { field: 'description', max: 400, errors });
    const sortOrder = intIn(req.body?.sort_order, { field: 'sort_order', min: 0, max: 9999, fallback: 100, errors });
    errors.throwIfAny();
    const slug = await uniqueSlug(
      slugify(name, 'category'),
      async (candidate) => Boolean(await one('SELECT 1 FROM service_categories WHERE slug = $1', [candidate]))
    );
    const category = await one(
      `INSERT INTO service_categories (name, slug, description, sort_order)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [name, slug, description || null, sortOrder]
    );
    res.status(201).json({ category });
  } catch (err) {
    next(err);
  }
});

async function readServiceBody(body) {
  const errors = new FieldErrors();
  const name = str(body?.name, { field: 'name', required: true, min: 2, max: 120, errors });
  const description = str(body?.description, { field: 'description', required: true, min: 5, max: 400, errors });
  const details = str(body?.details, { field: 'details', max: 1000, errors });
  const categoryId = intIn(body?.category_id, { field: 'category_id', min: 1, max: 1e9, errors });
  const pricingType = ['fixed', 'starting', 'quantity'].includes(body?.pricing_type) ? body.pricing_type : 'fixed';
  const priceCents = body?.price !== undefined && body?.price !== null && body?.price !== ''
    ? dollarsToCents(body.price, { field: 'price', errors })
    : intIn(body?.price_cents, { field: 'price', min: 0, max: 1e9, fallback: 0, errors });
  const maxQuantity = pricingType === 'quantity'
    ? intIn(body?.max_quantity, { field: 'max_quantity', min: 1, max: 999, fallback: 10, errors })
    : 1;
  const unitLabel = str(body?.unit_label, { field: 'unit_label', max: 40, errors }) || null;
  const sortOrder = intIn(body?.sort_order, { field: 'sort_order', min: 0, max: 99999, fallback: 500, errors });
  const active = body?.active === undefined ? true : Boolean(body.active);
  errors.throwIfAny();

  const category = await one('SELECT id FROM service_categories WHERE id = $1', [categoryId]);
  if (!category) throw badRequest('Choose an existing category.', { category_id: 'Unknown category.' });

  return { name, description, details: details || null, category_id: categoryId,
           pricing_type: pricingType, price_cents: priceCents, max_quantity: maxQuantity,
           unit_label: unitLabel, sort_order: sortOrder, active };
}

/* ------------------------------------------------------------------ requests */

adminRouter.get('/requests', async (req, res, next) => {
  try {
    const search = str(req.query.search, { field: 'search', max: 120 });
    const status = str(req.query.status, { field: 'status', max: 40 });
    const requests = await many(
      `SELECT r.id, r.title, r.status, r.contact_name, r.contact_email, r.estimate_total_cents,
              r.created_at, u.id AS user_id,
              (SELECT count(*) FROM quotes q WHERE q.request_id = r.id) AS quote_count
         FROM project_requests r
         LEFT JOIN users u ON u.id = r.user_id
        WHERE ($1 = '' OR r.title ILIKE '%' || $1 || '%' OR r.contact_email ILIKE '%' || $1 || '%'
               OR r.contact_name ILIKE '%' || $1 || '%')
          AND ($2 = '' OR r.status = $2)
        ORDER BY r.created_at DESC
        LIMIT 200`,
      [search, status]
    );
    res.json({ requests });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/requests/:id', async (req, res, next) => {
  try {
    const requestId = validId(req.params.id);
    const request = await one(
      `SELECT r.*, u.name AS user_name, u.email AS user_email
         FROM project_requests r LEFT JOIN users u ON u.id = r.user_id
        WHERE r.id = $1`, [requestId]
    );
    if (!request) throw notFound('No such request.');
    request.items = await many(
      `SELECT id, service_id, name_snapshot, quantity, unit_price_cents,
              (quantity * unit_price_cents)::int AS line_total_cents
         FROM project_request_items WHERE request_id = $1 ORDER BY id`, [requestId]
    );
    request.quotes = await many(
      `SELECT id, status, total_cents, currency, sent_at, accepted_at, expires_at, created_at
         FROM quotes WHERE request_id = $1 ORDER BY created_at DESC`, [requestId]
    );
    request.notes = await many(
      `SELECT n.id, n.body, n.internal, n.created_at, u.name AS author_name
         FROM notes n LEFT JOIN users u ON u.id = n.author_id
        WHERE n.entity_type = 'request' AND n.entity_id = $1
        ORDER BY n.created_at DESC`, [requestId]
    );
    res.json({ request });
  } catch (err) {
    next(err);
  }
});

adminRouter.patch('/requests/:id', async (req, res, next) => {
  try {
    const requestId = validId(req.params.id);
    const status = await assertStatus('request', String(req.body?.status || ''));
    const request = await one(
      'UPDATE project_requests SET status = $2, updated_at = now() WHERE id = $1 RETURNING *',
      [requestId, status]
    );
    if (!request) throw notFound('No such request.');
    res.json({ request });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/requests/:id/notes', async (req, res, next) => {
  try {
    const requestId = validId(req.params.id);
    const errors = new FieldErrors();
    const body = str(req.body?.body, { field: 'body', required: true, min: 1, max: 2000, errors });
    errors.throwIfAny();
    const note = await one(
      `INSERT INTO notes (entity_type, entity_id, author_id, body, internal)
       VALUES ('request', $1, $2, $3, $4) RETURNING *`,
      [requestId, req.user.id, body, req.body?.internal !== false]
    );
    res.status(201).json({ note });
  } catch (err) {
    next(err);
  }
});

/* -------------------------------------------------------------------- quotes */

adminRouter.get('/quotes', async (req, res, next) => {
  try {
    const status = str(req.query.status, { field: 'status', max: 40 });
    const quotes = await many(
      `SELECT q.id, q.status, q.total_cents, q.currency, q.created_at, q.sent_at, q.expires_at,
              r.title AS request_title, r.contact_email
         FROM quotes q JOIN project_requests r ON r.id = q.request_id
        WHERE ($1 = '' OR q.status = $1)
        ORDER BY q.created_at DESC LIMIT 200`,
      [status]
    );
    res.json({ quotes });
  } catch (err) {
    next(err);
  }
});

/** Creates a draft quote pre-filled from the customer's requested services. */
adminRouter.post('/quotes', async (req, res, next) => {
  try {
    const requestId = validId(req.body?.request_id, { field: 'request id' });
    const request = await one('SELECT * FROM project_requests WHERE id = $1', [requestId]);
    if (!request) throw notFound('No such request.');

    const quote = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO quotes (request_id, user_id, status, currency)
         VALUES ($1, $2, 'draft', 'usd') RETURNING *`,
        [requestId, request.user_id]
      );
      const created = rows[0];
      const items = await client.query(
        `SELECT service_id, name_snapshot, quantity, unit_price_cents
           FROM project_request_items WHERE request_id = $1 ORDER BY id`, [requestId]
      );
      let order = 0;
      for (const item of items.rows) {
        order += 10;
        await client.query(
          `INSERT INTO quote_items (quote_id, service_id, description, quantity, unit_price_cents, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [created.id, item.service_id, item.name_snapshot, item.quantity, item.unit_price_cents, order]
        );
      }
      await client.query(
        `UPDATE project_requests SET status = 'under_review', updated_at = now()
          WHERE id = $1 AND status = 'submitted'`, [requestId]
      );
      return created;
    });

    await recalculateQuote(quote.id);
    res.status(201).json({ quote: await getQuoteWithItems(quote.id) });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/quotes/:id', async (req, res, next) => {
  try {
    const quote = await getQuoteWithItems(validId(req.params.id));
    if (!quote) throw notFound('No such quote.');
    res.json({ quote });
  } catch (err) {
    next(err);
  }
});

adminRouter.patch('/quotes/:id', async (req, res, next) => {
  try {
    const quoteId = validId(req.params.id);
    const quote = await one('SELECT * FROM quotes WHERE id = $1', [quoteId]);
    if (!quote) throw notFound('No such quote.');
    assertEditable(quote);

    const errors = new FieldErrors();
    const adjustment = req.body?.adjustment === undefined || req.body?.adjustment === ''
      ? quote.adjustment_cents
      : dollarsToCents(req.body.adjustment, { field: 'adjustment', errors, allowNegative: true });
    const adjustmentLabel = str(req.body?.adjustment_label ?? quote.adjustment_label ?? '', { field: 'adjustment_label', max: 120, errors });
    const notes = str(req.body?.notes ?? quote.notes ?? '', { field: 'notes', max: 4000, errors });
    let expiresAt = quote.expires_at;
    if (req.body?.expires_at !== undefined) {
      expiresAt = req.body.expires_at ? new Date(req.body.expires_at) : null;
      if (expiresAt && Number.isNaN(expiresAt.getTime())) errors.add('expires_at', 'Use a valid date.');
    }
    errors.throwIfAny();

    await query(
      `UPDATE quotes SET adjustment_cents = $2, adjustment_label = $3, notes = $4, expires_at = $5, updated_at = now()
        WHERE id = $1`,
      [quoteId, adjustment, adjustmentLabel || null, notes || null, expiresAt]
    );
    await recalculateQuote(quoteId);
    res.json({ quote: await getQuoteWithItems(quoteId) });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/quotes/:id/items', async (req, res, next) => {
  try {
    const quoteId = validId(req.params.id);
    const quote = await one('SELECT * FROM quotes WHERE id = $1', [quoteId]);
    if (!quote) throw notFound('No such quote.');
    assertEditable(quote);

    const errors = new FieldErrors();
    let description = str(req.body?.description, { field: 'description', max: 200, errors });
    const quantity = intIn(req.body?.quantity, { field: 'quantity', min: 1, max: 999, fallback: 1, errors });
    let unitPrice = req.body?.unit_price === undefined || req.body?.unit_price === ''
      ? null
      : dollarsToCents(req.body.unit_price, { field: 'unit_price', errors });

    // Adding a catalog service copies its current name and price.
    let serviceId = null;
    if (req.body?.service_id) {
      serviceId = validId(req.body.service_id, { field: 'service id' });
      const service = await one('SELECT id, name, price_cents FROM services WHERE id = $1', [serviceId]);
      if (!service) throw badRequest('That service no longer exists.');
      if (!description) description = service.name;
      if (unitPrice === null) unitPrice = service.price_cents;
    }
    if (!description) errors.add('description', 'Describe the line item.');
    if (unitPrice === null) errors.add('unit_price', 'Enter an amount.');
    errors.throwIfAny();

    await query(
      `INSERT INTO quote_items (quote_id, service_id, description, quantity, unit_price_cents, sort_order)
       VALUES ($1,$2,$3,$4,$5, COALESCE((SELECT MAX(sort_order) + 10 FROM quote_items WHERE quote_id = $1), 10))`,
      [quoteId, serviceId, description, quantity, unitPrice]
    );
    await recalculateQuote(quoteId);
    res.status(201).json({ quote: await getQuoteWithItems(quoteId) });
  } catch (err) {
    next(err);
  }
});

adminRouter.patch('/quotes/:id/items/:itemId', async (req, res, next) => {
  try {
    const quoteId = validId(req.params.id);
    const itemId = validId(req.params.itemId, { field: 'item id' });
    const quote = await one('SELECT * FROM quotes WHERE id = $1', [quoteId]);
    if (!quote) throw notFound('No such quote.');
    assertEditable(quote);

    const item = await one('SELECT * FROM quote_items WHERE id = $1 AND quote_id = $2', [itemId, quoteId]);
    if (!item) throw notFound('No such line item.');

    const errors = new FieldErrors();
    const description = str(req.body?.description ?? item.description, { field: 'description', required: true, max: 200, errors });
    const quantity = intIn(req.body?.quantity ?? item.quantity, { field: 'quantity', min: 1, max: 999, fallback: item.quantity, errors });
    const unitPrice = req.body?.unit_price === undefined || req.body?.unit_price === ''
      ? item.unit_price_cents
      : dollarsToCents(req.body.unit_price, { field: 'unit_price', errors });
    errors.throwIfAny();

    await query(
      `UPDATE quote_items SET description = $3, quantity = $4, unit_price_cents = $5
        WHERE id = $1 AND quote_id = $2`,
      [itemId, quoteId, description, quantity, unitPrice]
    );
    await recalculateQuote(quoteId);
    res.json({ quote: await getQuoteWithItems(quoteId) });
  } catch (err) {
    next(err);
  }
});

adminRouter.delete('/quotes/:id/items/:itemId', async (req, res, next) => {
  try {
    const quoteId = validId(req.params.id);
    const itemId = validId(req.params.itemId, { field: 'item id' });
    const quote = await one('SELECT * FROM quotes WHERE id = $1', [quoteId]);
    if (!quote) throw notFound('No such quote.');
    assertEditable(quote);
    await query('DELETE FROM quote_items WHERE id = $1 AND quote_id = $2', [itemId, quoteId]);
    await recalculateQuote(quoteId);
    res.json({ quote: await getQuoteWithItems(quoteId) });
  } catch (err) {
    next(err);
  }
});

/** Finalise and release the quote to the customer. */
adminRouter.post('/quotes/:id/send', async (req, res, next) => {
  try {
    const quoteId = validId(req.params.id);
    const quote = await getQuoteWithItems(quoteId);
    if (!quote) throw notFound('No such quote.');
    if (quote.status === 'accepted') throw conflict('This quote is already accepted.');
    if (quote.items.length === 0) throw badRequest('Add at least one line item before sending.');
    if (quote.total_cents <= 0) throw badRequest('The total must be more than zero.');
    if (!quote.user_id) {
      throw badRequest('This request came from a guest. Ask them to create an account with the same email, then send the quote.');
    }

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE quotes SET status = 'sent', sent_at = now(), updated_at = now(),
                expires_at = COALESCE(expires_at, now() + interval '30 days')
          WHERE id = $1`, [quoteId]
      );
      await client.query(
        `UPDATE project_requests SET status = 'quote_sent', updated_at = now() WHERE id = $1`,
        [quote.request_id]
      );
    });
    logger.info('quote_sent', { quoteId, by: req.user.id });
    res.json({ quote: await getQuoteWithItems(quoteId) });
  } catch (err) {
    next(err);
  }
});

function assertEditable(quote) {
  if (['accepted'].includes(quote.status)) {
    throw conflict('This quote has been accepted and can no longer be edited. Create a new quote instead.');
  }
}

/* ------------------------------------------------------------------ projects */

adminRouter.get('/projects', async (req, res, next) => {
  try {
    const status = str(req.query.status, { field: 'status', max: 40 });
    const projects = await many(
      `SELECT p.id, p.title, p.status, p.created_at, p.updated_at, q.total_cents,
              u.name AS customer_name, u.email AS customer_email,
              (SELECT status FROM payments WHERE quote_id = q.id ORDER BY created_at DESC LIMIT 1) AS payment_status
         FROM projects p
         JOIN quotes q ON q.id = p.quote_id
         LEFT JOIN users u ON u.id = p.user_id
        WHERE ($1 = '' OR p.status = $1)
        ORDER BY p.created_at DESC LIMIT 200`,
      [status]
    );
    res.json({ projects });
  } catch (err) {
    next(err);
  }
});

adminRouter.patch('/projects/:id', async (req, res, next) => {
  try {
    const projectId = validId(req.params.id);
    const status = await assertStatus('project', String(req.body?.status || ''));
    const project = await one(
      'UPDATE projects SET status = $2, updated_at = now() WHERE id = $1 RETURNING *',
      [projectId, status]
    );
    if (!project) throw notFound('No such project.');
    res.json({ project });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/projects/:id/notes', async (req, res, next) => {
  try {
    const projectId = validId(req.params.id);
    const errors = new FieldErrors();
    const body = str(req.body?.body, { field: 'body', required: true, min: 1, max: 2000, errors });
    errors.throwIfAny();
    const note = await one(
      `INSERT INTO notes (entity_type, entity_id, author_id, body, internal)
       VALUES ('project', $1, $2, $3, $4) RETURNING *`,
      [projectId, req.user.id, body, req.body?.internal !== false]
    );
    res.status(201).json({ note });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/projects/:id/notes', async (req, res, next) => {
  try {
    const projectId = validId(req.params.id);
    const notes = await many(
      `SELECT n.id, n.body, n.internal, n.created_at, u.name AS author_name
         FROM notes n LEFT JOIN users u ON u.id = n.author_id
        WHERE n.entity_type = 'project' AND n.entity_id = $1 ORDER BY n.created_at DESC`,
      [projectId]
    );
    res.json({ notes });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ payments */

adminRouter.get('/payments', async (req, res, next) => {
  try {
    const status = str(req.query.status, { field: 'status', max: 40 });
    // Stripe ids are references, not card data. No card details exist anywhere.
    const payments = await many(
      `SELECT p.id, p.quote_id, p.project_id, p.amount_cents, p.currency, p.status,
              p.paid_at, p.created_at, p.stripe_checkout_session_id, p.stripe_payment_intent_id,
              u.name AS customer_name, u.email AS customer_email
         FROM payments p LEFT JOIN users u ON u.id = p.user_id
        WHERE ($1 = '' OR p.status = $1)
        ORDER BY p.created_at DESC LIMIT 200`,
      [status]
    );
    res.json({ payments });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ settings */

// Only these keys can be edited from the dashboard. Anything else is ignored,
// so a stray field in a request cannot write arbitrary rows.
const EDITABLE_SETTINGS = {
  business_name: { max: 120 },
  business_email: { max: 200 },
  business_tagline: { max: 200 },
  estimate_disclaimer: { max: 500 },
};

adminRouter.get('/settings', async (_req, res, next) => {
  try {
    const rows = await many('SELECT key, value FROM site_settings ORDER BY key');
    res.json({
      settings: Object.fromEntries(rows.map((r) => [r.key, r.value])),
      editable: Object.keys(EDITABLE_SETTINGS),
    });
  } catch (err) {
    next(err);
  }
});

adminRouter.patch('/settings', async (req, res, next) => {
  try {
    const errors = new FieldErrors();
    const updates = [];

    for (const [key, rules] of Object.entries(EDITABLE_SETTINGS)) {
      if (!(key in req.body)) continue;
      let value;
      if (key === 'business_email') {
        value = email(req.body[key], { field: key, errors, required: true });
      } else {
        value = str(req.body[key], { field: key, max: rules.max, required: true, errors });
      }
      if (value) updates.push([key, value]);
    }

    errors.throwIfAny();
    if (!updates.length) throw badRequest('Nothing to update.');

    await withTransaction(async (client) => {
      for (const [key, value] of updates) {
        await client.query(
          `INSERT INTO site_settings (key, value) VALUES ($1, $2)
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
          [key, value]
        );
      }
    });

    logger.info('settings updated', { keys: updates.map(([k]) => k) });
    const rows = await many('SELECT key, value FROM site_settings ORDER BY key');
    res.json({ settings: Object.fromEntries(rows.map((r) => [r.key, r.value])) });
  } catch (err) {
    next(err);
  }
});
