import { SELF } from 'cloudflare:test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import commerce from '../../src/theme/theme.json';
import editorial from '../../src/theme-editorial/theme.json';
import {
  api,
  db,
  ensureSite,
  ORIGIN,
  type StripeCall,
  setShopSecrets,
  stubStripe,
} from '../shop/helpers.js';

/**
 * The editorial theme, with the real sample: every page of the catalogue,
 * and every page of the shop, drawn from the same content, options and
 * plugin views the commerce theme draws — and whole in each.
 */

const SHOP = '/_mallok/p/shop';

function between(page: string, start: string, end: string): string {
  const from = page.indexOf(start);
  const to = page.indexOf(end, from + start.length);
  return from === -1 ? '' : page.slice(from, to === -1 ? undefined : to);
}

function emptyElements(page: string): string[] {
  return [
    ...page.matchAll(
      /<(div|p|aside|section|nav|dl|ul|li|h1|h2|h3|dd|dt|th|td|span|label|table|tbody)\b[^>]*>\s*<\/\1>/g,
    ),
  ].map((match) => match[0]);
}

async function get(path: string, cookie?: string) {
  const response = await SELF.fetch(`${ORIGIN}${path}`, {
    headers: cookie === undefined ? {} : { cookie },
    redirect: 'manual',
  });
  return { status: response.status, html: await response.text() };
}

/** What every page drawn by this theme must be. */
function expectWhole(path: string, html: string): void {
  const main = between(html, '<main', '</main>');
  expect(emptyElements(main), path).toEqual([]);
  expect(emptyElements(between(html, '<footer', '</footer>')), path).toEqual(
    [],
  );
  expect(html, path).not.toMatch(/href=""/);
  expect([...main.matchAll(/<h1\b/g)], path).toHaveLength(1);
  // No script and no file of its own: the styles are in the page.
  expect(html, path).not.toMatch(/<script\b(?![^>]*application\/ld\+json)/);
  expect(html, path).toContain('<style>');
  expect(html, path).not.toContain('/theme/');
}

let paths: string[] = [];

/**
 * Every status an order's page can show, with what changes beside it: a
 * carrier and a tracking number once it ships, tax when Stripe added it, a
 * buyer who gave no company and no tax number.
 */
const ORDER_STATES: readonly (readonly [
  string,
  {
    status: string;
    carrier?: string;
    trackingNo?: string;
    company?: string;
    taxId?: string;
    taxMinor?: number;
  },
  readonly string[],
])[] = [
  ['paid', { status: 'paid' }, ['Analytical Engines Ltd', 'DE123456789']],
  [
    'shipped',
    { status: 'shipped', carrier: 'DHL', trackingNo: 'JD014600003828' },
    ['DHL', 'JD014600003828'],
  ],
  [
    'delivered',
    { status: 'delivered', carrier: 'UPS', trackingNo: '1Z999' },
    ['UPS'],
  ],
  ['refunded', { status: 'refunded' }, []],
  ['cancelled', { status: 'cancelled' }, []],
  ['oversold', { status: 'oversold' }, []],
  [
    'paid with tax, for a buyer who gave no company or tax number',
    { status: 'paid', company: '', taxId: '', taxMinor: 3515 },
    ['$35.15'],
  ],
];

/**
 * Importing the sample and walking every page of it take several seconds,
 * longer still beside the rest of the suite: past vitest's default of five.
 */
const WHOLE_SAMPLE_MS = 60_000;

beforeAll(async () => {
  await ensureSite();
  const response = await api('POST', '/_mallok/api/setup/starter', {
    starter: 'nundar-sample-editorial',
  });
  const answer = (await response.json()) as Record<string, unknown>;
  expect(answer.failed).toEqual([]);
  expect(answer.failedRecords).toEqual([]);
  const { results } = await db()
    .prepare(
      "SELECT path FROM content WHERE status = 'published' ORDER BY path",
    )
    .all<{ path: string }>();
  paths = results.map((row) => row.path);
}, WHOLE_SAMPLE_MS);

