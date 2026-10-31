import { SELF } from 'cloudflare:test';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CHECKOUT_LIMITS } from '../../src/plugins/shop/lib/checkout.js';
import {
  EMAIL_PATTERN_SOURCE,
  NAME_PATTERN_SOURCE,
} from '../../src/plugins/shop/lib/inquiries.js';
import {
  clearShopTables,
  createProduct,
  createShippingZone,
  createVariant,
  ensureSite,
  ORIGIN,
  type StripeCall,
  setPrice,
  setShopSecrets,
  setShopSettings,
  stubStripe,
  type TestProduct,
} from '../shop/helpers.js';

/**
 * The checkout page and an order's page, as the theme draws them from what
 * the plugin hands it: whole in every state they can be in, each field
 * carrying the server's own rule, and words in every language.
 */

const SHOP = '/_mallok/p/shop';

let bolt: TestProduct;
let stripe: { calls: StripeCall[]; restore: () => void } | null = null;

function post(
  path: string,
  fields: Record<string, string>,
  cookie?: string,
): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${SHOP}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(cookie === undefined ? {} : { cookie }),
    },
    body: new URLSearchParams(fields).toString(),
    redirect: 'manual',
  });
}

async function html(path: string, cookie?: string): Promise<string> {
  const response = await SELF.fetch(`${ORIGIN}${path}`, {
    headers: cookie === undefined ? {} : { cookie },
  });
  return response.text();
}

async function cart(quantity = 100, locale = ''): Promise<string> {
  const response = await post(`${locale}/cart/update`, {
    variant: 'hb-m8',
    quantity: String(quantity),
  });
  return response.headers.get('set-cookie')?.split(';')[0] ?? '';
}

function between(page: string, start: string, end: string): string {
  const from = page.indexOf(start);
  const to = page.indexOf(end, from + start.length);
  return from === -1 ? '' : page.slice(from, to === -1 ? undefined : to);
}

function emptyElements(page: string): string[] {
  return [
    ...page.matchAll(
      /<(div|p|aside|section|nav|dl|ul|li|h1|h2|h3|dd|dt|span|label|figure|table|tbody)\b[^>]*>\s*<\/\1>/g,
    ),
  ].map((match) => match[0]);
}

/** The attributes of the order form's field `name`. */
function field(page: string, name: string): Record<string, string> {
  const tag =
    new RegExp(`<input[^>]*name="${name}"[^>]*>`).exec(page)?.[0] ?? '';
  return Object.fromEntries(
    [...tag.matchAll(/([a-z-]+)(?:="([^"]*)")?/g)].map((match) => [
      match[1] ?? '',
      (match[2] ?? '')
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&'),
    ]),
  );
}

beforeAll(async () => {
  await ensureSite();
  bolt = await createProduct({
    title: 'Hex bolt M8',
    slug: 'theme-checkout-bolt',
  });
});

