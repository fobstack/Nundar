import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CartLine } from '../../src/plugins/shop/lib/cart.js';
import {
  type PricedCart,
  priceCart,
} from '../../src/plugins/shop/lib/cart-pricing.js';
import { cancelOrder } from '../../src/plugins/shop/lib/order-fulfilment.js';
import {
  createPendingOrder,
  getOrder,
  markOrderPaid,
  OrderNotFoundError,
  type ShippingAddress,
} from '../../src/plugins/shop/lib/orders.js';
import {
  atTheSameMoment,
  clearShopTables,
  countD1Calls,
  createProduct,
  createVariant,
  db,
  ensureSite,
  fulfilledValues,
  interceptBatches,
  outboxRows,
  setPrice,
  setStock,
  stockOf,
  type TestProduct,
} from './helpers.js';

const NOW = new Date('2026-10-05T08:00:00.000Z');
const LATER = new Date('2026-10-05T08:05:00.000Z');

const EMAIL = 'jane@example.com';
const ADDRESS: ShippingAddress = {
  recipient: 'Jane Buyer',
  line1: '1 Harbour Road',
  city: 'Aberdeen',
  postalCode: 'AB11 5RY',
  country: 'GB',
};

type SuccessfulCart = Extract<PricedCart, { ok: true }>;

let valve: TestProduct;
let gasket: TestProduct;

async function pricedCart(
  lines: readonly CartLine[] = [{ variantId: 'dn50', quantity: 10 }],
): Promise<SuccessfulCart> {
  const result = await priceCart(db(), {
    lines,
    locale: 'en',
    defaultLocale: 'en',
    currency: 'USD',
  });
  if (!result.ok) {
    throw new Error(
      `The fixture cart did not price: ${JSON.stringify(result)}`,
    );
  }
  return result;
}

async function pendingOrder(
  lines?: readonly CartLine[],
  locale = 'en',
): Promise<{ id: string; orderNo: string; totalMinor: number }> {
  return createPendingOrder(db(), {
    cart: await pricedCart(lines),
    locale,
    email: EMAIL,
    shippingAddress: ADDRESS,
    now: NOW,
  });
}

function pay(
  orderId: string,
  eventId = 'evt_1',
  paymentIntentId = 'pi_1',
  database: D1Database = db(),
): ReturnType<typeof markOrderPaid> {
  return markOrderPaid(database, {
    orderId,
    eventId,
    paymentIntentId,
    now: LATER,
  });
}

async function events(): Promise<
  {
    event_id: string;
    order_id: string;
    payment_intent_id: string;
    outcome: string;
  }[]
> {
  const { results } = await db()
    .prepare(
      `SELECT event_id, order_id, payment_intent_id, outcome
       FROM p_shop_stripe_event ORDER BY event_id`,
    )
    .all<{
      event_id: string;
      order_id: string;
      payment_intent_id: string;
      outcome: string;
    }>();
  return results;
}

interface OrderRow {
  id: string;
  order_no: string;
  status: string;
  currency: string;
  subtotal_minor: number;
  shipping_minor: number;
  tax_minor: number;
  total_minor: number;
  stripe_payment_intent_id: string | null;
  email: string;
  shipping_address: string;
  locale: string;
  created_at: string;
  updated_at: string;
}

async function orderRow(id: string): Promise<OrderRow> {
  const row = await db()
    .prepare('SELECT * FROM p_shop_order WHERE id = ?')
    .bind(id)
    .first<OrderRow>();
  if (row === null) {
    throw new Error(`No order ${id}`);
  }
  return row;
}

