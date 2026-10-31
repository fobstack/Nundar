import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { priceCart } from '../../src/plugins/shop/lib/cart-pricing.js';
import { refundOrder } from '../../src/plugins/shop/lib/order-fulfilment.js';
import {
  createPendingOrder,
  markOrderPaid,
} from '../../src/plugins/shop/lib/orders.js';
import {
  api,
  clearShopTables,
  createProduct,
  createVariant,
  db,
  ensureSite,
  setPrice,
  storeInquiry,
  type TestProduct,
} from './helpers.js';

/**
 * The admin's customers and sales: read-only views over what the shop
 * holds, read here through Mallok's own panel API as the admin reads them.
 */

const PANEL = '/_mallok/api/plugins/shop/panels';

let bolt: TestProduct;
let nut: TestProduct;

async function rows(
  panel: string,
  query = '',
): Promise<Record<string, unknown>[]> {
  const response = await api('GET', `${PANEL}/${panel}${query}`);
  expect(response.status, panel).toBe(200);
  return ((await response.json()) as { rows: Record<string, unknown>[] }).rows;
}

/** An order of `quantity` bolts and nuts, placed and paid when told. */
async function order(input: {
  email: string;
  company?: string;
  currency?: 'USD' | 'EUR';
  bolts?: number;
  nuts?: number;
  placed: string;
  paid?: string;
}): Promise<string> {
  const lines = [
    ...((input.bolts ?? 10) > 0
      ? [{ variantId: 'bolt', quantity: input.bolts ?? 10 }]
      : []),
    ...((input.nuts ?? 0) > 0
      ? [{ variantId: 'nut', quantity: input.nuts ?? 0 }]
      : []),
  ];
  const cart = await priceCart(db(), {
    lines,
    locale: 'en',
    defaultLocale: 'en',
    currency: input.currency ?? 'USD',
  });
  if (!cart.ok) {
    throw new Error(`The fixture cart did not price: ${JSON.stringify(cart)}`);
  }
  const placed = await createPendingOrder(db(), {
    cart,
    locale: 'en',
    email: input.email,
    company: input.company ?? '',
    shippingAddress: {
      recipient: 'Buyer',
      line1: '1 Road',
      city: 'Town',
      postalCode: '1',
      country: 'DE',
    },
    shippingMinor: 500,
    now: new Date(input.placed),
  });
  if (input.paid !== undefined) {
    await markOrderPaid(db(), {
      orderId: placed.id,
      eventId: `evt_${placed.id}`,
      paymentIntentId: `pi_${placed.id}`,
      now: new Date(input.paid),
    });
  }
  return placed.id;
}

beforeAll(async () => {
  await ensureSite();
  bolt = await createProduct({ title: 'Hex bolt M8', slug: 'sales-bolt' });
  nut = await createProduct({ title: 'Flange nut M8', slug: 'sales-nut' });
});

beforeEach(async () => {
  await clearShopTables();
  await createVariant({
    id: 'bolt',
    productGroup: bolt.translationGroup,
    sku: 'HB-M8',
    moq: 1,
    stock: 10_000,
  });
  await createVariant({
    id: 'nut',
    productGroup: nut.translationGroup,
    sku: 'FN-M8',
    moq: 1,
    stock: 10_000,
  });
  for (const [variantId, currency, amountMinor] of [
    ['bolt', 'USD', 990],
    ['bolt', 'EUR', 900],
    ['nut', 'USD', 45],
    ['nut', 'EUR', 40],
  ] as const) {
    await setPrice({ variantId, currency, amountMinor, source: 'base' });
  }
});

