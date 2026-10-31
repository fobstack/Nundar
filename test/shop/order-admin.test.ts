import type { PluginContext } from 'mallok/worker';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { priceCart } from '../../src/plugins/shop/lib/cart-pricing.js';
import {
  cancelOrders,
  deliverOrders,
  fulfilOrders,
  REFUNDED_OUTSIDE,
  RESTOCK_CHOICES,
  refundOrders,
  refundRefusedPayments,
  shipOrders,
} from '../../src/plugins/shop/lib/order-admin.js';
import { shipOrder } from '../../src/plugins/shop/lib/order-fulfilment.js';
import {
  createPendingOrder,
  markOrderPaid,
  recordCheckoutSession,
} from '../../src/plugins/shop/lib/orders.js';
import {
  api,
  clearShopTables,
  createProduct,
  createVariant,
  db,
  ensureSite,
  outboxRows,
  type StripeCall,
  setPrice,
  setStock,
  stockOf,
  stubStripe,
  type TestProduct,
} from './helpers.js';

const NOW = new Date('2026-10-31T08:00:00.000Z');
const LATER = new Date('2026-10-31T09:00:00.000Z');
const PANEL = '/_mallok/api/plugins/shop/panels';

let bolt: TestProduct;
let stripe: { calls: StripeCall[]; restore: () => void } | null = null;

/** Mallok's context for an action, recording the jobs it queues. */
function context(
  secrets: Record<string, string> = { stripe_secret_key: 'sk_test_admin' },
): {
  ctx: PluginContext;
  queued: unknown[];
} {
  const queued: unknown[] = [];
  return {
    queued,
    ctx: {
      db: db(),
      secrets,
      enqueue: async (_name: string, payload: unknown) => {
        queued.push(payload);
        return `job-${queued.length}`;
      },
    } as unknown as PluginContext,
  };
}

async function order(quantity = 100): Promise<{ id: string; orderNo: string }> {
  const cart = await priceCart(db(), {
    lines: [{ variantId: 'hb-m8', quantity }],
    locale: 'en',
    defaultLocale: 'en',
    currency: 'USD',
  });
  if (!cart.ok) {
    throw new Error('The fixture cart did not price');
  }
  return createPendingOrder(db(), {
    cart,
    locale: 'en',
    email: 'ada@buyer.example',
    shippingAddress: {
      recipient: 'Ada Lovelace',
      line1: 'Hafenstraße 1',
      line2: 'Hof 3',
      city: 'Hamburg',
      postalCode: '20457',
      country: 'DE',
    },
    shippingMinor: 4905,
    company: 'Analytical Engines Ltd',
    now: NOW,
  });
}

async function paid(quantity = 100): Promise<{ id: string; orderNo: string }> {
  const placed = await order(quantity);
  await markOrderPaid(db(), {
    orderId: placed.id,
    eventId: `evt_${placed.id}`,
    paymentIntentId: `pi_${placed.id}`,
    now: NOW,
  });
  return placed;
}

/** Placed while there was stock, paid for once it had gone. */
async function oversold(): Promise<{ id: string; orderNo: string }> {
  const placed = await order();
  await setStock('hb-m8', 0);
  await markOrderPaid(db(), {
    orderId: placed.id,
    eventId: `evt_${placed.id}`,
    paymentIntentId: `pi_${placed.id}`,
    now: NOW,
  });
  return placed;
}

async function statusOf(id: string): Promise<string | undefined> {
  return (
    await db()
      .prepare('SELECT status FROM p_shop_order WHERE id = ?')
      .bind(id)
      .first<{ status: string }>()
  )?.status;
}

async function errorOf(response: Response | undefined): Promise<string> {
  if (response === undefined) {
    throw new Error('The action was not refused');
  }
  expect(response.status).toBe(422);
  return ((await response.json()) as { error: string }).error;
}

beforeAll(async () => {
  await ensureSite();
  bolt = await createProduct({ title: 'Hex bolt M8', slug: 'admin-bolt' });
});

