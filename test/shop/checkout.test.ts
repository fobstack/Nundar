import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CartFacts } from '../../src/plugins/shop/lib/cart-pricing.js';
import {
  CHECKOUT_LIMITS,
  checkoutFormSchema,
  firstInvalidCheckoutField,
  quoteOf,
  readCheckout,
  stripeKeys,
  taxModeOf,
  termsPathOf,
} from '../../src/plugins/shop/lib/checkout.js';
import {
  existingOrderLinkKey,
  isOrderToken,
  orderLinkKey,
  orderToken,
  tokenOpens,
} from '../../src/plugins/shop/lib/order-access.js';
import type { ShippingRate } from '../../src/plugins/shop/lib/shipping.js';
import {
  checkStripeSecretKey,
  checkStripeWebhookSecret,
} from '../../src/plugins/shop/lib/stripe-check.js';
import {
  clearShopTables,
  createProduct,
  createShippingZone,
  createVariant,
  db,
  ensureSite,
  setPrice,
  type TestProduct,
} from './helpers.js';

const NOW = new Date('2026-10-31T08:00:00.000Z');

function facts(
  lines: { unitPriceMinor: number | null; quantity: number; issue?: boolean }[],
  currency: 'USD' | 'EUR' | 'GBP' = 'USD',
): CartFacts {
  return {
    currency,
    currencies: [currency],
    lines: lines.map((line, index) => ({
      variantId: `v${index}`,
      quantity: line.quantity,
      sku: `SKU-${index}`,
      name: 'Part',
      path: '/products/part',
      moq: 1,
      unitPriceMinor: line.unitPriceMinor,
      issue:
        line.issue === true
          ? { kind: 'unavailable' as const, variantId: `v${index}` }
          : null,
    })),
  };
}

const RATE: ShippingRate = {
  zoneId: 'z',
  zoneName: 'Europe',
  currency: 'USD',
  amountMinor: 4900,
  freeOverMinor: 100_000,
};

describe('what a cart comes to, shipped', () => {
  it('is the goods and the zone’s rate', () => {
    expect(
      quoteOf(facts([{ unitPriceMinor: 990, quantity: 10 }]), RATE),
    ).toEqual({
      quote: { goodsMinor: 9900, shippingMinor: 4900, totalMinor: 14_800 },
      problem: null,
    });
  });

  it('ships free once the goods alone reach the zone’s amount', () => {
    const at = quoteOf(facts([{ unitPriceMinor: 10_000, quantity: 10 }]), RATE);
    const below = quoteOf(
      facts([{ unitPriceMinor: 9999, quantity: 10 }]),
      RATE,
    );

    expect(at.quote?.shippingMinor).toBe(0);
    expect(below.quote?.shippingMinor).toBe(4900);
  });

  it('says why a cart cannot be checked out, in the order a buyer would put it right', () => {
    expect(quoteOf(facts([]), RATE).problem).toBe('empty');
    expect(
      quoteOf(facts([{ unitPriceMinor: 990, quantity: 1, issue: true }]), RATE)
        .problem,
    ).toBe('cart_problem');
    expect(
      quoteOf(facts([{ unitPriceMinor: 990, quantity: 1 }]), null).problem,
    ).toBe('no_shipping');
    // A rate in another currency is no rate for this cart.
    expect(
      quoteOf(facts([{ unitPriceMinor: 990, quantity: 1 }], 'EUR'), RATE)
        .problem,
    ).toBe('no_shipping');
  });

  it('refuses less than Stripe charges, a total of nothing included, and more than one payment carries', () => {
    const free = { ...RATE, amountMinor: 0 };

    expect(
      quoteOf(facts([{ unitPriceMinor: 0, quantity: 1 }]), free).problem,
    ).toBe('too_small');
    expect(
      quoteOf(facts([{ unitPriceMinor: 49, quantity: 1 }]), free).problem,
    ).toBe('too_small');
    expect(
      quoteOf(facts([{ unitPriceMinor: 50, quantity: 1 }]), free).problem,
    ).toBeNull();
    expect(
      quoteOf(facts([{ unitPriceMinor: 30, quantity: 1 }], 'GBP'), {
        ...free,
        currency: 'GBP',
      }).problem,
    ).toBeNull();
    expect(
      quoteOf(facts([{ unitPriceMinor: 99_999_999, quantity: 1 }]), free)
        .problem,
    ).toBeNull();
    expect(
      quoteOf(facts([{ unitPriceMinor: 100_000_000, quantity: 1 }]), free)
        .problem,
    ).toBe('too_large');
  });
});