describe('the editorial theme', () => {
  it('reads the same content model, options and shop pages as the commerce theme', () => {
    expect(editorial.kinds).toEqual(commerce.kinds);
    expect(editorial.options).toEqual(commerce.options);
    expect(editorial.pluginLayouts).toEqual(commerce.pluginLayouts);
    expect(editorial.locales).toEqual(commerce.locales);
    expect(editorial.id).not.toBe(commerce.id);
  });

  it(
    'draws every page of the sample whole',
    async () => {
      expect(paths.length).toBeGreaterThan(100);
      for (const path of paths) {
        const page = await get(path);
        expect(page.status, path).toBe(200);
        expectWhole(path, page.html);
        // Mallok's own head, kept by the theme: the canonical and every
        // language's alternate (a product's structured data is checked below).
        // The language links carry `hreflang` too, so the alternate is asked
        // for as a `<link>`.
        expect(page.html, path).toContain('<link rel="canonical" href="');
        expect(page.html, path).toContain(
          '<link rel="alternate" hreflang="x-default"',
        );
      }
    },
    WHOLE_SAMPLE_MS,
  );

  it(
    'draws the home page and every list, in every language',
    async () => {
      const lists = Object.values(commerce.kinds)
        .filter((kind) => 'listLayout' in kind && 'base' in kind)
        .map((kind) => `/${(kind as { base: string }).base}`);
      for (const prefix of ['', '/de', '/fr', '/es']) {
        for (const path of [
          `${prefix}/`,
          ...lists.map((list) => `${prefix}${list}`),
        ]) {
          const page = await get(path);
          expect(page.status, path).toBe(200);
          expectWhole(path, page.html);
        }
      }
    },
    WHOLE_SAMPLE_MS,
  );

  it('prints each size’s price and offers it to the cart, in the page’s language', async () => {
    const english = await get('/products/titanium-socket-head-cap-screw-m5');
    const german = await get(
      '/de/products/titan-zylinderschraube-innensechskant-m5',
    );

    expect(english.html).toContain('TI-SHC-M5-10');
    expect(english.html).toContain('$1.85');
    expect(english.html).toContain(
      `<form class="buy" method="post" action="${SHOP}/cart/update">`,
    );
    expect(german.html).toContain('1,75');
    expect(german.html).toContain(`action="${SHOP}/de/cart/update"`);
    expect(german.html).toContain('In den Warenkorb');
    // The structured data offers what the page prints, in its currency.
    expect(english.html).toMatch(/"priceCurrency":"USD"/);
    expect(german.html).toMatch(/"priceCurrency":"EUR"/);
  });

  it('names each value of a wide table, which a phone draws a row at a time', async () => {
    const product = await get(
      '/de/products/titan-zylinderschraube-innensechskant-m5',
    );
    const catalogue = await get('/de/products');

    // Below 40rem a row's values are printed under their column's name,
    // taken from `data-label`; the roles keep the table a table to a screen
    // reader once its display is changed.
    const sizes = between(
      product.html,
      '<table class="ledger stack"',
      '</table>',
    );
    expect(sizes).toContain('role="table"');
    expect(sizes.match(/<tr role="row">/g)).toHaveLength(5);
    for (const label of ['Stückpreis', 'Mindestmenge', 'Verfügbarkeit']) {
      expect(
        sizes.match(new RegExp(`<td role="cell" data-label="${label}">`, 'g')),
      ).toHaveLength(4);
    }
    expect(catalogue.html).toContain(
      '<table class="ledger stack" role="table">',
    );
    expect(catalogue.html).toContain('<td role="cell" data-label="Größen">');
    expect(product.html).toContain(
      '.stack td[data-label]::before { content: attr(data-label);',
    );
  });
});

