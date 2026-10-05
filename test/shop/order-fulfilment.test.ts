import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CartLine } from '../../src/plugins/shop/lib/cart.js';
import { priceCart } from '../../src/plugins/shop/lib/cart-pricing.js';
import {
  cancelOrder,
  markDelivered,
  refundOrder,
  shipOrder,
} from '../../src/plugins/shop/lib/order-fulfilment.js';
import {
  createPendingOrder,
  getOrder,
  markOrderPaid,
  OrderNotFoundError,
} from '../../src/plugins/shop/lib/orders.js';
import {
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
  attempts: readonly Promise<unknown>[],
): Promise<{ fulfilled: number; reasons: string[] }> {
  const settled = await Promise.allSettled(attempts);
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
      cancelOrder(db(), { orderId: order.id, now: LATER }),
      cancelOrder(db(), { orderId: order.id, now: LATER }),
    ]);

    expect(outcome.fulfilled).toBe(1);
    expect(await statusOf(order.id)).toBe('cancelled');
    expect(await owed(order.id)).toEqual(['order.cancelled']);
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
      refundOrder(db(), { orderId: order.id, now: LATER }),
      refundOrder(db(), { orderId: order.id, now: LATER }),
    ]);

    expect(outcome.fulfilled).toBe(1);
    expect(await stockOf('dn50')).toBe(100);
    expect(await reasons(order.id)).toEqual(['order_paid', 'refund']);
    expect(await owed(order.id)).toEqual(['order.paid', 'order.refunded']);
  });

  it('ships or refunds, never both, when the two happen at the same moment', async () => {
    const order = await paidOrder();

    const outcome = await settle([
      shipOrder(db(), { orderId: order.id, trackingNo: 'T-1', now: LATER }),
      refundOrder(db(), { orderId: order.id, now: LATER }),
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