describe('the customers panel', () => {
  it('gathers one customer’s orders and inquiries under their address, whatever its case', async () => {
    await order({
      email: 'Ada@Buyer.example',
      company: 'Old Name Ltd',
      placed: '2026-09-01T10:00:00.000Z',
      paid: '2026-09-01T10:05:00.000Z',
    });
    await order({
      email: 'ada@buyer.example',
      company: 'Analytical Engines Ltd',
      currency: 'EUR',
      placed: '2026-10-02T10:00:00.000Z',
      paid: '2026-10-02T10:05:00.000Z',
    });
    // Placed and never paid: a contact, not a sale.
    await order({
      email: 'ada@buyer.example',
      placed: '2026-10-03T10:00:00.000Z',
    });
    await storeInquiry({
      id: 'inq-ada',
      at: '2026-10-04T10:00:00.000Z',
      form: { name: 'Ada', email: 'ADA@buyer.example', company: '' },
    });
    await storeInquiry({
      id: 'inq-bob',
      at: '2026-10-05T10:00:00.000Z',
      form: { name: 'Bob', email: 'bob@other.example', company: 'Bob & Co' },
    });

    const listed = await rows('customers');

    expect(listed).toHaveLength(2);
    // Newest first, as the panel orders it.
    expect(listed.map((row) => row.id)).toEqual([
      'bob@other.example',
      'ada@buyer.example',
    ]);
    expect(listed[1]).toMatchObject({
      email: 'ADA@buyer.example',
      company: 'Analytical Engines Ltd',
      // The newest contact that named one: the inquiry.
      country: 'GB',
      orders: 2,
      inquiries: 1,
      // In each currency, in the currencies' order.
      spent: 'EUR 95.00  USD 104.00',
      first_seen: '2026-09-01T10:00:00.000Z',
      last_seen: '2026-10-04T10:00:00.000Z',
    });
    expect(listed[0]).toMatchObject({
      orders: 0,
      inquiries: 1,
      spent: '',
      company: 'Bob & Co',
    });
  });

  it('lists a customer’s orders and inquiries beside them', async () => {
    const paid = await order({
      email: 'ada@buyer.example',
      placed: '2026-10-01T10:00:00.000Z',
      paid: '2026-10-01T10:05:00.000Z',
    });
    await storeInquiry({
      id: 'inq-ada',
      form: { name: 'Ada', email: 'ada@buyer.example' },
    });

    const orders = (await (
      await api(
        'GET',
        `${PANEL}/customers/related/orders?parent=${encodeURIComponent('ada@buyer.example')}`,
      )
    ).json()) as { rows: Record<string, unknown>[] };
    const inquiries = (await (
      await api(
        'GET',
        `${PANEL}/customers/related/inquiries?parent=${encodeURIComponent('ada@buyer.example')}`,
      )
    ).json()) as { rows: Record<string, unknown>[] };

    const number = await db()
      .prepare('SELECT order_no FROM p_shop_order WHERE id = ?')
      .bind(paid)
      .first<{ order_no: string }>();
    // The columns the panel declares, and no others.
    expect(orders.rows).toEqual([
      {
        order_no: number?.order_no,
        status: 'paid',
        total: 'USD 104.00',
        created_at: '2026-10-01T10:00:00.000Z',
      },
    ]);
    expect(inquiries.rows).toEqual([
      // A part without a price leaves the inquiry with no subtotal.
      expect.objectContaining({ status: 'new', subtotal: '' }),
    ]);
  });

  it('finds a customer by part of their address or company', async () => {
    await order({
      email: 'ada@buyer.example',
      company: 'Analytical Engines',
      placed: '2026-10-01T10:00:00.000Z',
    });
    await order({
      email: 'bob@other.example',
      company: 'Bob & Co',
      placed: '2026-10-01T11:00:00.000Z',
    });

    expect(
      (await rows('customers', '?q=engines')).map((row) => row.id),
    ).toEqual(['ada@buyer.example']);
    expect(
      (await rows('customers', '?q=other.example')).map((row) => row.id),
    ).toEqual(['bob@other.example']);
  });
});

describe('the sales panels', () => {
  it('count a sale in the month it was paid, and a refund in the month it was made, by currency', async () => {
    // Placed in September, paid in October: an October sale.
    await order({
      email: 'a@x.example',
      placed: '2026-09-30T23:00:00.000Z',
      paid: '2026-10-01T00:30:00.000Z',
    });
    const refunded = await order({
      email: 'b@x.example',
      bolts: 20,
      placed: '2026-10-05T10:00:00.000Z',
      paid: '2026-10-05T10:05:00.000Z',
    });
    await order({
      email: 'c@x.example',
      currency: 'EUR',
      placed: '2026-10-06T10:00:00.000Z',
      paid: '2026-10-06T10:05:00.000Z',
    });
    await order({ email: 'd@x.example', placed: '2026-10-07T10:00:00.000Z' });
    await refundOrder(db(), {
      orderId: refunded,
      now: new Date('2026-11-02T09:00:00.000Z'),
    });

    const months = await rows('sales');

    expect(
      months.map((row) => [
        row.id,
        row.orders,
        row.revenue,
        row.refunds,
        row.refunded,
        row.net,
        row.average,
      ]),
    ).toEqual([
      ['2026-11:USD', 0, 'USD 0.00', 1, 'USD 203.00', '-USD 203.00', ''],
      [
        '2026-10:USD',
        2,
        'USD 307.00',
        0,
        'USD 0.00',
        'USD 307.00',
        'USD 153.50',
      ],
      ['2026-10:EUR', 1, 'EUR 95.00', 0, 'EUR 0.00', 'EUR 95.00', 'EUR 95.00'],
    ]);
    expect((await rows('sales', '?currency=EUR')).map((row) => row.id)).toEqual(
      ['2026-10:EUR'],
    );
  });

  it('say what sells, by SKU, over orders paid and kept', async () => {
    await order({
      email: 'a@x.example',
      bolts: 10,
      nuts: 100,
      placed: '2026-10-01T10:00:00.000Z',
      paid: '2026-10-01T10:05:00.000Z',
    });
    await order({
      email: 'b@x.example',
      bolts: 5,
      placed: '2026-10-02T10:00:00.000Z',
      paid: '2026-10-02T10:05:00.000Z',
    });
    const refunded = await order({
      email: 'c@x.example',
      bolts: 50,
      placed: '2026-10-03T10:00:00.000Z',
      paid: '2026-10-03T10:05:00.000Z',
    });
    await order({
      email: 'd@x.example',
      bolts: 70,
      placed: '2026-10-04T10:00:00.000Z',
    });
    await refundOrder(db(), {
      orderId: refunded,
      now: new Date('2026-10-04T09:00:00.000Z'),
    });

    const products = await rows('product-sales');

    expect(
      products.map((row) => [
        row.id,
        row.name,
        row.quantity,
        row.orders,
        row.revenue,
      ]),
    ).toEqual([
      ['HB-M8:USD', 'Hex bolt M8', 15, 2, 'USD 148.50'],
      ['FN-M8:USD', 'Flange nut M8', 100, 1, 'USD 45.00'],
    ]);
  });
});