beforeEach(async () => {
  await clearShopTables();
  await createVariant({
    id: 'hb-m8',
    productGroup: bolt.translationGroup,
    sku: 'HB-M8',
    moq: 10,
    stock: 1000,
  });
  await setPrice({
    variantId: 'hb-m8',
    currency: 'USD',
    amountMinor: 990,
    source: 'base',
  });
  stripe = stubStripe();
});

afterEach(() => {
  stripe?.restore();
  stripe = null;
});

describe('the orders panel', () => {
  it('lists an order with its amounts spelled out and its address on one line', async () => {
    const placed = await order();

    const response = await api('GET', `${PANEL}/orders`);
    const { rows } = (await response.json()) as {
      rows: Record<string, unknown>[];
    };

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: placed.id,
      order_no: placed.orderNo,
      status: 'pending',
      company: 'Analytical Engines Ltd',
      recipient: 'Ada Lovelace',
      country: 'DE',
      subtotal: 'USD 990.00',
      shipping: 'USD 49.05',
      tax: 'USD 0.00',
      total: 'USD 1039.05',
      address: 'Hafenstraße 1, Hof 3, 20457 Hamburg, DE',
      refunds_owed: 0,
    });
  });

  it('lists an order’s lines beside it', async () => {
    const placed = await order(17);

    const response = await api(
      'GET',
      `${PANEL}/orders/related/lines?parent=${placed.id}`,
    );
    const { rows } = (await response.json()) as {
      rows: Record<string, unknown>[];
    };

    expect(rows).toEqual([
      expect.objectContaining({
        sku: 'HB-M8',
        name: 'Hex bolt M8',
        quantity: 17,
        unit_price: 'USD 9.90',
        line_total: 'USD 168.30',
      }),
    ]);
  });

  it('runs an action through Mallok’s own panel API', async () => {
    const placed = await paid();

    const response = await api('POST', `${PANEL}/orders/actions/order_ship`, {
      ids: [placed.id],
      params: { tracking_no: '1Z999', carrier: 'UPS' },
    });

    expect(response.status).toBe(200);
    expect(await statusOf(placed.id)).toBe('shipped');
  });
});

describe('shipping', () => {
  it('records the tracking number and the carrier, and queues the buyer’s notice', async () => {
    const placed = await paid();
    const { ctx, queued } = context();

    const response = await shipOrders(
      [placed.id],
      ctx,
      {
        tracking_no: ' 1Z999 ',
        carrier: 'Other',
        carrier_other: 'Kuehne+Nagel',
      },
      LATER,
    );

    expect(response).toBeUndefined();
    const row = await db()
      .prepare(
        'SELECT status, tracking_no, carrier FROM p_shop_order WHERE id = ?',
      )
      .bind(placed.id)
      .first();
    expect(row).toEqual({
      status: 'shipped',
      tracking_no: '1Z999',
      carrier: 'Kuehne+Nagel',
    });
    expect(queued).toEqual([{ orderId: placed.id }]);
  });

  it('ships one order at a time, with a number and a named carrier, and only once paid', async () => {
    const first = await paid();
    const second = await paid();
    const waiting = await order();
    const { ctx } = context();

    expect(
      await errorOf(
        await shipOrders([first.id, second.id], ctx, {
          tracking_no: 'T',
          carrier: 'DHL',
        }),
      ),
    ).toMatch(/one order at a time/);
    expect(
      await errorOf(
        await shipOrders([first.id], ctx, { tracking_no: ' ', carrier: 'DHL' }),
      ),
    ).toMatch(/tracking number/);
    expect(
      await errorOf(
        await shipOrders([first.id], ctx, {
          tracking_no: 'T',
          carrier: 'Other',
        }),
      ),
    ).toMatch(/Name the carrier/);
    expect(
      await errorOf(
        await shipOrders([waiting.id], ctx, {
          tracking_no: 'T',
          carrier: 'DHL',
        }),
      ),
    ).toMatch(/is pending/);
    expect(await statusOf(first.id)).toBe('paid');
  });
});

