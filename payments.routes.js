import { Router } from 'express';
import { one, many, query } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { getStripe, stripeConfigured } from '../services/stripe.js';
import { getQuoteWithItems } from '../services/quotes.js';
import { markCheckoutPaid } from '../services/payments.js';
import { config } from '../config.js';
import { id as validId } from '../utils/validate.js';
import { badRequest, notFound } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export const paymentsRouter = Router();

paymentsRouter.get('/config', (_req, res) => {
  // Public, non-secret information only.
  res.json({ enabled: stripeConfigured(), currency: config.currency });
});

paymentsRouter.use(requireAuth);

/** Customer's own payment history. No card data exists to return. */
paymentsRouter.get('/', async (req, res, next) => {
  try {
    const payments = await many(
      `SELECT p.id, p.quote_id, p.project_id, p.amount_cents, p.currency, p.status,
              p.paid_at, p.created_at, r.title AS project_title
         FROM payments p
         JOIN quotes q ON q.id = p.quote_id
         JOIN project_requests r ON r.id = q.request_id
        WHERE p.user_id = $1
        ORDER BY p.created_at DESC`,
      [req.user.id]
    );
    res.json({ payments });
  } catch (err) {
    next(err);
  }
});

/**
 * Creates a Stripe Checkout Session for an accepted quote.
 * The amount is read from the database. Nothing about price is accepted from
 * the browser - the request body only names which quote to pay.
 */
paymentsRouter.post('/checkout-session', async (req, res, next) => {
  try {
    const quoteId = validId(req.body?.quote_id, { field: 'quote id' });
    const owner = await one('SELECT user_id FROM quotes WHERE id = $1', [quoteId]);
    if (!owner || owner.user_id !== req.user.id) throw notFound('We could not find that quote on your account.');

    const quote = await getQuoteWithItems(quoteId);
    if (quote.status !== 'accepted') throw badRequest('Accept the quote before paying.');
    if (quote.total_cents <= 0) throw badRequest('This quote has no amount to pay. Contact Atrio.');
    if (quote.payments.some((p) => p.status === 'paid')) throw badRequest('This quote is already paid.');

    const stripe = getStripe(); // throws a clear 503 if keys are missing

    // Itemise when there is no adjustment; otherwise send one authoritative
    // line so the charged amount always equals the stored total.
    const lineItems = quote.adjustment_cents === 0
      ? quote.items.map((item) => ({
          quantity: item.quantity,
          price_data: {
            currency: quote.currency,
            unit_amount: item.unit_price_cents,
            product_data: { name: item.description.slice(0, 250) },
          },
        }))
      : [{
          quantity: 1,
          price_data: {
            currency: quote.currency,
            unit_amount: quote.total_cents,
            product_data: { name: `${quote.request_title} - quote #${quote.id}`.slice(0, 250) },
          },
        }];

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems,
      customer_email: req.user.email,
      client_reference_id: String(quote.id),
      metadata: { quote_id: String(quote.id), user_id: String(req.user.id) },
      success_url: `${config.appUrl}/checkout-complete.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.appUrl}/account.html?payment=cancelled`,
    });

    await query(
      `INSERT INTO payments (quote_id, project_id, user_id, stripe_checkout_session_id,
                             amount_cents, currency, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       ON CONFLICT (stripe_checkout_session_id) DO NOTHING`,
      [quote.id, quote.project_id ?? null, req.user.id, session.id, quote.total_cents, quote.currency]
    );

    logger.info('checkout_session_created', { quoteId: quote.id, userId: req.user.id });
    res.json({ url: session.url });
  } catch (err) {
    next(err);
  }
});

/**
 * Status for the return page. The page NEVER decides payment succeeded on its
 * own: we read our database, and if the webhook has not arrived yet we ask
 * Stripe directly and apply the same verified update.
 */
paymentsRouter.get('/session/:sessionId', async (req, res, next) => {
  try {
    const sessionId = String(req.params.sessionId || '').slice(0, 200);
    const payment = await one(
      `SELECT id, quote_id, project_id, status, amount_cents, currency, paid_at
         FROM payments WHERE stripe_checkout_session_id = $1 AND user_id = $2`,
      [sessionId, req.user.id]
    );
    if (!payment) throw notFound('We could not find that payment on your account.');

    if (payment.status === 'pending' && stripeConfigured()) {
      const session = await getStripe().checkout.sessions.retrieve(sessionId);
      const result = await markCheckoutPaid(session);
      if (result.updated) payment.status = 'paid';
    }

    res.json({ payment });
  } catch (err) {
    next(err);
  }
});
