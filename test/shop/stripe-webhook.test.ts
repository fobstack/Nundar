import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { priceCart } from '../../src/plugins/shop/lib/cart-pricing.js';
import { cancelOrder } from '../../src/plugins/shop/lib/order-fulfilment.js';
import {
  createPendingOrder,
  recordCheckoutSession,
} from '../../src/plugins/shop/lib/orders.js';
import { handleStripeWebhook } from '../../src/plugins/shop/lib/stripe-webhook.js';
import {
  clearShopTables,
  createProduct,
  createVariant,
  db,
  ensureSite,
  outboxRows,
  setPrice,
  setStock,
  signStripePayload,
  stockOf,
  type TestProduct,
} from './helpers.js';

const SECRET = 'whsec_test_secret';
const NOW = new Date('2026-10-05T08:00:00.000Z');
const BUYER_EMAIL = 'jane@example.com';

let valve: TestProduct;

async function pendingOrder(): Promise<{ id: string; orderNo: string }> {
  const cart = await priceCart(db(), {
    lines: [{ variantId: 'dn50', quantity: 10 }],
    locale: 'en',
    defaultLocale: 'en',
    currency: 'USD',
  });
  if (!cart.ok) {
    throw new Error(`The fixture cart did not price: ${JSON.stringify(cart)}`);
  }
  return createPendingOrder(db(), {
    cart,
    locale: 'en',
    email: BUYER_EMAIL,
    shippingAddress: {
      recipient: 'Jane Buyer',
      line1: '1 Harbour Road',
      city: 'Aberdeen',
      postalCode: 'AB11 5RY',
      country: 'GB',
    },
    now: NOW,
  });
}

/** The event Stripe sends when a payment succeeds, for one of our orders. */
function paymentSucceeded(
  orderId: string | null,
  overrides: {
    eventId?: string;
    paymentIntentId?: string;
    amount?: number;
    currency?: string;
  } = {},
): unknown {
  return {
    id: overrides.eventId ?? 'evt_1',
    object: 'event',
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: overrides.paymentIntentId ?? 'pi_1',
        object: 'payment_intent',
        amount: overrides.amount ?? 99_000,
        amount_received: overrides.amount ?? 99_000,
        currency: overrides.currency ?? 'usd',
        metadata: orderId === null ? {} : { order_id: orderId },
      },
    },
  };
}

/** The event Stripe sends when a Checkout session lapses unpaid. */
function sessionExpired(
  orderId: string | null,
  sessionId = 'cs_1',
  eventId = 'evt_expired',
): unknown {
  return {
    id: eventId,
    object: 'event',
    type: 'checkout.session.expired',
    data: {
      object: {
        id: sessionId,
        object: 'checkout.session',
        status: 'expired',
        metadata: orderId === null ? {} : { order_id: orderId },
      },
    },
  };
}

/** Delivers a body as Stripe would: signed, with the time it was signed at. */
async function deliver(
  body: string,
  options: {
    signedAt?: Date;
    receivedAt?: Date;
    signingSecret?: string;
    configuredSecret?: string;
  } = {},
): ReturnType<typeof handleStripeWebhook> {
  const signedAt = options.signedAt ?? NOW;
  const timestamp = Math.floor(signedAt.getTime() / 1000);
  const signature = await signStripePayload(
    body,
    timestamp,
    options.signingSecret ?? SECRET,
  );
  return handleStripeWebhook(db(), {
    rawBody: body,
    signatureHeader: `t=${timestamp},v1=${signature}`,
    secret: options.configuredSecret ?? SECRET,
    now: options.receivedAt ?? signedAt,
  });
}

async function statusOf(orderId: string): Promise<string | undefined> {
  const row = await db()
    .prepare('SELECT status FROM p_shop_order WHERE id = ?')
    .bind(orderId)
    .first<{ status: string }>();
  return row?.status;
}

async function eventCount(): Promise<number> {
  const row = await db()
    .prepare('SELECT COUNT(*) AS n FROM p_shop_stripe_event')
    .first<{ n: number }>();
  return row?.n ?? 0;
}

beforeAll(async () => {
  await ensureSite();
  valve = await createProduct({
    title: 'Stainless ball valve',
    slug: 'webhook-ball-valve',
  });
});

beforeEach(async () => {
  await clearShopTables();
  await createVariant({
    id: 'dn50',
    productGroup: valve.translationGroup,
    sku: 'BV-DN50',
    moq: 10,
    stock: 100,
  });
  await setPrice({
    variantId: 'dn50',
    currency: 'USD',
    amountMinor: 9900,
    source: 'base',
  });
});

