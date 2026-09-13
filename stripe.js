import Stripe from 'stripe';
import { config } from '../config.js';
import { unavailable } from '../utils/errors.js';

let client = null;

/** Returns a Stripe client, or throws a clear 503 if keys are not configured. */
export function getStripe() {
  if (!config.stripe.configured) {
    throw unavailable('Online payments are not set up yet. Contact Atrio to arrange payment.');
  }
  if (!client) {
    client = new Stripe(config.stripe.secretKey, {
      apiVersion: '2024-11-20.acacia',
      appInfo: { name: 'Atrio', version: '1.0.0' },
    });
  }
  return client;
}

export const stripeConfigured = () => config.stripe.configured;
export const webhookSecretConfigured = () => Boolean(config.stripe.webhookSecret);
