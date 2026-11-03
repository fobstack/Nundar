/**
 * The two Stripe secrets, as the shop reads them from Mallok's store.
 *
 * Mallok keeps a secret exactly as it was pasted, white space and all. Copied
 * from the line `stripe listen` prints, a signing secret came with the space
 * before it, and every delivery failed its signature from then on, with
 * nothing in the admin to say why (found in the first purchase in Stripe's
 * test mode, 2026-11-03). Neither secret can contain white space, so what is
 * around one is not part of it. Every reading goes through here: one that did
 * not would take a key the others accept, or refuse one they take.
 */

export type StripeSecretName = 'stripe_secret_key' | 'stripe_webhook_secret';

/** The secret as Stripe issued it, or '' when it is not set. */
export function stripeSecret(
  secrets: Readonly<Record<string, string>> | undefined,
  name: StripeSecretName,
): string {
  return (secrets?.[name] ?? '').trim();
}