describe('the editorial theme’s shop pages', () => {
  let stripe: { calls: StripeCall[]; restore: () => void } | null = null;
  let cookie = '';

  beforeAll(async () => {
    await setShopSecrets({
      stripe_secret_key: 'sk_test_editorial',
      stripe_webhook_secret: 'whsec_editorial',
    });
    stripe = stubStripe();
    const added = await SELF.fetch(`${ORIGIN}${SHOP}/cart/update`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        variant:
          (
            await db()
              .prepare(
                "SELECT id FROM p_shop_variant WHERE sku = 'TI-SHC-M5-10'",
              )
              .first<{ id: string }>()
          )?.id ?? '',
        quantity: '100',
      }).toString(),
      redirect: 'manual',
    });
    cookie = added.headers.get('set-cookie')?.split(';')[0] ?? '';
  });

  afterAll(() => {
    stripe?.restore();
  });

  it('draws the cart, empty and full, with its forms and the way to checkout', async () => {
    const empty = await get(`${SHOP}/cart`);
    const full = await get(`${SHOP}/cart`, cookie);

    expectWhole('empty cart', empty.html);
    expectWhole('cart', full.html);
    expect(full.html).toContain('TI-SHC-M5-10');
    expect(full.html).toContain('$185.00');
    expect(full.html).toContain(`href="${SHOP}/checkout"`);
    expect(full.html).toContain(`action="${SHOP}/cart/inquiry"`);
  });

  it('draws checkout, before and after a country is chosen, with the server’s rules on its fields', async () => {
    const before = await get(`${SHOP}/checkout`, cookie);
    const after = await get(`${SHOP}/checkout?country=DE`, cookie);

    expectWhole('checkout', before.html);
    expectWhole('checkout DE', after.html);
    expect(after.html).toContain('$29.00');
    expect(after.html).toContain('$214.00');
    expect(after.html).toContain(
      '<input type="hidden" name="country" value="DE">',
    );
    expect(after.html).toMatch(
      /name="company" required pattern="[^"]+" maxlength="200"/,
    );
  });

  it('draws an order’s page and the page a buyer finds their orders on', async () => {
    await SELF.fetch(`${ORIGIN}${SHOP}/checkout/place`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      body: new URLSearchParams({
        email: 'ada@buyer.example',
        company: 'Analytical Engines Ltd',
        recipient: 'Ada Lovelace',
        line1: 'Hafenstraße 1',
        city: 'Hamburg',
        country: 'DE',
      }).toString(),
      redirect: 'manual',
    });
    const session = stripe?.calls.find(
      (call) => call.path === '/v1/checkout/sessions',
    );
    const link = new URL(session?.body.get('success_url') ?? `${ORIGIN}/`);
    const order = await get(`${link.pathname}${link.search}`);
    const missing = await get(
      `${SHOP}/order/ND-261031-AAAAAAAA?k=${'A'.repeat(43)}`,
    );
    const lookup = await get(`${SHOP}/orders`);

    expectWhole('order', order.html);
    expect(order.html).toContain('Waiting for the payment to be confirmed');
    expectWhole('no order', missing.html);
    expectWhole('orders', lookup.html);
    expect(lookup.html).toContain(`action="${SHOP}/orders/link"`);
  });

  it.each(ORDER_STATES)(
    'draws an order whole when it is %s',
    async (_what, change, words) => {
      const placed = await SELF.fetch(`${ORIGIN}${SHOP}/checkout/place`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          cookie,
        },
        body: new URLSearchParams({
          email: 'ada@buyer.example',
          company: 'Analytical Engines Ltd',
          tax_id: 'DE123456789',
          recipient: 'Ada Lovelace',
          line1: 'Hafenstraße 1',
          city: 'Hamburg',
          country: 'DE',
        }).toString(),
        redirect: 'manual',
      });
      expect(placed.status).toBe(303);
      const session = stripe?.calls
        .filter((call) => call.path === '/v1/checkout/sessions')
        .at(-1);
      const link = new URL(session?.body.get('success_url') ?? `${ORIGIN}/`);
      const orderNo = decodeURIComponent(link.pathname.split('/').at(-1) ?? '');
      await db()
        .prepare(
          `UPDATE p_shop_order
           SET status = ?, carrier = ?, tracking_no = ?, company = ?,
               tax_id = ?, tax_minor = ?, total_minor = total_minor + ?
           WHERE order_no = ?`,
        )
        .bind(
          change.status,
          change.carrier ?? null,
          change.trackingNo ?? null,
          change.company ?? 'Analytical Engines Ltd',
          change.taxId ?? 'DE123456789',
          change.taxMinor ?? 0,
          change.taxMinor ?? 0,
          orderNo,
        )
        .run();

      const order = await get(`${link.pathname}${link.search}`);

      expect(order.status).toBe(200);
      expectWhole(`order ${change.status}`, order.html);
      for (const word of words) {
        expect(order.html).toContain(word);
      }
    },
  );
});