async function count(table: string): Promise<number> {
  const row = await db()
    .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function adjustments(): Promise<
  { variant_id: string; delta: number; reason: string; ref_id: string }[]
> {
  const { results } = await db()
    .prepare(
      `SELECT variant_id, delta, reason, ref_id FROM p_shop_stock_adjustment
       ORDER BY variant_id, reason`,
    )
    .all<{
      variant_id: string;
      delta: number;
      reason: string;
      ref_id: string;
    }>();
  return results;
}

beforeAll(async () => {
  await ensureSite();
  valve = await createProduct({
    title: 'Stainless ball valve',
    slug: 'orders-ball-valve',
  });
  gasket = await createProduct({
    title: 'PTFE gasket',
    slug: 'orders-gasket',
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
  await createVariant({
    id: 'dn80',
    productGroup: valve.translationGroup,
    sku: 'BV-DN80',
    moq: 1,
    stock: 100,
  });
  await createVariant({
    id: 'gasket-custom',
    productGroup: gasket.translationGroup,
    sku: 'GK-CUSTOM',
    moq: 1,
    stock: 0,
    stockPolicy: 'made_to_order',
  });
  for (const [variantId, amountMinor] of [
    ['dn50', 9900],
    ['dn80', 14900],
    ['gasket-custom', 250],
  ] as const) {
    await setPrice({ variantId, currency: 'USD', amountMinor, source: 'base' });
  }
});

describe('createPendingOrder', () => {
  it('creates the order as pending, in the cart’s currency, with a readable number', async () => {
    const order = await pendingOrder();

    const row = await orderRow(order.id);
    expect(row.status).toBe('pending');
    expect(row.currency).toBe('USD');
    expect(row.subtotal_minor).toBe(99_000);
    expect(row.total_minor).toBe(99_000);
    expect(order.totalMinor).toBe(99_000);
    expect(row.email).toBe(EMAIL);
    expect(JSON.parse(row.shipping_address)).toEqual(ADDRESS);
    expect(row.created_at).toBe(NOW.toISOString());

    // The date the order was placed, then eight characters from an alphabet
    // without the letters that are misread aloud or on paper (I, L, O, U).
    expect(row.order_no).toBe(order.orderNo);
    expect(order.orderNo).toMatch(/^ND-261005-[0-9A-HJKMNP-TV-Z]{8}$/);
  });

  it('gives two orders placed in the same instant different numbers', async () => {
    const first = await pendingOrder();
    const second = await pendingOrder();

    expect(first.orderNo).not.toBe(second.orderNo);
    expect(first.id).not.toBe(second.id);
  });

  it('snapshots SKU, name and unit price, so later edits cannot rewrite history', async () => {
    const order = await pendingOrder();

    // The catalogue moves on after the order is placed.
    await setPrice({
      variantId: 'dn50',
      currency: 'USD',
      amountMinor: 19_900,
      source: 'base',
    });
    await db()
      .prepare("UPDATE p_shop_variant SET sku = 'RENAMED' WHERE id = 'dn50'")
      .run();

    const detail = await getOrder(db(), { id: order.id });
    expect(detail?.lines).toEqual([
      {
        variantId: 'dn50',
        sku: 'BV-DN50',
        name: 'Stainless ball valve',
        unitPriceMinor: 9900,
        quantity: 10,
      },
    ]);
    expect(detail?.totalMinor).toBe(99_000);
  });

  it('does not touch stock — that happens only once payment is confirmed', async () => {
    // Decrementing at order time would let anyone empty the catalogue with
    // scripted orders that are never paid.
    await pendingOrder();

    expect(await stockOf('dn50')).toBe(100);
    expect(await count('p_shop_stock_adjustment')).toBe(0);
  });

  it('records the language, so the buyer is written to in it', async () => {
    const order = await pendingOrder(undefined, 'de');

    expect((await orderRow(order.id)).locale).toBe('de');
  });

  it('adds shipping and tax into the total', async () => {
    const order = await createPendingOrder(db(), {
      cart: await pricedCart(),
      locale: 'en',
      email: EMAIL,
      shippingAddress: ADDRESS,
      shippingMinor: 1500,
      taxMinor: 500,
      now: NOW,
    });

    const row = await orderRow(order.id);
    expect(row.shipping_minor).toBe(1500);
    expect(row.tax_minor).toBe(500);
    expect(row.total_minor).toBe(101_000);
    expect(order.totalMinor).toBe(101_000);
  });

  it('takes the subtotal from the lines it writes, not from a figure handed in', async () => {
    // An order whose subtotal disagreed with its own lines would charge one
    // amount and list another.
    const cart = await pricedCart();

    const order = await createPendingOrder(db(), {
      cart: { ...cart, subtotalMinor: 1 },
      locale: 'en',
      email: EMAIL,
      shippingAddress: ADDRESS,
      now: NOW,
    });

    expect((await orderRow(order.id)).subtotal_minor).toBe(99_000);
    expect(order.totalMinor).toBe(99_000);
  });

  it('refuses a line whose unit price is not a whole number of minor units', async () => {
    // 99.5 × 10 is 995, a whole number. A check on the line total alone
    // would let the half-cent through into the stored unit price.
    const cart = await pricedCart();
    const [line] = cart.lines;
    if (line === undefined) {
      throw new Error('The fixture cart has no line');
    }

    for (const bad of [
      { ...line, unitPriceMinor: 99.5 },
      { ...line, unitPriceMinor: -1 },
      { ...line, quantity: 1.5 },
      { ...line, quantity: 0 },
    ]) {
      await expect(
        createPendingOrder(db(), {
          cart: { ...cart, lines: [bad] },
          locale: 'en',
          email: EMAIL,
          shippingAddress: ADDRESS,
          now: NOW,
        }),
      ).rejects.toThrow(/whole/);
    }
    expect(await count('p_shop_order')).toBe(0);
  });

  it('owes nothing yet: an order waiting for payment has no follow-up', async () => {
    await pendingOrder();

    expect(await outboxRows()).toEqual([]);
  });

  it('cannot hold a total that is not the sum of its parts', async () => {
    const order = await pendingOrder();

    await expect(
      db()
        .prepare('UPDATE p_shop_order SET total_minor = 1 WHERE id = ?')
        .bind(order.id)
        .run(),
    ).rejects.toThrow(/CHECK/i);
  });

  it('writes the order and all its lines in one round trip', async () => {
    const cart = await pricedCart([
      { variantId: 'dn50', quantity: 10 },
      { variantId: 'dn80', quantity: 2 },
      { variantId: 'gasket-custom', quantity: 40 },
    ]);

    let order: { id: string } | undefined;
    const calls = await countD1Calls(async () => {
      order = await createPendingOrder(db(), {
        cart,
        locale: 'en',
        email: EMAIL,
        shippingAddress: ADDRESS,
        now: NOW,
      });
    });

    expect(calls).toBe(1);
    expect(await count('p_shop_order_line')).toBe(3);
    expect((await orderRow(order?.id ?? '')).total_minor).toBe(138_800);
  });

  it('leaves no order behind when one of its lines cannot be written', async () => {
    // The same variant twice breaks the line table's uniqueness. The order
    // row is written first in the same batch and has to go with it.
    const cart = await pricedCart();
    const [line] = cart.lines;
    if (line === undefined) {
      throw new Error('The fixture cart has no line');
    }

    await expect(
      createPendingOrder(db(), {
        cart: { ...cart, lines: [line, line] },
        locale: 'en',
        email: EMAIL,
        shippingAddress: ADDRESS,
        now: NOW,
      }),
    ).rejects.toThrow(/UNIQUE/i);

    expect(await count('p_shop_order')).toBe(0);
    expect(await count('p_shop_order_line')).toBe(0);
  });
});

describe('markOrderPaid', () => {
  it('moves the order to paid and takes the stock', async () => {
    const order = await pendingOrder();

    const result = await pay(order.id);

    expect(result.outcome).toBe('paid');
    expect(result.status).toBe('paid');
    expect(await stockOf('dn50')).toBe(90);

    const row = await orderRow(order.id);
    expect(row.status).toBe('paid');
    expect(row.stripe_payment_intent_id).toBe('pi_1');
    expect(row.updated_at).toBe(LATER.toISOString());
  });

  it('writes a stock adjustment for the audit trail', async () => {
    const order = await pendingOrder();
    await pay(order.id);

    expect(await adjustments()).toEqual([
      {
        variant_id: 'dn50',
        delta: -10,
        reason: 'order_paid',
        ref_id: order.id,
      },
    ]);
  });

  it('records the payment, and what was done about it', async () => {
    const order = await pendingOrder();
    await pay(order.id, 'evt_1', 'pi_1');

    expect(await events()).toEqual([
      {
        event_id: 'evt_1',
        order_id: order.id,
        payment_intent_id: 'pi_1',
        outcome: 'paid',
      },
    ]);
  });

  it('writes what is owed for the payment in the payment’s own batch', async () => {
    const order = await pendingOrder();
    await pay(order.id);

    expect(await outboxRows()).toEqual([
      {
        id: `order.paid:${order.id}`,
        topic: 'order.paid',
        order_id: order.id,
        ref: null,
        handled_at: null,
      },
    ]);
  });

  it('costs two round trips however many lines the order has', async () => {
    const order = await pendingOrder([
      { variantId: 'dn50', quantity: 10 },
      { variantId: 'dn80', quantity: 2 },
      { variantId: 'gasket-custom', quantity: 40 },
    ]);

    const calls = await countD1Calls(() => pay(order.id));

    expect(calls).toBe(2);
    expect(await stockOf('dn50')).toBe(90);
    expect(await stockOf('dn80')).toBe(98);
  });

  it('does not decrement a redelivered event a second time', async () => {
    const order = await pendingOrder();

    await pay(order.id, 'evt_dup');
    const second = await pay(order.id, 'evt_dup');

    expect(second.outcome).toBe('duplicate');
    expect(second.status).toBe('paid');
    expect(await stockOf('dn50')).toBe(90);
    expect(await count('p_shop_stock_adjustment')).toBe(1);
    expect(await outboxRows()).toHaveLength(1);
  });

  it('never acts on an event that is already on record', async () => {
    // The record of payments is its own guard, apart from what the order
    // says: a payment found there is answered and nothing else happens.
    const order = await pendingOrder();
    await db()
      .prepare(
        `INSERT INTO p_shop_stripe_event
           (event_id, type, order_id, payment_intent_id, outcome, processed_at)
         VALUES ('evt_seen', 'payment_intent.succeeded', ?, 'pi_seen',
                 'paid', ?)`,
      )
      .bind(order.id, NOW.toISOString())
      .run();

    const result = await pay(order.id, 'evt_seen', 'pi_other');

    expect(result.outcome).toBe('duplicate');
    expect(await stockOf('dn50')).toBe(100);
    expect((await orderRow(order.id)).status).toBe('pending');
  });

  it('decrements once when the same event is delivered twice at the same moment', async () => {
    // Both deliveries read "not on record, order pending" before either
    // writes. Every statement of the second one's batch is conditional on the
    // order still being pending, so it finds nothing to do.
    const order = await pendingOrder();

    const results = fulfilledValues(
      await atTheSameMoment([
        (database) => pay(order.id, 'evt_race', 'pi_1', database),
        (database) => pay(order.id, 'evt_race', 'pi_1', database),
      ]),
    );

    expect(results.map((result) => result.outcome).sort()).toEqual([
      'duplicate',
      'paid',
    ]);
    expect(await stockOf('dn50')).toBe(90);
    expect(await count('p_shop_stock_adjustment')).toBe(1);
    expect(await count('p_shop_stripe_event')).toBe(1);
    expect(await outboxRows()).toHaveLength(1);
  });

  it('treats a second event for the same payment as the same payment', async () => {
    // Stripe says two separate events can describe one object, and that the
    // object's id with the event's type is how to tell. One payment takes
    // stock once.
    const order = await pendingOrder();

    await pay(order.id, 'evt_a', 'pi_same');
    const second = await pay(order.id, 'evt_b', 'pi_same');

    expect(second.outcome).toBe('duplicate');
    expect(second.status).toBe('paid');
    expect(await stockOf('dn50')).toBe(90);
    expect(await count('p_shop_stripe_event')).toBe(1);
  });

  it('decrements once when two events for the same payment arrive at the same moment', async () => {
    const order = await pendingOrder();

    const results = fulfilledValues(
      await atTheSameMoment([
        (database) => pay(order.id, 'evt_a', 'pi_same', database),
        (database) => pay(order.id, 'evt_b', 'pi_same', database),
      ]),
    );

    expect(results.map((result) => result.outcome).sort()).toEqual([
      'duplicate',
      'paid',
    ]);
    expect(await stockOf('dn50')).toBe(90);
    expect(await count('p_shop_stock_adjustment')).toBe(1);
  });

  it('pays once and records the other when two different payments arrive at the same moment', async () => {
    // A buyer charged twice. One payment settles the order; the other must
    // not vanish — it is money to give back.
    const order = await pendingOrder();

    const results = fulfilledValues(
      await atTheSameMoment([
        (database) => pay(order.id, 'evt_a', 'pi_first', database),
        (database) => pay(order.id, 'evt_b', 'pi_second', database),
      ]),
    );

    expect(results.map((result) => result.outcome).sort()).toEqual([
      'paid',
      'refused',
    ]);
    expect(await stockOf('dn50')).toBe(90);
    expect((await events()).map((event) => event.outcome).sort()).toEqual([
      'paid',
      'refused',
    ]);
    expect((await outboxRows()).map((row) => row.topic).sort()).toEqual([
      'order.paid',
      'payment.refused',
    ]);
  });

  it('records a different payment for an order that is already paid, and leaves the order alone', async () => {
    const order = await pendingOrder();
    await pay(order.id, 'evt_a', 'pi_first');

    const second = await pay(order.id, 'evt_b', 'pi_second');

    expect(second.outcome).toBe('refused');
    expect(second.status).toBe('paid');
    expect(await stockOf('dn50')).toBe(90);
    // The order still names the payment that settled it.
    expect((await orderRow(order.id)).stripe_payment_intent_id).toBe(
      'pi_first',
    );
    // The second payment is on record, with what has to be refunded.
    expect(await outboxRows()).toContainEqual({
      id: 'payment.refused:evt_b',
      topic: 'payment.refused',
      order_id: order.id,
      ref: 'pi_second',
      handled_at: null,
    });
  });

  it('marks the order oversold when the stock went between order and payment', async () => {
    const order = await pendingOrder();
    await setStock('dn50', 2);

    const result = await pay(order.id, 'evt_oversold', 'pi_2');

    expect(result.outcome).toBe('oversold');
    // Never below zero, and never a partial decrement.
    expect(await stockOf('dn50')).toBe(2);
    expect(await count('p_shop_stock_adjustment')).toBe(0);

    const row = await orderRow(order.id);
    expect(row.status).toBe('oversold');
    // The payment is on the order: it is what has to be refunded.
    expect(row.stripe_payment_intent_id).toBe('pi_2');
    expect((await events())[0]?.outcome).toBe('oversold');
    expect((await outboxRows()).map((entry) => entry.topic)).toEqual([
      'order.oversold',
    ]);
  });

  it('answers a redelivery of an oversold payment without acting again', async () => {
    const order = await pendingOrder();
    await setStock('dn50', 2);
    await pay(order.id, 'evt_oversold', 'pi_2');

    const second = await pay(order.id, 'evt_oversold', 'pi_2');

    expect(second.outcome).toBe('duplicate');
    expect(second.status).toBe('oversold');
    expect(await stockOf('dn50')).toBe(2);
  });

  it('takes nothing from an earlier line when a later one cannot be satisfied', async () => {
    // The previous implementation decremented line by line and put stock back
    // by hand on failure. Here the batch is the transaction: there is nothing
    // to put back.
    const order = await pendingOrder([
      { variantId: 'dn50', quantity: 10 },
      { variantId: 'dn80', quantity: 5 },
    ]);
    await setStock('dn80', 1);

    const result = await pay(order.id);

    expect(result.outcome).toBe('oversold');
    expect(await stockOf('dn50')).toBe(100);
    expect(await stockOf('dn80')).toBe(1);
    expect(await count('p_shop_stock_adjustment')).toBe(0);
  });

  it('marks oversold when the stock goes after the reading and before the write', async () => {
    // The reading says the stock is there; by the time the batch runs it is
    // not. The decrement trips the constraint, the batch rolls back, and the
    // next reading decides.
    const order = await pendingOrder();
    const database = interceptBatches({
      before: async (index) => {
        if (index === 1) {
          await setStock('dn50', 2);
        }
      },
    });

    const result = await pay(order.id, 'evt_1', 'pi_1', database);

    expect(result.outcome).toBe('oversold');
    expect(await stockOf('dn50')).toBe(2);
    expect(await count('p_shop_stock_adjustment')).toBe(0);
  });

  it('pays after all when the stock comes back before oversold is written', async () => {
    // Another order's refund returns the stock between the reading that saw
    // it short and the write. An order that can be fulfilled must not be sent
    // to a person for a refund it does not need.
    const order = await pendingOrder();
    await setStock('dn50', 2);
    const database = interceptBatches({
      before: async (index) => {
        if (index === 1) {
          await setStock('dn50', 100);
        }
      },
    });

    const result = await pay(order.id, 'evt_1', 'pi_1', database);

    expect(result.outcome).toBe('paid');
    expect(await stockOf('dn50')).toBe(90);
    expect((await orderRow(order.id)).status).toBe('paid');
    expect((await outboxRows()).map((entry) => entry.topic)).toEqual([
      'order.paid',
    ]);
  });

  it('gives the last stock to one of two orders paid at the same moment', async () => {
    await setStock('dn50', 10);
    const first = await pendingOrder();
    const second = await pendingOrder();

    const results = fulfilledValues(
      await atTheSameMoment([
        (database) => pay(first.id, 'evt_first', 'pi_first', database),
        (database) => pay(second.id, 'evt_second', 'pi_second', database),
      ]),
    );

    expect(results.map((result) => result.outcome).sort()).toEqual([
      'oversold',
      'paid',
    ]);
    expect(await stockOf('dn50')).toBe(0);
    expect(await count('p_shop_stock_adjustment')).toBe(1);
  });

  it('does not take stock for a made-to-order line, and does not call it oversold', async () => {
    // A made-to-order variant has no stock to take: its stock is zero and
    // stays zero. Decrementing it would trip the constraint and turn every
    // such order into "oversold".
    const order = await pendingOrder([
      { variantId: 'dn50', quantity: 10 },
      { variantId: 'gasket-custom', quantity: 40 },
    ]);

    const result = await pay(order.id);

    expect(result.outcome).toBe('paid');
    expect(await stockOf('gasket-custom')).toBe(0);
    expect(await stockOf('dn50')).toBe(90);
    expect(await adjustments()).toEqual([
      {
        variant_id: 'dn50',
        delta: -10,
        reason: 'order_paid',
        ref_id: order.id,
      },
    ]);
  });

  it('records a payment for a cancelled order, and changes neither order nor stock', async () => {
    // The buyer paid on Stripe's page after the order was cancelled. The
    // order cannot take the payment, but the money has been taken: it goes on
    // record, with a row for a person to refund it.
    const order = await pendingOrder();
    await cancelOrder(db(), { orderId: order.id, now: NOW });

    const result = await pay(order.id, 'evt_late', 'pi_3');

    expect(result.outcome).toBe('refused');
    expect(result.status).toBe('cancelled');
    expect(await stockOf('dn50')).toBe(100);
    expect(await count('p_shop_stock_adjustment')).toBe(0);
    const row = await orderRow(order.id);
    expect(row.status).toBe('cancelled');
    expect(row.stripe_payment_intent_id).toBeNull();
    expect(await events()).toEqual([
      {
        event_id: 'evt_late',
        order_id: order.id,
        payment_intent_id: 'pi_3',
        outcome: 'refused',
      },
    ]);
    expect(await outboxRows()).toContainEqual({
      id: 'payment.refused:evt_late',
      topic: 'payment.refused',
      order_id: order.id,
      ref: 'pi_3',
      handled_at: null,
    });
  });

  it('records a refused payment once, however often it is delivered', async () => {
    const order = await pendingOrder();
    await cancelOrder(db(), { orderId: order.id, now: NOW });

    const results = fulfilledValues(
      await atTheSameMoment([
        (database) => pay(order.id, 'evt_late', 'pi_3', database),
        (database) => pay(order.id, 'evt_late', 'pi_3', database),
        (database) => pay(order.id, 'evt_other', 'pi_3', database),
      ]),
    );
    const again = await pay(order.id, 'evt_late', 'pi_3');

    expect(
      results.filter((result) => result.outcome === 'refused'),
    ).toHaveLength(1);
    expect(again.outcome).toBe('duplicate');
    expect(await count('p_shop_stripe_event')).toBe(1);
    expect(
      (await outboxRows()).filter((row) => row.topic === 'payment.refused'),
    ).toHaveLength(1);
  });

  it('pays or cancels, never both, when the two happen at the same moment', async () => {
    const order = await pendingOrder();

    const [payment, cancellation] = await atTheSameMoment<unknown>([
      (database) => pay(order.id, 'evt_1', 'pi_1', database),
      (database) => cancelOrder(database, { orderId: order.id, now: LATER }),
    ]);

    const status = (await orderRow(order.id)).status;
    if (status === 'paid') {
      // The payment won: the cancellation found the order moved and refused.
      expect(payment).toMatchObject({ value: { outcome: 'paid' } });
      expect(cancellation?.status).toBe('rejected');
      expect(await stockOf('dn50')).toBe(90);
    } else {
      // The cancellation won: the payment is recorded for a refund.
      expect(status).toBe('cancelled');
      expect(payment).toMatchObject({ value: { outcome: 'refused' } });
      expect(cancellation?.status).toBe('fulfilled');
      expect(await stockOf('dn50')).toBe(100);
    }
  });

  it('throws for an order that does not exist, and writes nothing', async () => {
    await expect(pay('no-such-order', 'evt_x', 'pi_x')).rejects.toThrow(
      OrderNotFoundError,
    );
    expect(await count('p_shop_stripe_event')).toBe(0);
    expect(await outboxRows()).toEqual([]);
  });

  it('rethrows a failure that is neither a race nor a shortage', async () => {
    // The database going away is not something to explain as "oversold" or
    // "already handled". It has to reach the caller, who answers so that the
    // event is delivered again.
    const order = await pendingOrder();
    let writes = 0;
    const database = interceptBatches({
      before: (index) => {
        // Even batches are readings, odd ones are writes.
        if (index % 2 === 1) {
          writes += 1;
          throw new Error('D1 is unavailable');
        }
      },
    });

    await expect(pay(order.id, 'evt_1', 'pi_1', database)).rejects.toThrow(
      'D1 is unavailable',
    );

    // Tried, tried once more, and gave up rather than hammer the database.
    expect(writes).toBe(2);
    expect((await orderRow(order.id)).status).toBe('pending');
    expect(await stockOf('dn50')).toBe(100);
    expect(await count('p_shop_stripe_event')).toBe(0);
  });

  it('pays when the stock is gone at the write and back by the next reading', async () => {
    // Another order takes the stock just before this one's batch, and its
    // refund returns it just after. The batch fails on the constraint; the
    // next reading finds the stock there and calls for paying again. The
    // first failure says nothing about that second attempt.
    const order = await pendingOrder();
    const database = interceptBatches({
      before: async (index) => {
        if (index === 1) {
          await setStock('dn50', 2);
        }
        if (index === 2) {
          await setStock('dn50', 100);
        }
      },
    });

    const result = await pay(order.id, 'evt_1', 'pi_1', database);

    expect(result.outcome).toBe('paid');
    expect(await stockOf('dn50')).toBe(90);
    expect(await count('p_shop_stock_adjustment')).toBe(1);
  });

  it('gives up after four passes that all lose, having written nothing', async () => {
    // Stock that is gone at every write and back at every reading. Four
    // passes is where it stops; whoever delivered the event delivers it
    // again, and by then the dust has settled.
    const order = await pendingOrder();
    let batches = 0;
    const database = interceptBatches({
      before: async (index) => {
        batches += 1;
        // Before each write the stock is the opposite of what was just read.
        if (index === 1 || index === 5) {
          await setStock('dn50', 2);
        }
        if (index === 3 || index === 7) {
          await setStock('dn50', 100);
        }
      },
    });

    await expect(pay(order.id, 'evt_1', 'pi_1', database)).rejects.toThrow(
      /could not be settled/,
    );

    expect(batches).toBe(8);
    expect((await orderRow(order.id)).status).toBe('pending');
    expect(await stockOf('dn50')).toBe(100);
    expect(await count('p_shop_stripe_event')).toBe(0);
    expect(await outboxRows()).toEqual([]);

    // The next delivery finds a quiet database and pays the order.
    expect((await pay(order.id)).outcome).toBe('paid');
  });

  it('still owes the follow-up when the payment commits and its answer is lost', async () => {
    // The batch reaches the database and commits; the answer never comes
    // back. To this call it looks like a failure, and the next reading finds
    // the payment already on record. Whoever called gets "duplicate" and
    // sends nothing. The outbox row, written in the payment's own batch, is
    // what keeps the buyer's email from being lost with the answer.
    const order = await pendingOrder();
    const database = interceptBatches({
      after: (index) => {
        if (index === 1) {
          throw new Error('The connection was lost');
        }
      },
    });

    const result = await pay(order.id, 'evt_1', 'pi_1', database);

    expect(result.outcome).toBe('duplicate');
    expect(result.status).toBe('paid');
    expect(await stockOf('dn50')).toBe(90);
    expect(await outboxRows()).toEqual([
      {
        id: `order.paid:${order.id}`,
        topic: 'order.paid',
        order_id: order.id,
        ref: null,
        handled_at: null,
      },
    ]);
  });

  it('still owes the follow-up when an oversold order is recorded and its answer is lost', async () => {
    const order = await pendingOrder();
    await setStock('dn50', 2);
    const database = interceptBatches({
      after: (index) => {
        if (index === 1) {
          throw new Error('The connection was lost');
        }
      },
    });

    const result = await pay(order.id, 'evt_1', 'pi_1', database);

    expect(result.outcome).toBe('duplicate');
    expect(result.status).toBe('oversold');
    expect((await orderRow(order.id)).stripe_payment_intent_id).toBe('pi_1');
    expect((await outboxRows()).map((row) => row.topic)).toEqual([
      'order.oversold',
    ]);
  });

  it('still owes the refund when a refused payment is recorded and its answer is lost', async () => {
    const order = await pendingOrder();
    await cancelOrder(db(), { orderId: order.id, now: NOW });
    const database = interceptBatches({
      after: (index) => {
        if (index === 1) {
          throw new Error('The connection was lost');
        }
      },
    });

    const result = await pay(order.id, 'evt_late', 'pi_3', database);

    expect(result.outcome).toBe('duplicate');
    expect(result.status).toBe('cancelled');
    expect((await events()).map((event) => event.outcome)).toEqual(['refused']);
    expect(await outboxRows()).toContainEqual({
      id: 'payment.refused:evt_late',
      topic: 'payment.refused',
      order_id: order.id,
      ref: 'pi_3',
      handled_at: null,
    });
  });

  it('reports the product whose availability the payment changed', async () => {
    // 15 in stock with a minimum order of 10 is orderable; 5 is not. That is
    // the moment the product's pages have to be purged.
    await setStock('dn50', 15);
    const order = await pendingOrder();

    const result = await pay(order.id);

    expect(result.availabilityChanged).toEqual([valve.translationGroup]);
  });

  it('reports nothing when the product is as available as it was', async () => {
    const order = await pendingOrder([
      { variantId: 'dn50', quantity: 10 },
      { variantId: 'gasket-custom', quantity: 40 },
    ]);

    const result = await pay(order.id);

    // 90 left of a variant whose minimum order is 10: still in stock.
    expect(result.availabilityChanged).toEqual([]);
  });
});

describe('getOrder', () => {
  it('finds an order by its number, with its lines and address', async () => {
    const created = await pendingOrder([
      { variantId: 'dn50', quantity: 10 },
      { variantId: 'dn80', quantity: 2 },
    ]);

    const order = await getOrder(db(), { orderNo: created.orderNo });

    expect(order).toMatchObject({
      id: created.id,
      orderNo: created.orderNo,
      status: 'pending',
      currency: 'USD',
      subtotalMinor: 128_800,
      shippingMinor: 0,
      taxMinor: 0,
      totalMinor: 128_800,
      email: EMAIL,
      locale: 'en',
      trackingNo: null,
      stripePaymentIntentId: null,
      shippingAddress: ADDRESS,
    });
    expect(order?.lines.map((line) => line.sku)).toEqual([
      'BV-DN50',
      'BV-DN80',
    ]);
  });

  it('costs one round trip', async () => {
    const created = await pendingOrder();

    const calls = await countD1Calls(() =>
      getOrder(db(), { orderNo: created.orderNo }),
    );

    expect(calls).toBe(1);
  });

  it('returns null for an order that does not exist', async () => {
    expect(await getOrder(db(), { orderNo: 'ND-NOPE' })).toBeNull();
    expect(await getOrder(db(), { id: 'no-such-id' })).toBeNull();
  });

  it('survives a corrupt stored address', async () => {
    // A malformed address must not make the order impossible to open.
    const created = await pendingOrder();
    await db()
      .prepare(
        "UPDATE p_shop_order SET shipping_address = 'not json' WHERE id = ?",
      )
      .bind(created.id)
      .run();

    const order = await getOrder(db(), { id: created.id });
    expect(order?.shippingAddress).toEqual({});
  });

  it('states a lead time only when every line has one', async () => {
    await db()
      .prepare("UPDATE p_shop_variant SET lead_time_max = 20 WHERE id = 'dn50'")
      .run();
    await db()
      .prepare(
        "UPDATE p_shop_variant SET lead_time_max = 35 WHERE id = 'gasket-custom'",
      )
      .run();

    const both = await pendingOrder([
      { variantId: 'dn50', quantity: 10 },
      { variantId: 'gasket-custom', quantity: 40 },
    ]);
    // The slowest line decides when the order can leave.
    expect((await getOrder(db(), { id: both.id }))?.leadTimeDaysMax).toBe(35);

    // dn80 states no lead time, so no promise can be made for the order.
    const mixed = await pendingOrder([
      { variantId: 'dn50', quantity: 10 },
      { variantId: 'dn80', quantity: 1 },
    ]);
    expect(
      (await getOrder(db(), { id: mixed.id }))?.leadTimeDaysMax,
    ).toBeNull();
  });
});
