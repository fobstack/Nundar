import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CartLine } from '../../src/plugins/shop/lib/cart.js';
import { priceCart } from '../../src/plugins/shop/lib/cart-pricing.js';
import {
  cancelOrder,
  expireOrder,
  fulfilOversold,
  markDelivered,
  refundOrder,
  shipOrder,
} from '../../src/plugins/shop/lib/order-fulfilment.js';
import {
  createPendingOrder,
  getOrder,
  markOrderPaid,
  OrderNotFoundError,
  recordCheckoutSession,
} from '../../src/plugins/shop/lib/orders.js';
import {
  atTheSameMoment,
  clearShopTables,
  countD1Calls,
  createProduct,
  createVariant,
  db,
  ensureSite,
  interceptBatches,
  outboxRows,
  setPrice,
  setStock,
  stockOf,
  type TestProduct,
} from './helpers.js';

const NOW = new Date('2026-10-05T08:00:00.000Z');
const LATER = new Date('2026-10-06T09:30:00.000Z');

let valve: TestProduct;

async function makeOrder(
  lines: readonly CartLine[] = [{ variantId: 'dn50', quantity: 10 }],
): Promise<{ id: string; orderNo: string }> {
  const cart = await priceCart(db(), {
    lines,
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
    email: 'jane@example.com',
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

async function paidOrder(
  lines?: readonly CartLine[],
): Promise<{ id: string; orderNo: string }> {
  const order = await makeOrder(lines);
  await markOrderPaid(db(), {
    orderId: order.id,
    eventId: `evt_${order.id}`,
    paymentIntentId: `pi_${order.id}`,
    now: NOW,
  });
  return order;
}

async function statusOf(orderId: string): Promise<string | undefined> {
  return (await getOrder(db(), { id: orderId }))?.status;
}

/** An order paid for after its stock had gone: stock 0, then the payment. */
async function oversoldOrder(): Promise<{ id: string; orderNo: string }> {
  const order = await makeOrder();
  await setStock('dn50', 0);
  await markOrderPaid(db(), {
    orderId: order.id,
    eventId: `evt_${order.id}`,
    paymentIntentId: `pi_${order.id}`,
    now: NOW,
  });
  if ((await statusOf(order.id)) !== 'oversold') {
    throw new Error('The fixture order was not oversold');
  }
  return order;
}

async function reasons(orderId: string): Promise<string[]> {
  const { results } = await db()
    .prepare(
      'SELECT reason FROM p_shop_stock_adjustment WHERE ref_id = ? ORDER BY reason',
    )
    .bind(orderId)
    .all<{ reason: string }>();
  return results.map((row) => row.reason);
}

/** The topics owed for one order, in the order they were written. */
async function owed(orderId: string): Promise<string[]> {
  return (await outboxRows())
    .filter((row) => row.order_id === orderId)
    .map((row) => row.topic);
}

/** How many of several attempts went through, and why the rest did not. */
async function settle(
  attempts: readonly ((database: D1Database) => Promise<unknown>)[],
): Promise<{ fulfilled: number; reasons: string[] }> {
  // Made at the same moment, and seen to have overlapped.
  const settled = await atTheSameMoment(attempts);
  return {
    fulfilled: settled.filter((result) => result.status === 'fulfilled').length,
    reasons: settled.flatMap((result) =>
      result.status === 'rejected' ? [String(result.reason)] : [],
    ),
  };
}

beforeAll(async () => {
  await ensureSite();
  valve = await createProduct({
    title: 'Stainless ball valve',
    slug: 'fulfilment-ball-valve',
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

describe('shipOrder', () => {
  it('records the tracking number and moves the order to shipped', async () => {
    const order = await paidOrder();

    await shipOrder(db(), {
      orderId: order.id,
      trackingNo: '  TRACK-123 ',
      now: LATER,
    });

    const detail = await getOrder(db(), { id: order.id });
    expect(detail?.status).toBe('shipped');
    expect(detail?.trackingNo).toBe('TRACK-123');
    expect(detail?.updatedAt).toBe(LATER.toISOString());
  });

  it('records the carrier when one is named, and none when it is blank', async () => {
    const named = await paidOrder();
    await shipOrder(db(), {
      orderId: named.id,
      trackingNo: 'T-1',
      carrier: ' DHL Express ',
      now: LATER,
    });
    const blank = await paidOrder();
    await shipOrder(db(), {
      orderId: blank.id,
      trackingNo: 'T-2',
      carrier: '   ',
      now: LATER,
    });

    expect((await getOrder(db(), { id: named.id }))?.carrier).toBe(
      'DHL Express',
    );
    expect((await getOrder(db(), { id: blank.id }))?.carrier).toBeNull();
  });

  it('owes the buyer a shipping notice from the moment the order ships', async () => {
    // Written in the same batch as the change: a notice sent afterwards
    // would be lost whenever the request died in between.
    const order = await paidOrder();

    await shipOrder(db(), { orderId: order.id, trackingNo: 'T-1', now: LATER });

    expect(await owed(order.id)).toEqual(['order.paid', 'order.shipped']);
  });

  it('costs two round trips: one to read the status, one to change it', async () => {
    const order = await paidOrder();

    const calls = await countD1Calls(() =>
      shipOrder(db(), { orderId: order.id, trackingNo: 'T-1', now: LATER }),
    );

    expect(calls).toBe(2);
  });

  it('has shipped the order, and owes the notice, even when the answer is lost', async () => {
    // To the caller this looks like a failure. The order has shipped all the
    // same, the notice is owed, and pressing the button again is refused
    // rather than repeated.
    const order = await paidOrder();
    const database = interceptBatches({
      after: () => {
        throw new Error('The connection was lost');
      },
    });

    await expect(
      shipOrder(database, { orderId: order.id, trackingNo: 'T-1', now: LATER }),
    ).rejects.toThrow('The connection was lost');

    expect(await statusOf(order.id)).toBe('shipped');
    expect(await owed(order.id)).toEqual(['order.paid', 'order.shipped']);
    await expect(
      shipOrder(db(), { orderId: order.id, trackingNo: 'T-1', now: LATER }),
    ).rejects.toThrow(/transition/i);
    expect(await owed(order.id)).toEqual(['order.paid', 'order.shipped']);
  });

  it('refuses to ship without a tracking number', async () => {
    // "Shipped" with nothing to track helps neither support nor the buyer.
    const order = await paidOrder();

    await expect(
      shipOrder(db(), { orderId: order.id, trackingNo: '   ', now: LATER }),
    ).rejects.toThrow(/tracking number/i);
    expect(await statusOf(order.id)).toBe('paid');
    expect(await owed(order.id)).toEqual(['order.paid']);
  });

  it('refuses to ship an order that has not been paid', async () => {
    const order = await makeOrder();

    await expect(
      shipOrder(db(), { orderId: order.id, trackingNo: 'T-1', now: LATER }),
    ).rejects.toThrow(/transition/i);
    expect(await statusOf(order.id)).toBe('pending');
    expect(await owed(order.id)).toEqual([]);
  });

  it('refuses to ship an oversold order', async () => {
    const order = await makeOrder();
    await setStock('dn50', 0);
    await markOrderPaid(db(), {
      orderId: order.id,
      eventId: 'evt_over',
      paymentIntentId: 'pi_over',
      now: NOW,
    });

    await expect(
      shipOrder(db(), { orderId: order.id, trackingNo: 'T-1', now: LATER }),
    ).rejects.toThrow(/transition/i);
  });

  it('throws for an order that does not exist', async () => {
    await expect(
      shipOrder(db(), { orderId: 'nope', trackingNo: 'T-1', now: LATER }),
    ).rejects.toThrow(OrderNotFoundError);
    expect(await outboxRows()).toEqual([]);
  });
});

describe('markDelivered', () => {
  it('moves a shipped order to delivered', async () => {
    const order = await paidOrder();
    await shipOrder(db(), { orderId: order.id, trackingNo: 'T-1', now: NOW });

    await markDelivered(db(), { orderId: order.id, now: LATER });

    expect(await statusOf(order.id)).toBe('delivered');
  });

  it('refuses an order that has not shipped', async () => {
    const order = await paidOrder();

    await expect(
      markDelivered(db(), { orderId: order.id, now: LATER }),
    ).rejects.toThrow(/transition/i);
  });
});

describe('cancelOrder', () => {
  it('cancels an order that is still waiting for payment', async () => {
    const order = await makeOrder();

    await cancelOrder(db(), { orderId: order.id, now: LATER });

    expect(await statusOf(order.id)).toBe('cancelled');
  });

  it('says on what it owes why the order was cancelled', async () => {
    // What follows reads it: a buyer is told when the seller cancelled, and
    // not when they let the payment page lapse.
    const bySeller = await makeOrder();
    const lapsed = await makeOrder();

    await cancelOrder(db(), { orderId: bySeller.id, now: LATER });
    await cancelOrder(db(), {
      orderId: lapsed.id,
      reason: 'expired',
      now: LATER,
    });

    const refs = (await outboxRows()).map((row) => [row.order_id, row.ref]);
    expect(refs).toEqual([
      [bySeller.id, 'seller'],
      [lapsed.id, 'expired'],
    ]);
  });

  it('refuses to cancel an oversold order — its payment has to go back', async () => {
    const order = await oversoldOrder();

    await expect(
      cancelOrder(db(), { orderId: order.id, now: LATER }),
    ).rejects.toThrow(/transition/i);
    expect(await statusOf(order.id)).toBe('oversold');
  });

  it('refuses to cancel a paid order — that is a refund', async () => {
    const order = await paidOrder();

    await expect(
      cancelOrder(db(), { orderId: order.id, now: LATER }),
    ).rejects.toThrow(/transition/i);
    expect(await statusOf(order.id)).toBe('paid');
  });

  it('lets only one of two simultaneous cancellations through', async () => {
    const order = await makeOrder();

    const outcome = await settle([
      (database) => cancelOrder(database, { orderId: order.id, now: LATER }),
      (database) => cancelOrder(database, { orderId: order.id, now: LATER }),
    ]);

    expect(outcome.fulfilled).toBe(1);
    expect(await statusOf(order.id)).toBe('cancelled');
    expect(await owed(order.id)).toEqual(['order.cancelled']);
  });
});

describe('expireOrder', () => {
  async function withSession(sessionId: string): Promise<{ id: string }> {
    const order = await makeOrder();
    await recordCheckoutSession(db(), {
      orderId: order.id,
      sessionId,
      expiresAt: LATER,
      now: NOW,
    });
    return order;
  }

  it('cancels an order still waiting for the session that lapsed', async () => {
    const order = await withSession('cs_1');

    expect(
      await expireOrder(db(), {
        orderId: order.id,
        sessionId: 'cs_1',
        now: LATER,
      }),
    ).toBe('cancelled');
    expect(await statusOf(order.id)).toBe('cancelled');
  });

  it('leaves the order alone when it is given another session meanwhile', async () => {
    // Between the reading and the write: the write has to ask again.
    const order = await withSession('cs_1');
    const database = interceptBatches({
      before: async () => {
        await db()
          .prepare(
            "UPDATE p_shop_order SET stripe_session_id = 'cs_2' WHERE id = ?",
          )
          .bind(order.id)
          .run();
      },
    });

    expect(
      await expireOrder(database, {
        orderId: order.id,
        sessionId: 'cs_1',
        now: LATER,
      }),
    ).toBe('other_session');
    expect(await statusOf(order.id)).toBe('pending');
    expect(await owed(order.id)).toEqual([]);
  });

  it('leaves the order alone when it is paid meanwhile', async () => {
    const order = await withSession('cs_1');
    const database = interceptBatches({
      before: async () => {
        await markOrderPaid(db(), {
          orderId: order.id,
          eventId: 'evt_meanwhile',
          paymentIntentId: 'pi_meanwhile',
          now: NOW,
        });
      },
    });

    expect(
      await expireOrder(database, {
        orderId: order.id,
        sessionId: 'cs_1',
        now: LATER,
      }),
    ).toBe('not_pending');
    expect(await statusOf(order.id)).toBe('paid');
    expect(await owed(order.id)).toEqual(['order.paid']);
  });

  it('passes on a failure that is not the order having changed', async () => {
    const order = await withSession('cs_1');
    const database = interceptBatches({
      before: () => {
        throw new Error('D1 is unreachable');
      },
    });

    await expect(
      expireOrder(database, {
        orderId: order.id,
        sessionId: 'cs_1',
        now: LATER,
      }),
    ).rejects.toThrow('D1 is unreachable');
    expect(await statusOf(order.id)).toBe('pending');
  });
});

describe('refundOrder', () => {
  it('returns the stock that was taken when the order was paid', async () => {
    const order = await paidOrder();
    expect(await stockOf('dn50')).toBe(90);

    await refundOrder(db(), { orderId: order.id, now: LATER });

    expect(await stockOf('dn50')).toBe(100);
    expect(await statusOf(order.id)).toBe('refunded');
  });

  it('writes a refund adjustment for the audit trail', async () => {
    const order = await paidOrder();

    await refundOrder(db(), { orderId: order.id, now: LATER });

    expect(await reasons(order.id)).toEqual(['order_paid', 'refund']);
    const sum = await db()
      .prepare(
        'SELECT SUM(delta) AS net FROM p_shop_stock_adjustment WHERE ref_id = ?',
      )
      .bind(order.id)
      .first<{ net: number }>();
    expect(sum?.net).toBe(0);
  });

  it('does not invent stock when refunding an oversold order', async () => {
    // An oversold order never took the stock, so there is none to give back.
    // The refund follows what the ledger recorded, not what the order asked for.
    const order = await makeOrder();
    await setStock('dn50', 1);
    await markOrderPaid(db(), {
      orderId: order.id,
      eventId: 'evt_over',
      paymentIntentId: 'pi_over',
      now: NOW,
    });

    await refundOrder(db(), { orderId: order.id, now: LATER });

    expect(await stockOf('dn50')).toBe(1);
    expect(await statusOf(order.id)).toBe('refunded');
    expect(await reasons(order.id)).toEqual([]);
  });

  it('leaves the stock alone when the goods are not coming back', async () => {
    const order = await paidOrder();
    await shipOrder(db(), { orderId: order.id, trackingNo: 'T-1', now: NOW });

    await refundOrder(db(), { orderId: order.id, restock: false, now: LATER });

    expect(await statusOf(order.id)).toBe('refunded');
    expect(await stockOf('dn50')).toBe(90);
    // The ledger has nothing to undo: the stock went with the goods.
    expect(await reasons(order.id)).toEqual(['order_paid']);
    expect(await owed(order.id)).toEqual([
      'order.paid',
      'order.shipped',
      'order.refunded',
    ]);
  });

  it('refuses to refund an order that was never paid', async () => {
    const order = await makeOrder();

    await expect(
      refundOrder(db(), { orderId: order.id, now: LATER }),
    ).rejects.toThrow(/transition/i);
    expect(await stockOf('dn50')).toBe(100);
  });

  it('cannot be refunded twice', async () => {
    const order = await paidOrder();
    await refundOrder(db(), { orderId: order.id, now: LATER });

    await expect(
      refundOrder(db(), { orderId: order.id, now: LATER }),
    ).rejects.toThrow(/transition/i);

    expect(await stockOf('dn50')).toBe(100);
    expect(await reasons(order.id)).toEqual(['order_paid', 'refund']);
  });

  it('returns the stock once when two refunds are made at the same moment', async () => {
    const order = await paidOrder();

    const outcome = await settle([
      (database) => refundOrder(database, { orderId: order.id, now: LATER }),
      (database) => refundOrder(database, { orderId: order.id, now: LATER }),
    ]);

    expect(outcome.fulfilled).toBe(1);
    expect(await stockOf('dn50')).toBe(100);
    expect(await reasons(order.id)).toEqual(['order_paid', 'refund']);
    expect(await owed(order.id)).toEqual(['order.paid', 'order.refunded']);
  });

  it('ships or refunds, never both, when the two happen at the same moment', async () => {
    const order = await paidOrder();

    const outcome = await settle([
      (database) =>
        shipOrder(database, {
          orderId: order.id,
          trackingNo: 'T-1',
          now: LATER,
        }),
      (database) => refundOrder(database, { orderId: order.id, now: LATER }),
    ]);

    expect(outcome.fulfilled).toBe(1);
    const status = await statusOf(order.id);
    if (status === 'refunded') {
      expect(await stockOf('dn50')).toBe(100);
      expect(await owed(order.id)).toEqual(['order.paid', 'order.refunded']);
    } else {
      // Shipped: nothing went back to stock, and no refund is on the ledger.
      expect(status).toBe('shipped');
      expect(await stockOf('dn50')).toBe(90);
      expect(await reasons(order.id)).toEqual(['order_paid']);
      expect(await owed(order.id)).toEqual(['order.paid', 'order.shipped']);
    }
  });

  it('has refunded the order once, and owes the follow-up, even when the answer is lost', async () => {
    const order = await paidOrder();
    const database = interceptBatches({
      after: () => {
        throw new Error('The connection was lost');
      },
    });

    await expect(
      refundOrder(database, { orderId: order.id, now: LATER }),
    ).rejects.toThrow('The connection was lost');

    expect(await statusOf(order.id)).toBe('refunded');
    expect(await stockOf('dn50')).toBe(100);
    expect(await owed(order.id)).toEqual(['order.paid', 'order.refunded']);
    // Trying again cannot return the stock a second time.
    await expect(
      refundOrder(db(), { orderId: order.id, now: LATER }),
    ).rejects.toThrow(/transition/i);
    expect(await stockOf('dn50')).toBe(100);
    expect(await reasons(order.id)).toEqual(['order_paid', 'refund']);
  });

  it('refunds a shipped order too', async () => {
    const order = await paidOrder();
    await shipOrder(db(), { orderId: order.id, trackingNo: 'T-1', now: NOW });

    await refundOrder(db(), { orderId: order.id, now: LATER });

    expect(await statusOf(order.id)).toBe('refunded');
    expect(await stockOf('dn50')).toBe(100);
  });

  it('reports the product that became available again', async () => {
    // Ten in stock with a minimum order of ten: the order takes all of it,
    // and the refund puts the product back on sale.
    await setStock('dn50', 10);
    const order = await paidOrder();
    expect(await stockOf('dn50')).toBe(0);

    const result = await refundOrder(db(), { orderId: order.id, now: LATER });

    expect(result.availabilityChanged).toEqual([valve.translationGroup]);
  });

  it('reports nothing when availability did not change', async () => {
    const order = await paidOrder();

    const result = await refundOrder(db(), { orderId: order.id, now: LATER });

    expect(result.availabilityChanged).toEqual([]);
  });
});

describe('fulfilOversold', () => {
  it('takes the stock once it is back and makes the order paid', async () => {
    const order = await oversoldOrder();
    await setStock('dn50', 25);

    await fulfilOversold(db(), { orderId: order.id, now: LATER });

    expect(await statusOf(order.id)).toBe('paid');
    expect(await stockOf('dn50')).toBe(15);
    expect(await reasons(order.id)).toEqual(['order_paid']);
    expect(await owed(order.id)).toEqual(['order.oversold', 'order.paid']);
  });

  it('then ships, and a refund gives back what it took', async () => {
    const order = await oversoldOrder();
    await setStock('dn50', 25);
    await fulfilOversold(db(), { orderId: order.id, now: LATER });

    await shipOrder(db(), { orderId: order.id, trackingNo: 'T-1', now: LATER });
    await refundOrder(db(), { orderId: order.id, now: LATER });

    expect(await stockOf('dn50')).toBe(25);
    expect(await reasons(order.id)).toEqual(['order_paid', 'refund']);
  });

  it('takes nothing while the stock is still short, and leaves the order oversold', async () => {
    const order = await oversoldOrder();
    await setStock('dn50', 9);

    await expect(
      fulfilOversold(db(), { orderId: order.id, now: LATER }),
    ).rejects.toThrow();

    expect(await statusOf(order.id)).toBe('oversold');
    expect(await stockOf('dn50')).toBe(9);
    expect(await reasons(order.id)).toEqual([]);
    expect(await owed(order.id)).toEqual(['order.oversold']);
  });

  it('refuses an order that was not oversold', async () => {
    const pending = await makeOrder();
    const paid = await paidOrder();

    await expect(
      fulfilOversold(db(), { orderId: pending.id, now: LATER }),
    ).rejects.toThrow(/transition/i);
    await expect(
      fulfilOversold(db(), { orderId: paid.id, now: LATER }),
    ).rejects.toThrow(/transition/i);
    expect(await statusOf(pending.id)).toBe('pending');
    expect(await stockOf('dn50')).toBe(90);
  });

  it('takes the stock once when two people fulfil it at the same moment', async () => {
    const order = await oversoldOrder();
    await setStock('dn50', 25);

    const outcome = await settle([
      (database) => fulfilOversold(database, { orderId: order.id, now: LATER }),
      (database) => fulfilOversold(database, { orderId: order.id, now: LATER }),
    ]);

    expect(outcome.fulfilled).toBe(1);
    expect(await stockOf('dn50')).toBe(15);
    expect(await reasons(order.id)).toEqual(['order_paid']);
    expect(await owed(order.id)).toEqual(['order.oversold', 'order.paid']);
  });

  it('refunds or fulfils, never both, when the two happen at the same moment', async () => {
    const order = await oversoldOrder();
    await setStock('dn50', 25);

    const outcome = await settle([
      (database) => fulfilOversold(database, { orderId: order.id, now: LATER }),
      (database) => refundOrder(database, { orderId: order.id, now: LATER }),
    ]);

    expect(outcome.fulfilled).toBe(1);
    const status = await statusOf(order.id);
    if (status === 'paid') {
      expect(await stockOf('dn50')).toBe(15);
      expect(await owed(order.id)).toEqual(['order.oversold', 'order.paid']);
    } else {
      expect(status).toBe('refunded');
      expect(await stockOf('dn50')).toBe(25);
      expect(await reasons(order.id)).toEqual([]);
      expect(await owed(order.id)).toEqual([
        'order.oversold',
        'order.refunded',
      ]);
    }
  });

  it('reports the product whose availability the stock it took changed', async () => {
    const order = await oversoldOrder();
    await setStock('dn50', 10);

    const result = await fulfilOversold(db(), {
      orderId: order.id,
      now: LATER,
    });

    expect(await stockOf('dn50')).toBe(0);
    expect(result.availabilityChanged).toEqual([valve.translationGroup]);
  });
});