describe('the checkout form', () => {
  const VALID = {
    email: 'ada@buyer.example',
    company: 'Analytical Engines Ltd',
    recipient: 'Ada Lovelace',
    line1: 'Hafenstraße 1',
    city: 'Hamburg',
    country: 'DE',
  };

  it('takes a business with an address, and makes each line one line', () => {
    const parsed = checkoutFormSchema.parse({
      ...VALID,
      company: '  Analytical\tEngines  Ltd ',
    });

    expect(parsed.company).toBe('Analytical Engines Ltd');
    expect(parsed.postal_code).toBe('');
    expect(parsed.terms).toBe('');
  });

  it('names the first field it refuses, in the page’s order', () => {
    const result = checkoutFormSchema.safeParse({
      ...VALID,
      city: '',
      email: 'nope',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(firstInvalidCheckoutField(result.error)).toBe('email');
    }
  });

  it('holds every field to the length the page carries', () => {
    for (const [field, max] of Object.entries(CHECKOUT_LIMITS)) {
      if (field === 'email') {
        continue;
      }
      const at = checkoutFormSchema.safeParse({
        ...VALID,
        [field]: 'x'.repeat(max),
      });
      const over = checkoutFormSchema.safeParse({
        ...VALID,
        [field]: 'x'.repeat(max + 1),
      });
      expect(at.success, field).toBe(true);
      expect(over.success, field).toBe(false);
    }
  });

  it('takes only a two-letter country code', () => {
    for (const country of ['de', 'DEU', 'Germany', '']) {
      expect(
        checkoutFormSchema.safeParse({ ...VALID, country }).success,
        country,
      ).toBe(false);
    }
  });
});

describe('the settings checkout reads', () => {
  it('takes payments only with both of Stripe’s keys', () => {
    expect(stripeKeys({})).toBeNull();
    expect(stripeKeys({ stripe_secret_key: 'sk_test_1' })).toBeNull();
    expect(stripeKeys({ stripe_webhook_secret: 'whsec_1' })).toBeNull();
    expect(
      stripeKeys({
        stripe_secret_key: 'sk_test_1',
        stripe_webhook_secret: 'whsec_1',
      }),
    ).toEqual({ secretKey: 'sk_test_1', webhookSecret: 'whsec_1' });
  });

  it('charges no tax unless told Stripe is to', () => {
    expect(taxModeOf({})).toBe('none');
    expect(taxModeOf({ tax_mode: 'stripe' })).toBe('stripe');
    expect(taxModeOf({ tax_mode: 'something else' })).toBe('none');
  });

  it('links to a terms page only on this site', () => {
    expect(termsPathOf({ terms_path: ' /terms ' })).toBe('/terms');
    expect(termsPathOf({ terms_path: '/de/agb' })).toBe('/de/agb');
    for (const value of [
      'https://elsewhere.example/terms',
      '//elsewhere.example',
      '/\\elsewhere.example',
      'terms',
      '/a b',
      7,
    ]) {
      expect(termsPathOf({ terms_path: value }), String(value)).toBe('');
    }
  });
});

describe('a buyer’s link to their order', () => {
  beforeAll(ensureSite);
  beforeEach(clearShopTables);

  it('opens its own order and no other', async () => {
    const key = await orderLinkKey(db(), NOW);
    const token = await orderToken(key, 'order-1');

    expect(isOrderToken(token)).toBe(true);
    expect(await tokenOpens(key, 'order-1', token)).toBe(true);
    expect(await tokenOpens(key, 'order-2', token)).toBe(false);
    expect(await tokenOpens(key, 'order-1', `${token.slice(0, 42)}A`)).toBe(
      token.endsWith('A'),
    );
    expect(await tokenOpens(key, 'order-1', '')).toBe(false);
  });

  it('is signed with one key, made once, whoever asks for it first', async () => {
    expect(await existingOrderLinkKey(db())).toBeNull();

    const [first, second] = await Promise.all([
      orderLinkKey(db(), NOW),
      orderLinkKey(db(), NOW),
    ]);
    const read = await existingOrderLinkKey(db());

    const tokens = await Promise.all(
      [first, second, read].map((key) =>
        key === null ? '' : orderToken(key, 'order-1'),
      ),
    );
    expect(new Set(tokens).size).toBe(1);
    const stored = await db()
      .prepare(
        "SELECT COUNT(*) AS n FROM p_shop_state WHERE key = 'order_link_key'",
      )
      .first<{ n: number }>();
    expect(stored?.n).toBe(1);
  });

  it('stops opening anything once the key is gone, as after a site is restored from an export', async () => {
    const key = await orderLinkKey(db(), NOW);
    const token = await orderToken(key, 'order-1');
    await db().prepare('DELETE FROM p_shop_state').run();

    const fresh = await orderLinkKey(db(), NOW);

    expect(await tokenOpens(fresh, 'order-1', token)).toBe(false);
  });
});

describe('reading a cart for checkout', () => {
  let bolt: TestProduct;

  beforeAll(async () => {
    await ensureSite();
    bolt = await createProduct({
      title: 'Hex bolt M8',
      slug: 'reading-checkout-bolt',
    });
  });

  beforeEach(async () => {
    await clearShopTables();
    await createVariant({
      id: 'hb-m8',
      productGroup: bolt.translationGroup,
      sku: 'HB-M8',
      moq: 1,
      stock: 100,
    });
    await setPrice({
      variantId: 'hb-m8',
      currency: 'EUR',
      amountMinor: 900,
      source: 'base',
    });
    await createShippingZone({
      name: 'Europe',
      countries: ['DE', 'FR', 'AT'],
      rates: [{ currency: 'EUR', amountMinor: 4500 }],
    });
    await createShippingZone({
      name: 'United Kingdom',
      countries: ['GB'],
      rates: [{ currency: 'GBP', amountMinor: 2500 }],
    });
  });

  it('lists the countries the cart can go to in its currency, by name in the page’s language', async () => {
    const reading = await readCheckout(db(), {
      lines: [{ variantId: 'hb-m8', quantity: 10 }],
      locale: 'de',
      defaultLocale: 'en',
      currency: 'EUR',
      country: null,
    });

    expect(reading.countries).toEqual([
      { code: 'DE', name: 'Deutschland' },
      { code: 'FR', name: 'Frankreich' },
      { code: 'AT', name: 'Österreich' },
    ]);
    expect(reading.country).toBeNull();
    expect(reading.problem).toBe('no_shipping');
  });

  it('takes a country it can ship to, and quotes for it', async () => {
    const reading = await readCheckout(db(), {
      lines: [{ variantId: 'hb-m8', quantity: 10 }],
      locale: 'en',
      defaultLocale: 'en',
      currency: 'EUR',
      country: 'FR',
    });

    expect(reading.country).toBe('FR');
    expect(reading.rate?.zoneName).toBe('Europe');
    expect(reading.quote).toEqual({
      goodsMinor: 9000,
      shippingMinor: 4500,
      totalMinor: 13_500,
    });
    expect(reading.problem).toBeNull();
  });

  it('takes no country whose zone has no rate in the cart’s currency', async () => {
    const reading = await readCheckout(db(), {
      lines: [{ variantId: 'hb-m8', quantity: 10 }],
      locale: 'en',
      defaultLocale: 'en',
      currency: 'EUR',
      country: 'GB',
    });

    expect(reading.country).toBeNull();
    expect(reading.countries.map((entry) => entry.code)).not.toContain('GB');
    expect(reading.problem).toBe('no_shipping');
  });
});

describe('the Stripe keys’ checks', () => {
  function answering(status: number): typeof fetch {
    return (async () =>
      new Response('{}', { status })) as unknown as typeof fetch;
  }

  it('tries the secret key on a read, and says which mode it is in', async () => {
    expect(
      await checkStripeSecretKey(
        { secrets: { stripe_secret_key: 'sk_test_abc' } },
        answering(200),
      ),
    ).toEqual({ ok: true, message: 'Stripe accepts this key (test mode).' });
    expect(
      await checkStripeSecretKey(
        { secrets: { stripe_secret_key: 'sk_live_abc' } },
        answering(401),
      ),
    ).toEqual({ ok: false, message: 'Stripe does not accept this key.' });
    expect(
      (
        await checkStripeSecretKey(
          { secrets: { stripe_secret_key: 'rk_live_abc' } },
          answering(403),
        )
      ).message,
    ).toMatch(/restricted key \(live mode\)/);
  });

  it('asks Stripe nothing about a key that is not a secret key', async () => {
    let asked = false;
    const spy = (async () => {
      asked = true;
      return new Response('{}');
    }) as unknown as typeof fetch;

    const verdict = await checkStripeSecretKey(
      { secrets: { stripe_secret_key: 'pk_test_abc' } },
      spy,
    );

    expect(verdict.ok).toBe(false);
    expect(asked).toBe(false);
    expect((await checkStripeSecretKey({ secrets: {} }, spy)).message).toBe(
      'Not set.',
    );
  });

  it('checks the signing secret’s shape, which is all that can be checked of it', async () => {
    expect(
      (
        await checkStripeWebhookSecret({
          secrets: { stripe_webhook_secret: 'whsec_abc' },
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await checkStripeWebhookSecret({
          secrets: { stripe_webhook_secret: 'sk_test_abc' },
        })
      ).ok,
    ).toBe(false);
  });
});