describe('handleStripeWebhook', () => {
  it('marks the order paid for a correctly signed payment event', async () => {
    const order = await pendingOrder();

    const outcome = await deliver(JSON.stringify(paymentSucceeded(order.id)));

    expect(outcome).toEqual({
      status: 200,
      kind: 'paid',
      orderId: order.id,
      availabilityChanged: [],
    });
    expect(await statusOf(order.id)).toBe('paid');
    expect(await stockOf('dn50')).toBe(90);
    // What follows the payment is owed from this row, not from the outcome.
    expect((await outboxRows()).map((row) => row.id)).toEqual([
      `order.paid:${order.id}`,
    ]);
  });

  it('refuses a forged event, and changes nothing', async () => {
    // Without this check anyone could post "payment succeeded" and be sent
    // the goods for free.
    const order = await pendingOrder();

    const outcome = await deliver(JSON.stringify(paymentSucceeded(order.id)), {
      signingSecret: 'whsec_attacker_guess',
    });

    expect(outcome).toEqual({
      status: 400,
      kind: 'rejected',
      reason: 'Signature mismatch',
    });
    expect(await statusOf(order.id)).toBe('pending');
    expect(await stockOf('dn50')).toBe(100);
    expect(await eventCount()).toBe(0);
    expect(await outboxRows()).toEqual([]);
  });

  it('refuses a body that was changed after Stripe signed it', async () => {
    // A real, signed event for someone else's order, pointed at this one.
    const order = await pendingOrder();
    const signedBody = JSON.stringify(paymentSucceeded('some-other-order'));
    const timestamp = Math.floor(NOW.getTime() / 1000);
    const signature = await signStripePayload(signedBody, timestamp, SECRET);

    const outcome = await handleStripeWebhook(db(), {
      rawBody: signedBody.replace('some-other-order', order.id),
      signatureHeader: `t=${timestamp},v1=${signature}`,
      secret: SECRET,
      now: NOW,
    });

    expect(outcome.status).toBe(400);
    expect(await statusOf(order.id)).toBe('pending');
  });

  it('refuses a delivery replayed after the tolerance has passed', async () => {
    const order = await pendingOrder();

    const outcome = await deliver(JSON.stringify(paymentSucceeded(order.id)), {
      signedAt: NOW,
      receivedAt: new Date(NOW.getTime() + 60 * 60 * 1000),
    });

    expect(outcome).toEqual({
      status: 400,
      kind: 'rejected',
      reason: 'Signature timestamp outside tolerance',
    });
    expect(await statusOf(order.id)).toBe('pending');
  });

  it('refuses everything while no signing secret is configured', async () => {
    const order = await pendingOrder();

    const outcome = await deliver(JSON.stringify(paymentSucceeded(order.id)), {
      configuredSecret: '',
    });

    expect(outcome.status).toBe(400);
    expect(await statusOf(order.id)).toBe('pending');
  });

  it('refuses a signed body that is not JSON', async () => {
    const outcome = await deliver('not json at all');

    expect(outcome).toEqual({
      status: 400,
      kind: 'rejected',
      reason: 'Malformed payload',
    });
  });

  it('refuses signed JSON that is not an event', async () => {
    const outcome = await deliver(JSON.stringify({ hello: 'world' }));

    expect(outcome).toEqual({
      status: 400,
      kind: 'rejected',
      reason: 'Malformed payload',
    });
  });

  it('refuses a payment event that carries no payment', async () => {
    // Waving it through as "not ours" would swallow a real payment in
    // silence if the event ever arrived in a shape this code cannot read.
    const order = await pendingOrder();

    const outcome = await deliver(
      JSON.stringify({
        id: 'evt_odd',
        type: 'payment_intent.succeeded',
        data: { object: { metadata: { order_id: order.id } } },
      }),
    );

    expect(outcome).toEqual({
      status: 400,
      kind: 'rejected',
      reason: 'Malformed payload',
    });
    expect(await statusOf(order.id)).toBe('pending');
  });

  it('answers 200 to an event type it does not act on', async () => {
    // Anything but a 2xx makes Stripe deliver the event again, for days.
    const order = await pendingOrder();

    const outcome = await deliver(
      JSON.stringify({
        id: 'evt_other',
        type: 'charge.succeeded',
        data: { object: { id: 'ch_1', metadata: { order_id: order.id } } },
      }),
    );

    expect(outcome.status).toBe(200);
    expect(outcome.kind).toBe('ignored');
    expect(await statusOf(order.id)).toBe('pending');
    expect(await eventCount()).toBe(0);
  });

  it('answers 200 to a payment that is not for one of its orders', async () => {
    // The same Stripe account may take payments for something else: an
    // invoice, a payment link. Those carry no order id and are not failures.
    const outcome = await deliver(JSON.stringify(paymentSucceeded(null)));

    expect(outcome.status).toBe(200);
    expect(outcome.kind).toBe('ignored');
    expect(await eventCount()).toBe(0);
  });

  it('acts once when the same signed delivery is replayed inside the tolerance', async () => {
    // The timestamp check cannot stop a replay made within five minutes.
    // The record of processed events does.
    const order = await pendingOrder();
    const body = JSON.stringify(paymentSucceeded(order.id));

    await deliver(body);
    const replay = await deliver(body, {
      signedAt: NOW,
      receivedAt: new Date(NOW.getTime() + 60 * 1000),
    });

    expect(replay).toEqual({
      status: 200,
      kind: 'duplicate',
      orderId: order.id,
      orderStatus: 'paid',
    });
    expect(await stockOf('dn50')).toBe(90);
  });

  it('acts once when Stripe redelivers the event with a fresh signature', async () => {
    const order = await pendingOrder();
    const body = JSON.stringify(paymentSucceeded(order.id));

    await deliver(body);
    const redelivery = await deliver(body, {
      signedAt: new Date(NOW.getTime() + 30 * 60 * 1000),
    });

    expect(redelivery.kind).toBe('duplicate');
    expect(await stockOf('dn50')).toBe(90);
    expect(await eventCount()).toBe(1);
  });

  it('answers 200 for an oversold order, so Stripe stops and a person takes over', async () => {
    const order = await pendingOrder();
    await setStock('dn50', 2);

    const outcome = await deliver(JSON.stringify(paymentSucceeded(order.id)));

    expect(outcome).toEqual({
      status: 200,
      kind: 'oversold',
      orderId: order.id,
    });
    expect(await statusOf(order.id)).toBe('oversold');
    expect(await stockOf('dn50')).toBe(2);
  });

  it('reports the product whose availability the payment changed', async () => {
    await setStock('dn50', 15);
    const order = await pendingOrder();

    const outcome = await deliver(JSON.stringify(paymentSucceeded(order.id)));

    expect(outcome).toMatchObject({
      kind: 'paid',
      availabilityChanged: [valve.translationGroup],
    });
  });

  it('answers 200 for a payment naming an order this shop does not have', async () => {
    // Another shop on the same Stripe account, a staging copy, a local
    // `stripe listen`: each sees every payment of the account. Delivering
    // this one again for three days would never make the order appear.
    const outcome = await deliver(
      JSON.stringify(paymentSucceeded('no-such-order')),
    );

    expect(outcome).toEqual({
      status: 200,
      kind: 'unmatched',
      orderId: 'no-such-order',
    });
    expect(await eventCount()).toBe(0);
    expect(await outboxRows()).toEqual([]);
  });

  it('answers 200 for a payment on a cancelled order, and puts it on record for a refund', async () => {
    // Money taken for an order that cannot take it. A retry cannot change
    // that, so it does not answer 5xx; and it must not vanish, so it is
    // written down.
    const order = await pendingOrder();
    await db()
      .prepare("UPDATE p_shop_order SET status = 'cancelled' WHERE id = ?")
      .bind(order.id)
      .run();

    const outcome = await deliver(
      JSON.stringify(
        paymentSucceeded(order.id, { paymentIntentId: 'pi_late' }),
      ),
    );

    expect(outcome).toEqual({
      status: 200,
      kind: 'refused',
      orderId: order.id,
      orderStatus: 'cancelled',
    });
    expect(await statusOf(order.id)).toBe('cancelled');
    expect(await stockOf('dn50')).toBe(100);
    expect(await outboxRows()).toEqual([
      {
        id: 'payment.refused:evt_1',
        topic: 'payment.refused',
        order_id: order.id,
        ref: 'pi_late',
        handled_at: null,
      },
    ]);
  });

  it('answers 500 only when delivering again could help, without personal data in the reason', async () => {
    // The order table gone is the stand-in for a database that cannot be
    // reached: the one kind of failure a later delivery can get past.
    const order = await pendingOrder();
    await db()
      .prepare('ALTER TABLE p_shop_order RENAME TO p_shop_order_away')
      .run();

    let outcome: Awaited<ReturnType<typeof deliver>>;
    try {
      outcome = await deliver(JSON.stringify(paymentSucceeded(order.id)));
    } finally {
      await db()
        .prepare('ALTER TABLE p_shop_order_away RENAME TO p_shop_order')
        .run();
    }

    expect(outcome.status).toBe(500);
    expect(outcome.kind).toBe('failed');
    // The reason goes to the logs.
    expect(JSON.stringify(outcome)).not.toContain(BUYER_EMAIL);
    expect(JSON.stringify(outcome)).not.toContain('Harbour Road');
    expect(await statusOf(order.id)).toBe('pending');
    expect(await stockOf('dn50')).toBe(100);

    // And the delivery Stripe then repeats goes through.
    const again = await deliver(JSON.stringify(paymentSucceeded(order.id)));
    expect(again.kind).toBe('paid');
  });

  it('refuses a payment that does not come to the order’s total, and puts it on record', async () => {
    const order = await pendingOrder();

    const outcome = await deliver(
      JSON.stringify(
        paymentSucceeded(order.id, { amount: 1000, paymentIntentId: 'pi_x' }),
      ),
    );

    expect(outcome).toEqual({
      status: 200,
      kind: 'refused',
      orderId: order.id,
      orderStatus: 'pending',
    });
    expect(await statusOf(order.id)).toBe('pending');
    expect(await stockOf('dn50')).toBe(100);
    expect((await outboxRows()).map((row) => [row.topic, row.ref])).toEqual([
      ['payment.refused', 'pi_x'],
    ]);
  });

  it('refuses a payment event that does not say what was received', async () => {
    // Without the amount the order cannot be held to it, and paying it
    // regardless would be paying on trust.
    const order = await pendingOrder();
    const event = paymentSucceeded(order.id) as {
      data: { object: Record<string, unknown> };
    };
    delete event.data.object.amount_received;

    const outcome = await deliver(JSON.stringify(event));

    expect(outcome.status).toBe(400);
    expect(await statusOf(order.id)).toBe('pending');
  });

  it('cancels the order when its payment page lapses', async () => {
    const order = await pendingOrder();
    await recordCheckoutSession(db(), {
      orderId: order.id,
      sessionId: 'cs_1',
      expiresAt: NOW,
      now: NOW,
    });

    const outcome = await deliver(
      JSON.stringify(sessionExpired(order.id, 'cs_1')),
    );

    expect(outcome).toEqual({
      status: 200,
      kind: 'expired',
      orderId: order.id,
    });
    expect(await statusOf(order.id)).toBe('cancelled');
    // Said to have lapsed: the buyer is not written to about it.
    expect((await outboxRows()).map((row) => [row.topic, row.ref])).toEqual([
      ['order.cancelled', 'expired'],
    ]);
  });

  it('cancels it too when the session was never recorded on the order', async () => {
    const order = await pendingOrder();

    const outcome = await deliver(JSON.stringify(sessionExpired(order.id)));

    expect(outcome.kind).toBe('expired');
    expect(await statusOf(order.id)).toBe('cancelled');
  });

  it('leaves an order alone that is waiting for another session', async () => {
    const order = await pendingOrder();
    await recordCheckoutSession(db(), {
      orderId: order.id,
      sessionId: 'cs_new',
      expiresAt: NOW,
      now: NOW,
    });

    const outcome = await deliver(
      JSON.stringify(sessionExpired(order.id, 'cs_old')),
    );

    expect(outcome.status).toBe(200);
    expect(outcome.kind).toBe('ignored');
    expect(await statusOf(order.id)).toBe('pending');
    expect(await outboxRows()).toEqual([]);
  });

  it('leaves an order alone that was paid or cancelled already', async () => {
    const paid = await pendingOrder();
    await deliver(JSON.stringify(paymentSucceeded(paid.id)));
    const cancelled = await pendingOrder();
    await cancelOrder(db(), { orderId: cancelled.id, now: NOW });

    const first = await deliver(
      JSON.stringify(sessionExpired(paid.id, 'cs_1', 'evt_e1')),
    );
    const second = await deliver(
      JSON.stringify(sessionExpired(cancelled.id, 'cs_2', 'evt_e2')),
    );

    expect([first.kind, second.kind]).toEqual(['ignored', 'ignored']);
    expect(await statusOf(paid.id)).toBe('paid');
    expect(await statusOf(cancelled.id)).toBe('cancelled');
    expect((await outboxRows()).map((row) => row.ref)).toEqual([
      null,
      'seller',
    ]);
  });

  it('answers 200 to a lapsed session that names no order, or one it does not have', async () => {
    const none = await deliver(JSON.stringify(sessionExpired(null)));
    const unknown = await deliver(JSON.stringify(sessionExpired('nope')));

    expect(none).toMatchObject({ status: 200, kind: 'ignored' });
    expect(unknown).toEqual({
      status: 200,
      kind: 'unmatched',
      orderId: 'nope',
    });
  });
});
