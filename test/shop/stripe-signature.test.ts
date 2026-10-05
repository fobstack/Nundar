import { describe, expect, it } from 'vitest';
import { verifyStripeSignature } from '../../src/plugins/shop/lib/stripe-signature.js';
import { signStripePayload } from './helpers.js';

const SECRET = 'whsec_test_secret';
const PAYLOAD = '{"id":"evt_1","type":"payment_intent.succeeded"}';

async function header(payload: string, offsetSeconds = 0, secret = SECRET) {
  const timestamp = Math.floor(Date.now() / 1000) + offsetSeconds;
  return `t=${timestamp},v1=${await signStripePayload(payload, timestamp, secret)}`;
}

describe('verifyStripeSignature', () => {
  it('accepts a correctly signed payload', async () => {
    const result = await verifyStripeSignature(
      PAYLOAD,
      await header(PAYLOAD),
      SECRET,
    );
    expect(result.ok).toBe(true);
  });

  it('rejects a payload that was altered after signing', async () => {
    const signature = await header(PAYLOAD);
    const result = await verifyStripeSignature(
      PAYLOAD.replace('evt_1', 'evt_2'),
      signature,
      SECRET,
    );

    expect(result).toEqual({ ok: false, reason: 'Signature mismatch' });
  });

  it('rejects a signature made with a different secret', async () => {
    const result = await verifyStripeSignature(
      PAYLOAD,
      await header(PAYLOAD, 0, 'whsec_wrong'),
      SECRET,
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a stale timestamp, so a captured request cannot be replayed', async () => {
    const result = await verifyStripeSignature(
      PAYLOAD,
      await header(PAYLOAD, -60 * 60),
      SECRET,
    );

    expect(result).toEqual({
      ok: false,
      reason: 'Signature timestamp outside tolerance',
    });
  });

  it('rejects a timestamp far in the future', async () => {
    const result = await verifyStripeSignature(
      PAYLOAD,
      await header(PAYLOAD, 60 * 60),
      SECRET,
    );
    expect(result.ok).toBe(false);
  });

  it('accepts a timestamp just inside the five-minute tolerance', async () => {
    const result = await verifyStripeSignature(
      PAYLOAD,
      await header(PAYLOAD, -(5 * 60 - 5)),
      SECRET,
    );
    expect(result.ok).toBe(true);
  });

  it('rejects a malformed header', async () => {
    for (const bad of ['', 'garbage', 't=abc,v1=def', 'v1=onlysignature']) {
      const result = await verifyStripeSignature(PAYLOAD, bad, SECRET);
      expect(result.ok).toBe(false);
    }
  });

  it('reads the timestamp as digits and nothing else', async () => {
    // Each of these is the right moment written another way, signed over the
    // text exactly as written, so only the parsing of `t` decides.
    const now = Math.floor(Date.now() / 1000);
    for (const written of [
      `${now}.0`,
      `${now / 1000}e3`,
      `0x${now.toString(16)}`,
      ` ${now}=x`,
      `+${now}`,
    ]) {
      const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(SECRET),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      );
      const mac = new Uint8Array(
        await crypto.subtle.sign(
          'HMAC',
          key,
          new TextEncoder().encode(`${now}.${PAYLOAD}`),
        ),
      );
      const signature = [...mac]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');

      const result = await verifyStripeSignature(
        PAYLOAD,
        `t=${written},v1=${signature}`,
        SECRET,
        now,
      );

      expect(result, written).toEqual({
        ok: false,
        reason: 'Malformed Stripe-Signature header',
      });
    }
  });

  it('ignores every scheme but v1, so a downgrade cannot pass', async () => {
    // Stripe sends a `v0` signature alongside `v1` on test events. A header
    // whose only correct signature sits under another scheme must not verify.
    const timestamp = Math.floor(Date.now() / 1000);
    const good = await signStripePayload(PAYLOAD, timestamp, SECRET);

    const result = await verifyStripeSignature(
      PAYLOAD,
      `t=${timestamp},v0=${good}`,
      SECRET,
    );
    expect(result.ok).toBe(false);
  });

  it('accepts a header carrying several v1 signatures during a secret rotation', async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const good = await signStripePayload(PAYLOAD, timestamp, SECRET);
    const other = await signStripePayload(PAYLOAD, timestamp, 'whsec_other');

    const result = await verifyStripeSignature(
      PAYLOAD,
      `t=${timestamp},v1=${other},v1=${good}`,
      SECRET,
    );
    expect(result.ok).toBe(true);
  });

  it('refuses to verify when no secret is configured', async () => {
    // An empty secret must never mean "accept anything": HMAC with an empty
    // key is a value anyone can compute.
    const timestamp = Math.floor(Date.now() / 1000);
    const forged = await signStripePayload(PAYLOAD, timestamp, '');

    const result = await verifyStripeSignature(
      PAYLOAD,
      `t=${timestamp},v1=${forged}`,
      '',
    );

    expect(result).toEqual({
      ok: false,
      reason: 'No webhook secret configured',
    });
  });
});
