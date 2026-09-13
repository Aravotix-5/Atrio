import { withTransaction, one } from '../db/pool.js';
import { logger } from '../utils/logger.js';

/**
 * Marks a checkout as paid. Idempotent: running it twice for the same session
 * updates nothing the second time, so a replayed webhook cannot create a
 * duplicate payment or double-advance a project.
 *
 * Only ever called with data read from Stripe (a verified webhook payload or a
 * server-side session lookup) - never with data from the browser.
 */
export async function markCheckoutPaid(session) {
  if (!session?.id) return { updated: false, reason: 'no_session' };
  if (session.payment_status !== 'paid') {
    return { updated: false, reason: `payment_status=${session.payment_status}` };
  }

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE payments
          SET status = 'paid',
              paid_at = COALESCE(paid_at, now()),
              stripe_payment_intent_id = COALESCE($2, stripe_payment_intent_id),
              stripe_customer_id = COALESCE($3, stripe_customer_id),
              updated_at = now()
        WHERE stripe_checkout_session_id = $1
          AND status <> 'paid'
        RETURNING id, quote_id, project_id, amount_cents`,
      [
        session.id,
        typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null,
        typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null,
      ]
    );

    if (rows.length === 0) return { updated: false, reason: 'already_paid_or_unknown_session' };
    const payment = rows[0];

    await client.query(
      `UPDATE projects
          SET status = 'paid', updated_at = now()
        WHERE quote_id = $1 AND status = 'payment_pending'`,
      [payment.quote_id]
    );

    logger.info('payment_marked_paid', { paymentId: payment.id, quoteId: payment.quote_id });
    return { updated: true, payment };
  });
}

export async function markCheckoutFailed(sessionId, status = 'failed') {
  if (!sessionId) return;
  await one(
    `UPDATE payments SET status = $2, updated_at = now()
      WHERE stripe_checkout_session_id = $1 AND status = 'pending'
      RETURNING id`,
    [sessionId, status]
  );
}
