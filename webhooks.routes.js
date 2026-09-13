import { Router } from 'express';
import express from 'express';
import { query, one } from '../db/pool.js';
import { getStripe, stripeConfigured } from '../services/stripe.js';
import { markCheckoutPaid, markCheckoutFailed } from '../services/payments.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export const webhooksRouter = Router();

/**
 * Stripe webhook. Mounted with a raw body parser because signature
 * verification needs the exact bytes Stripe sent.
 *
 * This endpoint is the only thing that can mark a payment as paid from an
 * incoming request, and it only does so after verifying the signature.
 */
webhooksRouter.post('/stripe', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
  if (!stripeConfigured() || !config.stripe.webhookSecret) {
    logger.warn('webhook_received_but_stripe_not_configured');
    return res.status(503).json({ error: 'Webhooks are not configured.' });
  }

  let event;
  try {
    event = getStripe().webhooks.constructEvent(
      req.body,
      req.get('stripe-signature'),
      config.stripe.webhookSecret
    );
  } catch (err) {
    // Bad signature: someone is sending us events that are not from Stripe.
    logger.warn('webhook_signature_invalid', { message: err.message });
    return res.status(400).json({ error: 'Invalid signature.' });
  }

  try {
    // Idempotency gate: the first insert wins, replays fall straight through.
    const inserted = await query(
      `INSERT INTO webhook_events (event_id, type) VALUES ($1, $2)
       ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
      [event.id, event.type]
    );
    if (inserted.rowCount === 0) {
      logger.info('webhook_duplicate_ignored', { eventId: event.id, type: event.type });
      return res.json({ received: true, duplicate: true });
    }

    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object;
        await markCheckoutPaid(session);
        break;
      }
      case 'checkout.session.async_payment_failed': {
        await markCheckoutFailed(event.data.object.id, 'failed');
        break;
      }
      case 'checkout.session.expired': {
        await markCheckoutFailed(event.data.object.id, 'cancelled');
        break;
      }
      default:
        logger.info('webhook_ignored_type', { type: event.type });
    }

    res.json({ received: true });
  } catch (err) {
    // Returning 500 asks Stripe to retry, which is what we want on a DB blip.
    logger.error('webhook_processing_failed', { eventId: event?.id, message: err.message });
    await one('DELETE FROM webhook_events WHERE event_id = $1 RETURNING event_id', [event.id]).catch(() => {});
    res.status(500).json({ error: 'Could not process event.' });
  }
});