describe('delivery', () => {
  it('marks shipped orders delivered and says which could not be', async () => {
    const shipped = await paid();
    await shipOrder(db(), { orderId: shipped.id, trackingNo: 'T', now: NOW });
    const notYet = await paid();
    const { ctx } = context();

    const response = await deliverOrders([shipped.id, notYet.id], ctx, LATER);

    expect(await errorOf(response)).toMatch(/^1 changed\. .* is paid/);
    expect(await statusOf(shipped.id)).toBe('delivered');
    expect(await statusOf(notYet.id)).toBe('paid');
  });
});

describe('cancelling', () => {
  it('closes the payment page at Stripe first, then cancels, and the buyer is told', async () => {
    const placed = await order();
    await recordCheckoutSession(db(), {
      orderId: placed.id,
      sessionId: 'cs_admin',
      expiresAt: LATER,
      now: NOW,
    });
    const { ctx, queued } = context();

    const response = await cancelOrders(
      [placed.id],
      ctx,
      { confirm: true },
      LATER,
    );

    expect(response).toBeUndefined();
    expect(stripe?.calls.map((call) => call.path)).toEqual([
      '/v1/checkout/sessions/cs_admin/expire',
    ]);
    expect(await statusOf(placed.id)).toBe('cancelled');
    expect((await outboxRows()).map((row) => row.ref)).toEqual(['seller']);
    expect(queued).toEqual([{ orderId: placed.id }]);
  });

  it('cancels nothing that Stripe could not be asked about', async () => {
    stripe?.restore();
    stripe = stubStripe({
      fail: () => ({ status: 500, body: { error: { type: 'api_error' } } }),
    });
    const placed = await order();
    await recordCheckoutSession(db(), {
      orderId: placed.id,
      sessionId: 'cs_admin',
      expiresAt: LATER,
      now: NOW,
    });
    const { ctx } = context();

    expect(
      await errorOf(
        await cancelOrders([placed.id], ctx, { confirm: true }, LATER),
      ),
    ).toMatch(/Stripe could not be reached/);
    expect(await statusOf(placed.id)).toBe('pending');
  });

  it('cancels nothing that was paid as the page was being closed', async () => {
    const placed = await order();
    await recordCheckoutSession(db(), {
      orderId: placed.id,
      sessionId: 'cs_admin',
      expiresAt: LATER,
      now: NOW,
    });
    stripe?.restore();
    stripe = stubStripe({
      fail: async (path) => {
        if (!path.endsWith('/expire')) {
          return null;
        }
        // Paid at Stripe a moment before the seller pressed the button.
        await markOrderPaid(db(), {
          orderId: placed.id,
          eventId: 'evt_moment',
          paymentIntentId: 'pi_moment',
          now: NOW,
        });
        return {
          status: 400,
          body: { error: { type: 'invalid_request_error' } },
        };
      },
    });
    const { ctx } = context();
    const response = await cancelOrders(
      [placed.id],
      ctx,
      { confirm: true },
      LATER,
    );

    expect(await errorOf(response)).toMatch(/paid meanwhile/);
    expect(await statusOf(placed.id)).toBe('paid');
  });

  it('asks for the box, for Stripe’s key when there is a page to close, and refuses a paid or oversold order', async () => {
    const waiting = await order();
    await recordCheckoutSession(db(), {
      orderId: waiting.id,
      sessionId: 'cs_admin',
      expiresAt: LATER,
      now: NOW,
    });
    const settled = await paid();
    const sold = await oversold();

    expect(
      await errorOf(await cancelOrders([waiting.id], context().ctx, {}, LATER)),
    ).toMatch(/Tick the box/);
    expect(
      await errorOf(
        await cancelOrders(
          [waiting.id],
          context({}).ctx,
          { confirm: true },
          LATER,
        ),
      ),
    ).toMatch(/Stripe secret key/);
    const refusals = await errorOf(
      await cancelOrders(
        [settled.id, sold.id],
        context().ctx,
        { confirm: true },
        LATER,
      ),
    );
    expect(refusals).toMatch(/is paid: .*refund a paid one/);
    expect(refusals).toMatch(
      /is oversold: refund it, or restock and fulfil it/,
    );
    expect(await statusOf(waiting.id)).toBe('pending');
  });
});

