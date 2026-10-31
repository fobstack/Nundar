import { SELF } from 'cloudflare:test';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  existingOrderLinkKey,
  tokenOpens,
} from '../../src/plugins/shop/lib/order-access.js';
import { MAX_CHECKOUTS_PER_HOUR } from '../../src/plugins/shop/routes/checkout.js';
import {
  api,
  clearShopTables,
  createProduct,
  createShippingZone,
  createVariant,
  db,
  ensureSite,
  holdWrites,
  ORIGIN,
  outboxRows,
  type StripeCall,
  setPrice,
  setShopSecrets,
  setShopSettings,
  stockOf,
  stubStripe,
  type TestProduct,
} from './helpers.js';

const SHOP = '/_mallok/p/shop';
const KEYS = {
  stripe_secret_key: 'sk_test_checkout',
  stripe_webhook_secret: 'whsec_checkout',
};

let bolt: TestProduct;
let stripe: { calls: StripeCall[]; restore: () => void } | null = null;

function post(
  path: string,
  fields: Record<string, string>,
  cookie?: string,
  visitor = '203.0.113.20',
): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${SHOP}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'cf-connecting-ip': visitor,
      ...(cookie === undefined ? {} : { cookie }),
    },
    body: new URLSearchParams(fields).toString(),
    redirect: 'manual',
  });
}

