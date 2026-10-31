import { SELF } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { priceCart } from '../../src/plugins/shop/lib/cart-pricing.js';
import { cancelOrder } from '../../src/plugins/shop/lib/order-fulfilment.js';
import {
  deleteExpiredLookups,
  MAX_LOOKUPS_PER_ADDRESS_HOUR,
  MAX_LOOKUPS_PER_VISITOR_HOUR,
} from '../../src/plugins/shop/lib/order-lookup.js';
import {
  createPendingOrder,
  markOrderPaid,
} from '../../src/plugins/shop/lib/orders.js';
import {
  clearShopTables,
  createProduct,
  createVariant,
  db,
  ensureSite,
  ORIGIN,
  setPrice,
  type TestProduct,
} from './helpers.js';

const SHOP = '/_mallok/p/shop';

let bolt: TestProduct;

function ask(
  email: string,
  options: { visitor?: string; locale?: string; website?: string } = {},
): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${SHOP}${options.locale ?? ''}/orders/link`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'cf-connecting-ip': options.visitor ?? '203.0.113.30',
    },
    body: new URLSearchParams({
      email,
      ...(options.website === undefined ? {} : { website: options.website }),
    }).toString(),
    redirect: 'manual',
  });
}

/**
 * An order with this address: paid, left waiting for its payment, or
 * cancelled without one — as when its payment page lapsed.
 */
async function order(
  email: string,
  state: 'paid' | 'pending' | 'cancelled' = 'paid',
): Promise<string> {
  const cart = await priceCart(db(), {
    lines: [{ variantId: 'bolt', quantity: 10 }],
    locale: 'en',
    defaultLocale: 'en',
    currency: 'USD',
  });
  if (!cart.ok) {
    throw new Error('The fixture cart did not price');
  }
  const placed = await createPendingOrder(db(), {
    cart,
    locale: 'en',
    email,
    shippingAddress: {
      recipient: 'Buyer',
      line1: '1 Road',
      city: 'Town',
      postalCode: '1',
      country: 'DE',
    },
    now: new Date(),
  });
  if (state === 'paid') {
    await markOrderPaid(db(), {
      orderId: placed.id,
      eventId: `evt_${placed.id}`,
      paymentIntentId: `pi_${placed.id}`,
      now: new Date(),
    });
  } else if (state === 'cancelled') {
    await cancelOrder(db(), {
      orderId: placed.id,
      reason: 'expired',
      now: new Date(),
    });
  }
  return placed.orderNo;
}

/** The emails Mallok has queued to an address: `{ pluginId, from, message }`. */
async function mailTo(address: string): Promise<Record<string, unknown>[]> {
  const { results } = await db()
    .prepare("SELECT payload FROM job WHERE type = 'email' ORDER BY id")
    .all<{ payload: string }>();
  return results
    .map(
      (row) =>
        (JSON.parse(row.payload) as { message: Record<string, unknown> })
          .message,
    )
    .filter((message) => message.to === address);
}

/** The link in the one email queued to an address. */
async function linkSentTo(address: string): Promise<URL> {
  const [message] = await mailTo(address);
  const text = String(message?.text ?? '');
  const href = /https?:\/\/\S+\/orders\?t=[A-Za-z0-9_-]+/.exec(text)?.[0];
  if (href === undefined) {
    throw new Error(`No link was sent to ${address}: ${text}`);
  }
  return new URL(href);
}

beforeAll(async () => {
  await ensureSite();
  bolt = await createProduct({ title: 'Hex bolt M8', slug: 'lookup-bolt' });
});

beforeEach(async () => {
  await clearShopTables();
  await db().prepare('DELETE FROM job').run();
  await createVariant({
    id: 'bolt',
    productGroup: bolt.translationGroup,
    sku: 'HB-M8',
    moq: 1,
    stock: 1000,
  });
  await setPrice({
    variantId: 'bolt',
    currency: 'USD',
    amountMinor: 990,
    source: 'base',
  });
});

describe('a buyer finding their orders', () => {
  it('is asked for the address they ordered with, on a page that passes no referrer', async () => {
    const response = await SELF.fetch(`${ORIGIN}${SHOP}/orders`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(html).toContain(
      `<form class="quote-form" method="post" action="${SHOP}/orders/link"`,
    );
    expect(html).toContain('name="email" required');
  });

  it('is sent a link that lists every paid order placed with the address, whatever its case', async () => {
    const first = await order('Ada@Buyer.example');
    const second = await order('ada@buyer.example');
    await order('ada@buyer.example', 'pending');
    await order('ada@buyer.example', 'cancelled');

    const answer = await ask('ADA@buyer.example');

    expect(answer.status).toBe(303);
    expect(answer.headers.get('location')).toBe(`${SHOP}/orders?sent=1`);
    const link = await linkSentTo('ADA@buyer.example');
    expect(link.origin).toBe(ORIGIN);
    expect(link.pathname).toBe(`${SHOP}/orders`);
    const listed = await (await SELF.fetch(link)).text();
    expect(listed).toContain(first);
    expect(listed).toContain(second);
    expect(listed).toContain('Paid — being prepared');
    // Never paid, waiting or lapsed: not listed.
    expect((listed.match(/class="cart-name"/g) ?? []).length).toBe(2);
    // Whole: no empty box, no link to nowhere.
    const main = listed.slice(
      listed.indexOf('<main'),
      listed.indexOf('</main>'),
    );
    expect(main).not.toMatch(/<(p|div|ul|li|span|dl|h1|h2)\b[^>]*>\s*<\/\1>/);
    expect(listed).not.toMatch(/href=""/);
    // Each order opens its own page.
    const href = /href="([^"]*\/order\/[^"]+)"/
      .exec(listed)?.[1]
      ?.replace(/&amp;/g, '&');
    const orderPage = await SELF.fetch(`${ORIGIN}${href}`);
    expect(orderPage.status).toBe(200);
    expect(await orderPage.text()).toMatch(/ND-\d{6}-[0-9A-Z]{8}/);
  });

  it('is told the same, and nothing is sent, for an address no payment was made from', async () => {
    await order('pending@buyer.example', 'pending');
    // An order whose page lapsed unpaid proves nothing about its address:
    // anyone could have typed it, as anyone can type it into this form.
    await order('lapsed@buyer.example', 'cancelled');

    const none = await ask('nobody@buyer.example');
    const pending = await ask('pending@buyer.example');
    const lapsed = await ask('lapsed@buyer.example');

    for (const answer of [none, pending, lapsed]) {
      expect(answer.headers.get('location')).toBe(`${SHOP}/orders?sent=1`);
    }
    expect(await mailTo('nobody@buyer.example')).toEqual([]);
    expect(await mailTo('pending@buyer.example')).toEqual([]);
    expect(await mailTo('lapsed@buyer.example')).toEqual([]);
    // Counted all the same, so that the limits say nothing either.
    const recorded = await db()
      .prepare('SELECT COUNT(*) AS n FROM p_shop_order_link')
      .first<{ n: number }>();
    expect(recorded?.n).toBe(3);
  });

  it('is written to in the language they asked in', async () => {
    await order('ada@buyer.example');

    await ask('ada@buyer.example', { locale: '/de' });

    const [message] = await mailTo('ada@buyer.example');
    expect(message?.subject).toBe('Ihre Bestellungen');
    expect((await linkSentTo('ada@buyer.example')).pathname).toBe(
      `${SHOP}/de/orders`,
    );
  });

  it('puts nothing they typed in an address, and stores only the link’s digest', async () => {
    await order('ada@buyer.example');

    const answer = await ask('ada@buyer.example');

    expect(answer.headers.get('location')).not.toContain('ada');
    const link = await linkSentTo('ada@buyer.example');
    const token = link.searchParams.get('t') ?? '';
    const stored = await db()
      .prepare('SELECT id FROM p_shop_order_link')
      .first<{ id: string }>();
    expect(stored?.id).toMatch(/^[0-9a-f]{64}$/);
    expect(stored?.id).not.toContain(token);
  });

  it('finds a link that is not one, or no longer opens, as expired, and lists nothing', async () => {
    await order('ada@buyer.example');
    await ask('ada@buyer.example');
    const link = await linkSentTo('ada@buyer.example');
    await db()
      .prepare(
        "UPDATE p_shop_order_link SET expires_at = '2000-01-01T00:00:00.000Z'",
      )
      .run();

    for (const url of [
      link.toString(),
      `${ORIGIN}${SHOP}/orders?t=${'A'.repeat(43)}`,
      `${ORIGIN}${SHOP}/orders?t=x`,
    ]) {
      const html = await (await SELF.fetch(url)).text();
      expect(html, url).toContain('data-problem="orders_expired"');
      expect(html, url).not.toContain('class="cart-name"');
    }
  });

  it('may be sent only a few links an hour, whoever asks', async () => {
    await order('ada@buyer.example');
    for (
      let attempt = 0;
      attempt < MAX_LOOKUPS_PER_ADDRESS_HOUR;
      attempt += 1
    ) {
      const answer = await ask('ada@buyer.example', {
        visitor: `198.51.100.${attempt}`,
      });
      expect(answer.headers.get('location')).toBe(`${SHOP}/orders?sent=1`);
    }

    const over = await ask('ada@buyer.example', { visitor: '198.51.100.99' });

    expect(over.headers.get('location')).toBe(`${SHOP}/orders?lookup=too_many`);
    expect(await mailTo('ada@buyer.example')).toHaveLength(
      MAX_LOOKUPS_PER_ADDRESS_HOUR,
    );
  });

  it('may ask only a few times an hour from one place', async () => {
    for (
      let attempt = 0;
      attempt < MAX_LOOKUPS_PER_VISITOR_HOUR;
      attempt += 1
    ) {
      await ask(`buyer${attempt}@buyer.example`, { visitor: '198.51.100.50' });
    }

    const over = await ask('another@buyer.example', {
      visitor: '198.51.100.50',
    });

    expect(over.headers.get('location')).toBe(`${SHOP}/orders?lookup=too_many`);
  });

  it('is turned away for an address that is not one, and ignored for the field no person sees', async () => {
    await order('ada@buyer.example');

    const invalid = await ask('not an address');
    const trap = await ask('ada@buyer.example', {
      website: 'https://spam.example',
    });

    expect(invalid.headers.get('location')).toBe(
      `${SHOP}/orders?lookup=invalid`,
    );
    expect(trap.headers.get('location')).toBe(`${SHOP}/orders?sent=1`);
    expect(await mailTo('ada@buyer.example')).toEqual([]);
  });

  it('leaves no link behind once it can open nothing', async () => {
    await ask('ada@buyer.example');
    await ask('bob@buyer.example');
    await db()
      .prepare(
        "UPDATE p_shop_order_link SET expires_at = '2000-01-01T00:00:00.000Z' WHERE email = 'ada@buyer.example'",
      )
      .run();

    expect(await deleteExpiredLookups(db(), new Date(), 50)).toBe(1);
    const left = await db()
      .prepare('SELECT email FROM p_shop_order_link')
      .all<{ email: string }>();
    expect(left.results).toEqual([{ email: 'bob@buyer.example' }]);
  });
});