describe('refunding', () => {
  it('refunds at Stripe first, then the books, and puts back the stock of what never left', async () => {
    const placed = await paid();
    const { ctx, queued } = context();

    const response = await refundOrders(
      [placed.id],
      ctx,
      { confirm: true, restock: RESTOCK_CHOICES[0] },
      LATER,
    );

    expect(response).toBeUndefined();
    expect(
      stripe?.calls.map((call) => [call.path, call.body.get('payment_intent')]),
    ).toEqual([['/v1/refunds', `pi_${placed.id}`]]);
    expect(await statusOf(placed.id)).toBe('refunded');
    expect(await stockOf('hb-m8')).toBe(1000);
    expect(queued).toEqual([{ orderId: placed.id }]);
  });

  it('leaves the stock of a shipped order where it is, unless told it came back', async () => {
    const kept = await paid();
    await shipOrder(db(), { orderId: kept.id, trackingNo: 'T', now: NOW });
    const returned = await paid();
    await shipOrder(db(), { orderId: returned.id, trackingNo: 'T', now: NOW });
    const { ctx } = context();

    await refundOrders(
      [kept.id],
      ctx,
      { confirm: true, restock: RESTOCK_CHOICES[0] },
      LATER,
    );
    expect(await stockOf('hb-m8')).toBe(800);
    await refundOrders(
      [returned.id],
      ctx,
      { confirm: true, restock: RESTOCK_CHOICES[1] },
      LATER,
    );
    expect(await stockOf('hb-m8')).toBe(900);
  });

  it('records a refund made in Stripe’s own dashboard, which Stripe will not make twice', async () => {
    stripe?.restore();
    stripe = stubStripe({
      fail: () => ({
        status: 400,
        body: {
          error: {
            type: 'invalid_request_error',
            code: 'charge_already_refunded',
          },
        },
      }),
    });
    const placed = await paid();

    const response = await refundOrders(
      [placed.id],
      context().ctx,
      { confirm: true, restock: RESTOCK_CHOICES[0] },
      LATER,
    );

    expect(response).toBeUndefined();
    expect(await statusOf(placed.id)).toBe('refunded');
  });

  it('changes nothing when Stripe refunds nothing', async () => {
    stripe?.restore();
    stripe = stubStripe({
      fail: () => ({
        status: 402,
        body: { error: { type: 'card_error', code: 'balance_insufficient' } },
      }),
    });
    const placed = await paid();

    const message = await errorOf(
      await refundOrders([placed.id], context().ctx, { confirm: true }, LATER),
    );

    expect(message).toMatch(
      /Stripe did not refund it \(Stripe: card_error, balance_insufficient, status 402\)/,
    );
    expect(await statusOf(placed.id)).toBe('paid');
    expect(await stockOf('hb-m8')).toBe(900);
  });

  it('asks for the box and for Stripe’s key, and refunds only what was paid', async () => {
    const waiting = await order();

    expect(
      await errorOf(await refundOrders([waiting.id], context().ctx, {}, LATER)),
    ).toMatch(/Tick the box/);
    expect(
      await errorOf(
        await refundOrders(
          [waiting.id],
          context({}).ctx,
          { confirm: true },
          LATER,
        ),
      ),
    ).toMatch(/Stripe secret key/);
    expect(
      await errorOf(
        await refundOrders(
          [waiting.id],
          context().ctx,
          { confirm: true },
          LATER,
        ),
      ),
    ).toMatch(/only an order that was paid/);
    expect(stripe?.calls).toEqual([]);
  });
});

