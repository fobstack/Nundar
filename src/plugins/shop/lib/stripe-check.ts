/**
 * The admin's "Test" buttons beside the two Stripe secrets.
 *
 * Read-only, as Mallok asks of a check: the secret key is tried on a read of
 * the account's balance, and the signing secret, which only Stripe's own
 * deliveries can prove, is checked for its shape. Only the verdict leaves
 * the Worker, never the secret.
 */

import type { PluginContext, PluginSecretVerdict } from 'mallok/worker';
import { STRIPE_API_VERSION } from './stripe-client.js';
import { stripeSecret } from './stripe-secrets.js';

export async function checkStripeSecretKey(
  ctx: Pick<PluginContext, 'secrets'>,
  fetchImpl: typeof fetch = fetch,
): Promise<PluginSecretVerdict> {
  const key = stripeSecret(ctx.secrets, 'stripe_secret_key');
  if (key === '') {
    return { ok: false, message: 'Not set.' };
  }
  const shape = /^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.exec(key);
  if (shape === null) {
    return {
      ok: false,
      message:
        'This is not a secret key: one begins sk_test_, sk_live_, rk_test_ or rk_live_. A publishable key (pk_) cannot take payments.',
    };
  }
  const mode = shape[2] === 'live' ? 'live mode' : 'test mode';
  let status = 0;
  try {
    const response = await fetchImpl('https://api.stripe.com/v1/balance', {
      headers: {
        Authorization: `Bearer ${key}`,
        'Stripe-Version': STRIPE_API_VERSION,
      },
    });
    status = response.status;
  } catch {
    return { ok: false, message: 'Stripe could not be reached. Try again.' };
  }
  if (status === 200) {
    return { ok: true, message: `Stripe accepts this key (${mode}).` };
  }
  if (status === 401) {
    return { ok: false, message: 'Stripe does not accept this key.' };
  }
  if (status === 403) {
    return {
      ok: true,
      message: `Stripe accepts this restricted key (${mode}) but it may not read the balance. Make sure it may write Checkout Sessions, Customers and Refunds.`,
    };
  }
  return {
    ok: false,
    message: `Stripe could not be asked (status ${status}). Try again.`,
  };
}

export async function checkStripeWebhookSecret(
  ctx: Pick<PluginContext, 'secrets'>,
): Promise<PluginSecretVerdict> {
  const secret = stripeSecret(ctx.secrets, 'stripe_webhook_secret');
  if (secret === '') {
    return { ok: false, message: 'Not set.' };
  }
  return /^whsec_[A-Za-z0-9]+$/.test(secret)
    ? {
        ok: true,
        message:
          'This is shaped like a signing secret. Only a delivery from Stripe proves it: send a test event from the webhook endpoint in Stripe.',
      }
    : {
        ok: false,
        message:
          'A signing secret begins whsec_. It is shown on the webhook endpoint in Stripe, not with the API keys.',
      };
}