function page(path: string, cookie?: string): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${SHOP}${path}`, {
    headers: cookie === undefined ? {} : { cookie },
    redirect: 'manual',
  });
}

/** A cart holding `quantity` of the bolt; answers with its cookie. */
async function cartWith(quantity: number, locale = ''): Promise<string> {
  const response = await post(`${locale}/cart/update`, {
    variant: 'hb-m8',
    quantity: String(quantity),
  });
  return response.headers.get('set-cookie')?.split(';')[0] ?? 'no cookie';
}

const BUYER = {
  email: 'ada@buyer.example',
  company: 'Analytical Engines Ltd',
  recipient: 'Ada Lovelace',
  phone: '+49 40 000000',
  line1: 'Hafenstraße 1',
  line2: '',
  postal_code: '20457',
  city: 'Hamburg',
  state: '',
  tax_id: 'DE123456789',
  country: 'DE',
};

function place(
  cookie: string | undefined,
  fields: Record<string, string> = BUYER,
  locale = '',
  visitor?: string,
): Promise<Response> {
  return post(`${locale}/checkout/place`, fields, cookie, visitor);
}

/** Where a response sends the buyer, taken apart. */
function landing(response: Response): URL {
  return new URL(response.headers.get('location') ?? '/', ORIGIN);
}

interface OrderRow {
  id: string;
  order_no: string;
  status: string;
  currency: string;
  subtotal_minor: number;
  shipping_minor: number;
  total_minor: number;
  email: string;
  company: string;
  tax_id: string;
  shipping_zone: string;
  tax_mode: string;
  site_origin: string;
  cart_id: string | null;
  locale: string;
  stripe_session_id: string | null;
  stripe_session_expires_at: string | null;
  shipping_address: string;
}

async function orders(): Promise<OrderRow[]> {
  const { results } = await db()
    .prepare('SELECT * FROM p_shop_order ORDER BY created_at, id')
    .all<OrderRow>();
  return results;
}

function sessionCalls(): StripeCall[] {
  return (stripe?.calls ?? []).filter(
    (call) => call.path === '/v1/checkout/sessions',
  );
}

beforeAll(async () => {
  await ensureSite();
  bolt = await createProduct({
    title: 'Hex bolt M8',
    slug: 'checkout-hex-bolt',
  });
});

beforeEach(async () => {
  await clearShopTables();
  await setShopSecrets(KEYS);
  await setShopSettings({ tax_mode: 'none', terms_path: '' });
  await createVariant({
    id: 'hb-m8',
    productGroup: bolt.translationGroup,
    sku: 'HB-M8',
    moq: 10,
    stock: 1000,
  });
  for (const [currency, amountMinor] of [
    ['USD', 990],
    ['EUR', 900],
  ] as const) {
    await setPrice({
      variantId: 'hb-m8',
      currency,
      amountMinor,
      source: 'base',
    });
  }
  await createShippingZone({
    name: 'Europe',
    countries: ['DE', 'FR'],
    rates: [
      { currency: 'USD', amountMinor: 4900, freeOverMinor: 500_000 },
      { currency: 'EUR', amountMinor: 4500 },
    ],
  });
  stripe = stubStripe();
});

afterEach(() => {
  stripe?.restore();
  stripe = null;
});

describe('the checkout page', () => {
  it('shows the cart, the countries it can go to, and no form until one is chosen', async () => {
    const cookie = await cartWith(100);

    const html = await (await page('/checkout', cookie)).text();

    expect(html).toContain('HB-M8');
    expect(html).toContain('<option value="DE"');
    expect(html).toContain('<option value="FR"');
    expect(html).not.toContain('<option value="US"');
    expect(html).not.toContain('name="recipient"');
    // The goods, and nothing yet for shipping or a total.
    expect(html).toContain('$990.00');
    expect(html).not.toContain('checkout-total');
  });

  it('shows shipping and the total for the country chosen, and the form that carries it', async () => {
    const cookie = await cartWith(100);

    const html = await (await page('/checkout?country=DE', cookie)).text();

    expect(html).toContain('$49.00');
    expect(html).toContain('$1,039.00');
    expect(html).toContain('name="recipient"');
    expect(html).toContain('<input type="hidden" name="country" value="DE">');
    expect(html).toMatch(/<option value="DE" selected>/);
  });

  it('ships free once the goods pass the zone’s amount', async () => {
    const cookie = await cartWith(500);

    const html = await (await page('/checkout?country=FR', cookie)).text();

    expect(html).toContain('$4,950.00');
    expect(html).toContain('Free');
    expect(html).toContain('$4,950.00</span></dd></div>');
  });

  it('takes no country it does not ship to, whatever the address asks', async () => {
    const cookie = await cartWith(100);

    const html = await (await page('/checkout?country=US', cookie)).text();

    expect(html).not.toContain('name="recipient"');
    expect(html).not.toContain('checkout-total');
  });

  it('offers no payment until the shop’s Stripe keys are set', async () => {
    await setShopSecrets({ stripe_webhook_secret: null });
    const cookie = await cartWith(100);

    const html = await (await page('/checkout?country=DE', cookie)).text();

    expect(html).toContain('Online payment is not available');
    expect(html).not.toContain('name="recipient"');
  });

  it('asks for the terms when the shop names a page for them', async () => {
    await setShopSettings({ terms_path: '/terms' });
    const cookie = await cartWith(100);

    const html = await (await page('/checkout?country=DE', cookie)).text();

    expect(html).toContain('name="terms" value="yes" required');
    expect(html).toContain('href="/terms"');
  });

  it('says why the form placed no order, by kind and field alone', async () => {
    const cookie = await cartWith(100);

    const html = await (
      await page('/checkout?country=DE&checkout=invalid&field=city', cookie)
    ).text();

    expect(html).toContain('data-problem="checkout_invalid"');
    expect(html).toContain('Please check this field: City');
  });
});

describe('placing an order', () => {
  it('writes a pending order and sends the buyer to Stripe to pay for it', async () => {
    const cookie = await cartWith(100);

    const response = await place(cookie);

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      'https://checkout.stripe.com/c/pay/cs_test_1',
    );
    const [order] = await orders();
    expect(order).toMatchObject({
      status: 'pending',
      currency: 'USD',
      subtotal_minor: 99_000,
      shipping_minor: 4900,
      total_minor: 103_900,
      email: BUYER.email,
      company: BUYER.company,
      tax_id: BUYER.tax_id,
      shipping_zone: 'Europe',
      tax_mode: 'none',
      site_origin: ORIGIN,
      locale: 'en',
      stripe_session_id: 'cs_test_1',
    });
    expect(JSON.parse(order?.shipping_address ?? '{}')).toEqual({
      recipient: BUYER.recipient,
      line1: BUYER.line1,
      city: BUYER.city,
      postalCode: BUYER.postal_code,
      country: 'DE',
      phone: BUYER.phone,
    });
    // An hour to pay in.
    const lapses = Date.parse(order?.stripe_session_expires_at ?? '');
    expect(lapses - Date.now()).toBeGreaterThan(59 * 60 * 1000);
    expect(lapses - Date.now()).toBeLessThanOrEqual(60 * 60 * 1000);
    // Nothing is taken until the payment is in, and the cart stays.
    expect(await stockOf('hb-m8')).toBe(1000);
    const lines = await db()
      .prepare('SELECT COUNT(*) AS n FROM p_shop_cart_line')
      .first<{ n: number }>();
    expect(lines?.n).toBe(1);
  });

  it('asks Stripe for the order’s own amounts, line by line, and brings the buyer back to the order', async () => {
    const cookie = await cartWith(100);

    await place(cookie);

    const [call] = sessionCalls();
    const [order] = await orders();
    const body = call?.body ?? new URLSearchParams();
    expect(body.get('line_items[0][price_data][unit_amount]')).toBe('990');
    expect(body.get('line_items[0][quantity]')).toBe('100');
    expect(body.get('line_items[0][price_data][currency]')).toBe('usd');
    expect(
      body.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]'),
    ).toBe('4900');
    expect(body.get('customer_email')).toBe(BUYER.email);
    expect(body.get('metadata[order_id]')).toBe(order?.id);
    expect(body.get('payment_intent_data[metadata][order_id]')).toBe(order?.id);
    expect(body.get('locale')).toBe('en');
    expect(body.get('cancel_url')).toBe(`${ORIGIN}${SHOP}/checkout?country=DE`);
    const back = new URL(body.get('success_url') ?? '');
    expect(back.origin).toBe(ORIGIN);
    expect(back.pathname).toBe(`${SHOP}/order/${order?.order_no}`);
    // The link opens that order and no other.
    const key = await existingOrderLinkKey(db());
    expect(key).not.toBeNull();
    if (key !== null && order !== undefined) {
      expect(
        await tokenOpens(key, order.id, back.searchParams.get('k') ?? ''),
      ).toBe(true);
      expect(
        await tokenOpens(key, 'another', back.searchParams.get('k') ?? ''),
      ).toBe(false);
    }
  });

  it('pays in the cart’s language and its currency', async () => {
    const cookie = await cartWith(100, '/de');

    const response = await place(cookie, BUYER, '/de');

    expect(response.status).toBe(303);
    const [order] = await orders();
    expect(order).toMatchObject({
      currency: 'EUR',
      total_minor: 94_500,
      locale: 'de',
    });
    const body = sessionCalls()[0]?.body ?? new URLSearchParams();
    expect(body.get('locale')).toBe('de');
    expect(new URL(body.get('success_url') ?? '').pathname).toBe(
      `${SHOP}/de/order/${order?.order_no}`,
    );
  });

  it('has Stripe work tax out from the address the order ships to, when the shop asks it to', async () => {
    await setShopSettings({ tax_mode: 'stripe' });
    const cookie = await cartWith(100);

    expect((await place(cookie)).status).toBe(303);

    const [customer, session] = stripe?.calls ?? [];
    expect(customer?.path).toBe('/v1/customers');
    expect(customer?.body.get('shipping[address][country]')).toBe('DE');
    expect(customer?.body.get('shipping[address][postal_code]')).toBe('20457');
    expect(session?.body.get('automatic_tax[enabled]')).toBe('true');
    expect(session?.body.get('customer')).toBe('cus_test_1');
    expect((await orders())[0]?.tax_mode).toBe('stripe');
  });

  it('closes the session of an earlier order from the same cart before opening another', async () => {
    const cookie = await cartWith(100);
    await place(cookie);

    const again = await place(cookie);

    expect(again.headers.get('location')).toBe(
      'https://checkout.stripe.com/c/pay/cs_test_2',
    );
    expect(stripe?.calls.map((call) => call.path)).toEqual([
      '/v1/checkout/sessions',
      '/v1/checkout/sessions/cs_test_1/expire',
      '/v1/checkout/sessions',
    ]);
    const [first, second] = await orders();
    expect(first?.status).toBe('cancelled');
    expect(second?.status).toBe('pending');
    // Gave way, and the buyer is not written to about it.
    expect(
      (await outboxRows()).map((row) => [row.topic, row.order_id, row.ref]),
    ).toEqual([['order.cancelled', first?.id, 'replaced']]);
  });

  it('closes the order it wrote when Stripe opens no session, and says payments are unavailable', async () => {
    stripe?.restore();
    stripe = stubStripe({
      fail: (path) =>
        path === '/v1/checkout/sessions'
          ? { status: 500, body: { error: { type: 'api_error' } } }
          : null,
    });
    const cookie = await cartWith(100);

    const response = await place(cookie);

    expect(landing(response).searchParams.get('checkout')).toBe(
      'payments_unavailable',
    );
    expect(landing(response).searchParams.get('country')).toBe('DE');
    const [order] = await orders();
    expect(order?.status).toBe('cancelled');
    expect((await outboxRows()).map((row) => row.ref)).toEqual(['failed']);
  });

  it.each([
    ['an address that is not one', { email: 'not an address' }, 'email'],
    ['no company', { company: '   ' }, 'company'],
    ['no street', { line1: '' }, 'line1'],
    ['no country', { country: '' }, 'country'],
    ['a country that is not a code', { country: 'Germany' }, 'country'],
    ['a city too long', { city: 'x'.repeat(101) }, 'city'],
  ])(
    'refuses %s, naming the field, and writes nothing',
    async (_what, change, field) => {
      const cookie = await cartWith(100);

      const response = await place(cookie, { ...BUYER, ...change });

      expect(response.status).toBe(303);
      expect(landing(response).searchParams.get('checkout')).toBe('invalid');
      expect(landing(response).searchParams.get('field')).toBe(field);
      expect(await orders()).toEqual([]);
      expect(stripe?.calls).toEqual([]);
      // Nothing the buyer typed travels in the address.
      expect(response.headers.get('location')).not.toContain('ada');
    },
  );

  it('asks that the terms be accepted when the shop names them', async () => {
    await setShopSettings({ terms_path: '/terms' });
    const cookie = await cartWith(100);

    const without = await place(cookie);
    const accepted = await place(cookie, { ...BUYER, terms: 'yes' });

    expect(landing(without).searchParams.get('field')).toBe('terms');
    expect(accepted.status).toBe(303);
    expect(accepted.headers.get('location')).toMatch(
      /^https:\/\/checkout\.stripe\.com\//,
    );
    expect(await orders()).toHaveLength(1);
  });

  it('places nothing for whatever fills in the field no person sees', async () => {
    const cookie = await cartWith(100);

    const response = await place(cookie, {
      ...BUYER,
      website: 'https://spam.example',
    });

    expect(landing(response).pathname).toBe(`${SHOP}/checkout`);
    expect(landing(response).searchParams.get('checkout')).toBeNull();
    expect(await orders()).toEqual([]);
    expect(stripe?.calls).toEqual([]);
  });

  it('places nothing while the shop cannot take a payment', async () => {
    await setShopSecrets({ stripe_secret_key: null });
    const cookie = await cartWith(100);

    const response = await place(cookie);

    expect(landing(response).searchParams.get('checkout')).toBe(
      'payments_unavailable',
    );
    expect(await orders()).toEqual([]);
  });

  it('places nothing for an empty cart, or one with no cookie', async () => {
    const none = await place(undefined);

    expect(landing(none).searchParams.get('checkout')).toBe('empty');
    expect(await orders()).toEqual([]);
  });

  it('places nothing for a country it does not ship to', async () => {
    const cookie = await cartWith(100);

    const response = await place(cookie, { ...BUYER, country: 'US' });

    expect(landing(response).searchParams.get('checkout')).toBe('no_shipping');
    expect(await orders()).toEqual([]);
  });

  it('places nothing for a cart that cannot be ordered as it stands', async () => {
    const cookie = await cartWith(100);
    await db()
      .prepare("UPDATE p_shop_variant SET moq = 200 WHERE id = 'hb-m8'")
      .run();

    const response = await place(cookie);

    expect(landing(response).searchParams.get('checkout')).toBe('cart_problem');
    expect(await orders()).toEqual([]);
  });

  it('places nothing that comes to less than Stripe charges', async () => {
    await setPrice({
      variantId: 'hb-m8',
      currency: 'USD',
      amountMinor: 1,
      source: 'base',
    });
    await db()
      .prepare(
        "UPDATE p_shop_shipping_rate SET amount_minor = 0 WHERE currency = 'USD'",
      )
      .run();
    const cookie = await cartWith(10);

    const response = await place(cookie);

    expect(landing(response).searchParams.get('checkout')).toBe('too_small');
    expect(await orders()).toEqual([]);
  });

  it('places nothing that comes to more than one payment can carry', async () => {
    await setPrice({
      variantId: 'hb-m8',
      currency: 'USD',
      amountMinor: 200_000,
      source: 'base',
    });
    const cookie = await cartWith(500);

    const response = await place(cookie);

    expect(landing(response).searchParams.get('checkout')).toBe('too_large');
    expect(await orders()).toEqual([]);
  });

  it('places no new order while an earlier one from the cart is paid at Stripe and not yet confirmed here', async () => {
    const cookie = await cartWith(100);
    await place(cookie);
    stripe?.restore();
    stripe = stubStripe({
      fail: (path) =>
        path.endsWith('/expire')
          ? { status: 400, body: { error: { type: 'invalid_request_error' } } }
          : null,
      sessionStatus: () => 'complete',
    });

    const again = await place(cookie);

    expect(landing(again).searchParams.get('checkout')).toBe('paid_meanwhile');
    const [first, ...rest] = await orders();
    // Left to its payment, whose word is on its way.
    expect(first?.status).toBe('pending');
    expect(rest).toEqual([]);
    expect(await outboxRows()).toEqual([]);
  });

  it('closes again a session opened for an order another placement closed meanwhile', async () => {
    const cookie = await cartWith(100);
    stripe?.restore();
    stripe = stubStripe({
      // While this placement waits for its session, another one closes its
      // order, as the second tab of the same cart does.
      fail: async (path) => {
        if (path === '/v1/checkout/sessions') {
          await db()
            .prepare("UPDATE p_shop_order SET status = 'cancelled'")
            .run();
        }
        return null;
      },
    });

    const response = await place(cookie);

    expect(landing(response).searchParams.get('checkout')).toBe('in_progress');
    expect(stripe?.calls.map((call) => call.path)).toEqual([
      '/v1/checkout/sessions',
      '/v1/checkout/sessions/cs_test_1/expire',
    ]);
  });

  it('opens one order, and one payment page, when the same cart is placed twice at the same moment', async () => {
    const cookie = await cartWith(100);
    const gate = holdWrites((sql) =>
      sql.includes('INSERT INTO p_shop_order\n'),
    );
    try {
      const both = Promise.all([place(cookie), place(cookie)]);
      await gate.arrived(2);
      gate.open();
      const answers = await both;

      const kinds = answers
        .map((answer) =>
          answer.headers
            .get('location')
            ?.startsWith('https://checkout.stripe.com/')
            ? 'stripe'
            : landing(answer).searchParams.get('checkout'),
        )
        .sort();
      expect(kinds).toEqual(['in_progress', 'stripe']);
      const pending = (await orders()).filter(
        (order) => order.status === 'pending',
      );
      expect(pending).toHaveLength(1);
      expect(sessionCalls()).toHaveLength(1);
    } finally {
      gate.restore();
    }
  });

  it('lets one visitor place a few orders an hour, counted where the order is written', async () => {
    const cookie = await cartWith(100);
    for (let attempt = 0; attempt < MAX_CHECKOUTS_PER_HOUR; attempt += 1) {
      const response = await place(cookie, BUYER, '', '198.51.100.7');
      expect(response.headers.get('location')).toMatch(
        /^https:\/\/checkout\.stripe\.com\//,
      );
    }

    const over = await place(cookie, BUYER, '', '198.51.100.7');
    const another = await place(cookie, BUYER, '', '198.51.100.8');

    expect(landing(over).searchParams.get('checkout')).toBe('too_many');
    expect(another.headers.get('location')).toMatch(
      /^https:\/\/checkout\.stripe\.com\//,
    );
    expect(await orders()).toHaveLength(MAX_CHECKOUTS_PER_HOUR + 1);
  });

  it('sends the buyer back to the site’s own domain, whatever the request was addressed to', async () => {
    const settings = await api('PATCH', '/_mallok/api/settings', {
      domain: 'shop.example',
    });
    try {
      expect(settings.ok).toBe(true);
      const cookie = await cartWith(100);

      await place(cookie);

      const body = sessionCalls()[0]?.body ?? new URLSearchParams();
      expect(new URL(body.get('success_url') ?? '').origin).toBe(
        'https://shop.example',
      );
      expect(body.get('cancel_url')).toMatch(/^https:\/\/shop\.example\//);
      expect((await orders())[0]?.site_origin).toBe('https://shop.example');
    } finally {
      await api('PATCH', '/_mallok/api/settings', { domain: null });
    }
  });
});