describe('an oversold order', () => {
  it('is fulfilled once its stock is back, and then waits to ship', async () => {
    const placed = await oversold();
    await setStock('hb-m8', 150);
    const { ctx, queued } = context();

    const response = await fulfilOrders(
      [placed.id],
      ctx,
      { confirm: true },
      LATER,
    );

    expect(response).toBeUndefined();
    expect(await statusOf(placed.id)).toBe('paid');
    expect(await stockOf('hb-m8')).toBe(50);
    expect(queued).toEqual([{ orderId: placed.id }]);
  });

  it('is not fulfilled while its stock is short, and says so', async () => {
    const placed = await oversold();
    await setStock('hb-m8', 99);

    const message = await errorOf(
      await fulfilOrders([placed.id], context().ctx, { confirm: true }, LATER),
    );

    expect(message).toMatch(/not enough stock yet/);
    expect(await statusOf(placed.id)).toBe('oversold');
    expect(await stockOf('hb-m8')).toBe(99);
  });

  it('is refunded in full, with nothing put back that it never took', async () => {
    const placed = await oversold();

    await refundOrders([placed.id], context().ctx, { confirm: true }, LATER);

    expect(await statusOf(placed.id)).toBe('refunded');
    expect(await stockOf('hb-m8')).toBe(0);
  });
});

describe('a payment the shop could not keep', () => {
  async function refusedPayment(): Promise<{ orderId: string }> {
    const placed = await paid();
    await markOrderPaid(db(), {
      orderId: placed.id,
      eventId: 'evt_second',
      paymentIntentId: 'pi_second',
      now: NOW,
    });
    return { orderId: placed.id };
  }

  it('is listed as owed, and on its order', async () => {
    const { orderId } = await refusedPayment();

    const { rows } = (await (
      await api('GET', `${PANEL}/refused-payments`)
    ).json()) as {
      rows: Record<string, unknown>[];
    };
    const orders = (await (await api('GET', `${PANEL}/orders`)).json()) as {
      rows: Record<string, unknown>[];
    };

    expect(rows).toEqual([
      expect.objectContaining({
        id: 'evt_second',
        order_status: 'paid',
        payment_intent_id: 'pi_second',
        state: 'to_refund',
        refund_id: null,
      }),
    ]);
    expect(orders.rows.find((row) => row.id === orderId)?.refunds_owed).toBe(1);
  });

  it('is refunded at Stripe and the refund recorded, once', async () => {
    await refusedPayment();
    const { ctx } = context();

    await refundRefusedPayments(['evt_second'], ctx, { confirm: true });
    await refundRefusedPayments(['evt_second'], ctx, { confirm: true });

    expect(
      stripe?.calls.map((call) => call.body.get('payment_intent')),
    ).toEqual(['pi_second']);
    expect(stripe?.calls[0]?.body.has('reason')).toBe(false);
    const row = await db()
      .prepare(
        "SELECT refund_id FROM p_shop_stripe_event WHERE event_id = 'evt_second'",
      )
      .first<{ refund_id: string }>();
    expect(row?.refund_id).toMatch(/^re_test_/);
  });

  it('records a refund made at Stripe already', async () => {
    stripe?.restore();
    stripe = stubStripe({
      fail: () => ({
        status: 400,
        body: {
          error: {
            type: 'invalid_request_error',
            code: 'charge_already_refunded',
          },
        },
      }),
    });
    await refusedPayment();

    await refundRefusedPayments(['evt_second'], context().ctx, {
      confirm: true,
    });

    const row = await db()
      .prepare(
        "SELECT refund_id FROM p_shop_stripe_event WHERE event_id = 'evt_second'",
      )
      .first<{ refund_id: string }>();
    expect(row?.refund_id).toBe(REFUNDED_OUTSIDE);
  });

  it('is never one the order was paid with', async () => {
    const placed = await paid();
    const { ctx } = context();

    await refundRefusedPayments([`evt_${placed.id}`], ctx, { confirm: true });

    expect(stripe?.calls).toEqual([]);
  });
});