beforeEach(async () => {
  await clearShopTables();
  await setShopSecrets({
    stripe_secret_key: 'sk_test_theme',
    stripe_webhook_secret: 'whsec_theme',
  });
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

describe('the cart page', () => {
  it('offers checkout once every line can be ordered and the shop takes payments', async () => {
    const cookie = await cart();

    expect(await html(`${SHOP}/cart`, cookie)).toContain(
      `<a class="btn btn-solid" href="${SHOP}/checkout">Check out</a>`,
    );
  });

  it('offers none while the shop cannot take a payment', async () => {
    await setShopSecrets({ stripe_secret_key: null });
    const cookie = await cart();

    expect(await html(`${SHOP}/cart`, cookie)).not.toContain(
      `${SHOP}/checkout`,
    );
  });
});

describe('the checkout page', () => {
  it('carries the server’s rule on every field of the order form', async () => {
    const cookie = await cart();
    const page = await html(`${SHOP}/checkout?country=DE`, cookie);

    for (const name of ['company', 'recipient', 'line1', 'city']) {
      expect(field(page, name), name).toMatchObject({
        required: '',
        pattern: NAME_PATTERN_SOURCE,
        maxlength: String(
          CHECKOUT_LIMITS[name as keyof typeof CHECKOUT_LIMITS],
        ),
      });
    }
    expect(field(page, 'email')).toMatchObject({
      type: 'email',
      required: '',
      pattern: EMAIL_PATTERN_SOURCE,
      maxlength: String(CHECKOUT_LIMITS.email),
    });
    for (const name of ['phone', 'line2', 'postal_code', 'state', 'tax_id']) {
      const attributes = field(page, name);
      expect(attributes.maxlength, name).toBe(
        String(CHECKOUT_LIMITS[name as keyof typeof CHECKOUT_LIMITS]),
      );
      expect('required' in attributes, name).toBe(false);
    }
    // The pattern a browser applies is the one the server compiles.
    const pattern = new RegExp(`^(?:${field(page, 'email').pattern})$`, 'v');
    expect(pattern.test('ada@buyer.example')).toBe(true);
    expect(pattern.test('ada@buyer')).toBe(false);
  });

  it('hides the field no person may fill in from people and from the keyboard', async () => {
    const cookie = await cart();
    const page = await html(`${SHOP}/checkout?country=DE`, cookie);

    expect(page).toMatch(
      /<p class="quote-form-trap" aria-hidden="true"><label>[^<]+<input type="text" name="website" tabindex="-1" autocomplete="off"><\/label><\/p>/,
    );
  });

  it.each([
    ['before a country is chosen', '', true],
    ['with a country', '?country=DE', true],
    ['after a refusal', '?country=DE&checkout=invalid&field=line1', true],
    ['with an empty cart', '', false],
  ])(
    'is whole %s: no empty box, no link to nowhere, one heading',
    async (_what, query, filled) => {
      const cookie = filled ? await cart() : undefined;
      const page = await html(`${SHOP}/checkout${query}`, cookie);
      const main = between(page, '<main', '</main>');

      expect(emptyElements(main)).toEqual([]);
      expect(page).not.toMatch(/href=""/);
      expect([...main.matchAll(/<h1\b/g)]).toHaveLength(1);
    },
  );

  it('is whole when the shop cannot take payments, and says so', async () => {
    await setShopSecrets({ stripe_secret_key: null });
    const cookie = await cart();
    const page = await html(`${SHOP}/checkout?country=DE`, cookie);

    expect(emptyElements(between(page, '<main', '</main>'))).toEqual([]);
    expect(page).toContain('Online payment is not available at the moment.');
  });

  it('says that tax is added at payment when Stripe calculates it', async () => {
    await setShopSettings({ tax_mode: 'stripe' });
    const cookie = await cart();

    expect(await html(`${SHOP}/checkout?country=DE`, cookie)).toContain(
      'Tax, where it applies, is added on the payment page.',
    );
  });

  it.each([
    ['/de', 'Lieferung nach', 'Weiter zur Zahlung', '945,00'],
    ['/fr', 'Livrer en', 'Passer au paiement', '945,00'],
    ['/es', 'Enviar a', 'Continuar al pago', '945,00'],
  ])('speaks %s', async (locale, shipTo, pay, total) => {
    const cookie = await cart(100, locale);
    const page = await html(`${SHOP}${locale}/checkout?country=DE`, cookie);

    expect(page).toContain(shipTo);
    expect(page).toContain(pay);
    expect(page).toContain(total);
    expect(page).not.toContain('Continue to payment');
  });
});

describe('an order’s page', () => {
  async function placed(): Promise<string> {
    const cookie = await cart();
    await post(
      '/checkout/place',
      {
        email: 'ada@buyer.example',
        company: 'Analytical Engines Ltd',
        recipient: 'Ada Lovelace',
        line1: 'Hafenstraße 1',
        city: 'Hamburg',
        country: 'DE',
      },
      cookie,
    );
    const session = stripe?.calls.find(
      (call) => call.path === '/v1/checkout/sessions',
    );
    return session?.body.get('success_url') ?? '';
  }

  it('is whole for an order, and for a link that opens none', async () => {
    const link = await placed();
    const found = await (await SELF.fetch(link)).text();
    const missing = await html(
      `${SHOP}/order/ND-261031-AAAAAAAA?k=${'A'.repeat(43)}`,
    );

    for (const page of [found, missing]) {
      const main = between(page, '<main', '</main>');
      expect(emptyElements(main)).toEqual([]);
      expect(page).not.toMatch(/href=""/);
      expect([...main.matchAll(/<h1\b/g)]).toHaveLength(1);
    }
    expect(found).toContain('Shipping to');
    expect(missing).toContain('This order cannot be shown.');
  });
});
