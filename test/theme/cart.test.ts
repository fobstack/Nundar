import { SELF } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  EMAIL_PATTERN_SOURCE,
  INQUIRY_LIMITS,
  NAME_PATTERN_SOURCE,
} from '../../src/plugins/shop/lib/inquiries.js';
import {
  countD1Calls,
  createContent,
  createVariant,
  db,
  ensureSite,
  ORIGIN,
  setPrice,
  type TestContent,
} from '../shop/helpers.js';

/**
 * From a product page to the cart, with no script.
 *
 * A size on a product page is a form; the cart is a page of the site, drawn
 * by the theme from what the shop plugin says is in it. Everything here goes
 * through the real Worker the way a browser would: a page is requested, its
 * form is posted with the fields the page gave it, the redirect is followed
 * with the cookie that came back.
 */

const SHOP = '/_mallok/p/shop';

interface Page {
  readonly status: number;
  readonly html: string;
  readonly headers: Headers;
}

async function get(path: string, cookie?: string): Promise<Page> {
  const response = await SELF.fetch(`${ORIGIN}${path}`, {
    headers: cookie === undefined ? {} : { cookie },
  });
  return {
    status: response.status,
    html: await response.text(),
    headers: response.headers,
  };
}

function between(html: string, start: string, end: string): string {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from + start.length);
  return from === -1 ? '' : html.slice(from, to === -1 ? undefined : to);
}

/** A form as a browser would submit it: where to, and every field's value. */
interface Form {
  readonly action: string;
  readonly method: string;
  readonly fields: Readonly<Record<string, string>>;
  /** The attributes of its quantity field, when it has one. */
  readonly quantity: Readonly<Record<string, string>> | null;
  readonly button: string;
}

function forms(html: string): Form[] {
  return [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)].map(
    ([, attributes = '', inside = '']) => {
      const fields: Record<string, string> = {};
      for (const [, tag = ''] of inside.matchAll(/<input\b([^>]*)>/g)) {
        const name = /\bname="([^"]*)"/.exec(tag)?.[1];
        if (name !== undefined) {
          fields[name] = /\bvalue="([^"]*)"/.exec(tag)?.[1] ?? '';
        }
      }
      const quantity = /<input\b([^>]*\bname="quantity"[^>]*)>/.exec(
        inside,
      )?.[1];
      return {
        action: /\baction="([^"]*)"/.exec(attributes)?.[1] ?? '',
        method: /\bmethod="([^"]*)"/.exec(attributes)?.[1] ?? '',
        fields,
        quantity:
          quantity === undefined
            ? null
            : Object.fromEntries(
                [...quantity.matchAll(/\b([a-z]+)="([^"]*)"/g)].map(
                  ([, name = '', value = '']) => [name, value],
                ),
              ),
        button: (/<button\b[^>]*>([\s\S]*?)<\/button>/.exec(inside)?.[1] ?? '')
          .replace(/<[^>]+>/g, '')
          .replace(/\s+/g, ' '),
      };
    },
  );
}

/** Submits a form as a browser would, and returns the answer unfollowed. */
function submit(
  form: Pick<Form, 'action' | 'fields'>,
  cookie?: string,
  change: Readonly<Record<string, string>> = {},
): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${form.action}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      // What a browser says of a form on the same site.
      'sec-fetch-site': 'same-origin',
      origin: ORIGIN,
      ...(cookie === undefined ? {} : { cookie }),
    },
    body: new URLSearchParams({ ...form.fields, ...change }).toString(),
    redirect: 'manual',
  });
}

function cartCookie(response: Response): string {
  return response.headers.get('set-cookie')?.split(';')[0] ?? '';
}

/** One line of the cart page, as plain facts. */
interface Line {
  readonly name: string;
  /** Where the name links to; '' when it is not a link. */
  readonly href: string;
  readonly sku: string;
  readonly problem: string;
  readonly note: string;
  readonly terms: readonly (readonly [string, string])[];
  readonly forms: readonly Form[];
}

function cartLines(html: string): Line[] {
  const list = between(html, '<ul class="cart-lines">', '</ul>');
  return [...list.matchAll(/<li class="cart-line">([\s\S]*?)<\/li>/g)].map(
    ([, line = '']) => ({
      name: (
        /<p class="cart-name">([\s\S]*?)<\/p>/.exec(line)?.[1] ?? ''
      ).replace(/<[^>]+>/g, ''),
      href: /<p class="cart-name"><a href="([^"]*)">/.exec(line)?.[1] ?? '',
      sku: /<p class="offer-sku">([^<]*)<\/p>/.exec(line)?.[1] ?? '',
      problem: /data-problem="([^"]*)"/.exec(line)?.[1] ?? '',
      note: (
        /<p class="cart-line-note"[^>]*>([\s\S]*?)<\/p>/.exec(line)?.[1] ?? ''
      ).replace(/\s+/g, ' '),
      terms: [...line.matchAll(/<dt>([^<]*)<\/dt><dd>([\s\S]*?)<\/dd>/g)].map(
        ([, label = '', value = '']) =>
          [label, value.replace(/<[^>]+>/g, '').replace(/\s/g, ' ')] as const,
      ),
      forms: forms(line),
    }),
  );
}

function subtotal(html: string): string | null {
  const found = /<p class="cart-subtotal">([\s\S]*?)<\/p>/.exec(html)?.[1];
  return found === undefined
    ? null
    : found
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

describe('the cart', () => {
  let screw: TestContent;
  let screwDe: TestContent;
  let washer: TestContent;

  beforeAll(async () => {
    await ensureSite();

    screw = await createContent({
      kind: 'product',
      title: 'Cap screw',
      slug: 'cap-screw',
      frontmatter: [
        'sizes:',
        '  CS-10: 10 mm',
        '  CS-16: 16 mm',
        '  CS-25: 25 mm',
        '  CS-30: 30 mm',
        '  CS-99: 99 mm',
      ].join('\n'),
    });
    screwDe = await createContent({
      kind: 'product',
      title: 'Zylinderschraube',
      slug: 'zylinderschraube',
      locale: 'de',
      translationGroup: screw.translationGroup,
      frontmatter: ['sizes:', '  CS-10: 10 mm', '  CS-16: 16 mm'].join('\n'),
    });
    washer = await createContent({
      kind: 'product',
      title: 'Washer',
      slug: 'washer',
      frontmatter: ['sizes:', '  WA-5: M5'].join('\n'),
    });
    // A page that has nothing to do with the shop.
    await createContent({ kind: 'page', title: 'About', slug: 'about' });
  });

  // The pages are rendered once and cached; the shop's own rows are put back
  // as they were before every test, so that one test's cart, or the stock it
  // changed, is not the next one's.
  beforeEach(async () => {
    await db().batch(
      [
        'p_shop_inquiry_line',
        'p_shop_inquiry',
        'p_shop_cart_line',
        'p_shop_cart',
        'p_shop_price',
        'p_shop_variant',
      ].map((table) => db().prepare(`DELETE FROM ${table}`)),
    );
    const group = screw.translationGroup;
    await createVariant({
      id: 'cs-10',
      productGroup: group,
      sku: 'CS-10',
      moq: 100,
      stock: 500,
      sortOrder: 1,
    });
    await createVariant({
      id: 'cs-16',
      productGroup: group,
      sku: 'CS-16',
      moq: 50,
      stock: 0,
      stockPolicy: 'made_to_order',
      sortOrder: 2,
    });
    // 73 left with a minimum order of 100: out of stock.
    await createVariant({
      id: 'cs-25',
      productGroup: group,
      sku: 'CS-25',
      moq: 100,
      stock: 73,
      sortOrder: 3,
    });
    // Sold, and not priced.
    await createVariant({
      id: 'cs-30',
      productGroup: group,
      sku: 'CS-30',
      sortOrder: 4,
    });
    for (const [variantId, usd, eur] of [
      ['cs-10', 42, 39],
      ['cs-16', 55, 51],
      ['cs-25', 60, 56],
    ] as const) {
      await setPrice({
        variantId,
        currency: 'USD',
        amountMinor: usd,
        source: 'base',
      });
      await setPrice({
        variantId,
        currency: 'EUR',
        amountMinor: eur,
        source: 'manual',
      });
    }
  });

  /** The add-to-cart form of one size on a product page. */
  async function offerForm(path: string, sku: string): Promise<Form | null> {
    const { html } = await get(path);
    const row =
      [...html.matchAll(/<li class="offer">([\s\S]*?)<\/li>/g)]
        .map(([, inside = '']) => inside)
        .find((inside) =>
          inside.includes(`<span class="offer-sku">${sku}</span>`),
        ) ?? '';
    return forms(row)[0] ?? null;
  }

  /** Adds a size from its product page and returns the cart cookie. */
  async function add(
    path: string,
    sku: string,
    quantity?: string,
    cookie?: string,
  ): Promise<string> {
    const form = await offerForm(path, sku);
    if (form === null) {
      throw new Error(`${path} offers no form for ${sku}`);
    }
    const response = await submit(
      form,
      cookie,
      quantity === undefined ? {} : { quantity },
    );
    expect(response.status).toBe(303);
    return cookie ?? cartCookie(response);
  }

  describe('a product page', () => {
    it('gives a size that can be ordered a form that posts it to the cart', async () => {
      expect(await offerForm(screw.path, 'CS-10')).toEqual({
        action: `${SHOP}/cart/update`,
        method: 'post',
        fields: { variant: 'cs-10', currency: 'USD', quantity: '100' },
        // The minimum order is where the quantity starts and what it moves
        // in steps of.
        quantity: {
          type: 'number',
          name: 'quantity',
          min: '100',
          step: '100',
          // The most a cart line may hold.
          max: '500',
          value: '100',
          inputmode: 'numeric',
        },
        button: 'Add to cart CS-10',
      });
    });

    it('posts to the cart in the page’s language, in the page’s currency', async () => {
      const form = await offerForm(screwDe.path, 'CS-16');

      expect(form?.action).toBe(`${SHOP}/de/cart/update`);
      expect(form?.fields).toEqual({
        variant: 'cs-16',
        currency: 'EUR',
        quantity: '50',
      });
      expect(form?.button).toBe('In den Warenkorb CS-16');
    });

    it('offers no form for a size that is out of stock or is not sold', async () => {
      expect(await offerForm(screw.path, 'CS-25')).toBeNull();
      expect(await offerForm(screw.path, 'CS-99')).toBeNull();
      expect(await offerForm(washer.path, 'WA-5')).toBeNull();
    });

    it('offers one for a size without a price: it goes in the cart to be asked about', async () => {
      const form = await offerForm(screw.path, 'CS-30');

      expect(form?.fields).toMatchObject({ variant: 'cs-30' });
      expect(form?.button).toBe('Add to cart CS-30');
    });

    it('carries no script for it', async () => {
      // The currency switch is the page's one script; the forms need none.
      const { html } = await get(screw.path);

      expect(html.match(/<script\b[^>]*\bsrc=/g)).toHaveLength(1);
      expect(html).not.toMatch(/\son[a-z]+=/);
    });
  });

  describe('the way to the cart', () => {
    it('is in the header of every page, in the page’s language', async () => {
      const english = between(
        (await get(screw.path)).html,
        '<header class="topbar">',
        '</header>',
      );
      const german = between(
        (await get(screwDe.path)).html,
        '<header class="topbar">',
        '</header>',
      );

      expect(english).toMatch(
        new RegExp(
          `<a class="cart-link" href="${SHOP}/cart"><svg[\\s\\S]*?</svg>\\s*<span>Cart</span></a>`,
        ),
      );
      expect(german).toMatch(
        new RegExp(
          `<a class="cart-link" href="${SHOP}/de/cart"><svg[\\s\\S]*?</svg>\\s*<span>Warenkorb</span></a>`,
        ),
      );
    });

    it('is there on a page that shows no product at all', async () => {
      // A plain page, and a list of a kind the shop has nothing to say of.
      for (const path of ['/about', '/news']) {
        const { status, html } = await get(path);

        expect(status, path).toBe(200);
        expect(
          between(html, '<header class="topbar">', '</header>'),
          path,
        ).toContain(`<a class="cart-link" href="${SHOP}/cart">`);
      }
    });

    it('is the same link for every visitor: a cached page knows nothing of a cart', async () => {
      const cookie = await add(screw.path, 'CS-10');
      const header = (path: string, sent?: string) =>
        get(path, sent).then(({ html }) =>
          between(html, '<header class="topbar">', '</header>'),
        );

      // The cookie is scoped to the shop's own routes and is not sent with a
      // page; even sent, the page says nothing of what is in the cart.
      expect(await header(washer.path, cookie)).toBe(await header(washer.path));
    });

    it('marks the cart as the page being read, on the cart page', async () => {
      const { html } = await get(`${SHOP}/cart`);

      expect(between(html, '<header class="topbar">', '</header>')).toContain(
        `<a class="cart-link" href="${SHOP}/cart" aria-current="page">`,
      );
    });
  });

  describe('an empty cart', () => {
    it('is a page of the site that says so, and leads back to the catalogue', async () => {
      const { status, html } = await get(`${SHOP}/cart`);

      expect(status).toBe(200);
      expect(html).toMatch(/<html lang="en"[ >]/);
      expect(html).toContain('<h1 class="detail-title">Your cart</h1>');
      expect(html).toContain('<p class="empty">Your cart is empty.</p>');
      expect(html).toContain(
        '<a class="btn btn-outline" href="/products">Back to the catalogue</a>',
      );
      expect(html).not.toContain('class="cart-lines"');
      expect(subtotal(html)).toBeNull();
      // Inside the site's own header and footer.
      expect(html).toContain('<header class="topbar">');
      expect(html).toContain('<footer class="footer">');
    });

    it('is titled in the theme’s words, in the page’s language', async () => {
      expect((await get(`${SHOP}/cart`)).html).toMatch(
        /<title>Your cart — [^<]+<\/title>/,
      );
      const german = (await get(`${SHOP}/de/cart`)).html;
      expect(german).toMatch(/<html lang="de"[ >]/);
      expect(german).toMatch(/<title>Ihr Warenkorb — [^<]+<\/title>/);
      expect(german).toContain('<p class="empty">Ihr Warenkorb ist leer.</p>');
      expect(german).toContain('href="/de/products"');
    });

    it('is what a cart nobody has touched for a month has become', async () => {
      const cookie = await add(screw.path, 'CS-10');
      await db()
        .prepare(
          "UPDATE p_shop_cart SET expires_at = '2020-01-01T00:00:00.000Z'",
        )
        .run();

      const { status, html } = await get(`${SHOP}/cart`, cookie);

      expect(status).toBe(200);
      expect(html).toContain('<p class="empty">Your cart is empty.</p>');
      expect(html).not.toContain('CS-10');
    });

    it('is what a cookie that names no cart gets', async () => {
      for (const cookie of [
        'nundar_cart=00000000000000000000000000000000',
        "nundar_cart=' OR 1=1 --",
      ]) {
        const { status, html } = await get(`${SHOP}/cart`, cookie);

        expect(status).toBe(200);
        expect(html).toContain('<p class="empty">Your cart is empty.</p>');
      }
    });
  });

  describe('a cart with parts in it', () => {
    it('lists each line with what it costs now, and the sum', async () => {
      const cookie = await add(screw.path, 'CS-10');
      await add(screw.path, 'CS-16', '150', cookie);

      const { status, html } = await get(`${SHOP}/cart`, cookie);

      expect(status).toBe(200);
      expect(
        cartLines(html).map((line) => [line.name, line.sku, line.terms]),
      ).toEqual([
        [
          'Cap screw',
          'CS-10',
          [
            ['Unit price', '$0.42'],
            ['Total', '$42.00'],
          ],
        ],
        [
          'Cap screw',
          'CS-16',
          [
            ['Unit price', '$0.55'],
            ['Total', '$82.50'],
          ],
        ],
      ]);
      expect(subtotal(html)).toBe('Subtotal $124.50');
      expect(html).toContain(
        '<p class="cart-note">Shipping and taxes are not included.</p>',
      );
    });

    it('links each line to its product, in the language the cart is read in', async () => {
      const cookie = await add(screw.path, 'CS-10');

      expect(
        cartLines((await get(`${SHOP}/cart`, cookie)).html)[0],
      ).toMatchObject({ name: 'Cap screw', href: screw.path });
      expect(
        cartLines((await get(`${SHOP}/de/cart`, cookie)).html)[0],
      ).toMatchObject({ name: 'Zylinderschraube', href: screwDe.path });
    });

    it('prices from the database on every request, never from the cart', async () => {
      const cookie = await add(screw.path, 'CS-10');
      await setPrice({
        variantId: 'cs-10',
        currency: 'USD',
        amountMinor: 50,
        source: 'base',
      });

      const { html } = await get(`${SHOP}/cart`, cookie);

      expect(cartLines(html)[0]?.terms).toEqual([
        ['Unit price', '$0.50'],
        ['Total', '$50.00'],
      ]);
    });

    it('gives each line a form to set its quantity, in steps of its minimum order, and one to remove it', async () => {
      const cookie = await add(screw.path, 'CS-16', '150');
      const [line] = cartLines((await get(`${SHOP}/cart`, cookie)).html);

      expect(line?.forms).toEqual([
        {
          action: `${SHOP}/cart/update`,
          method: 'post',
          fields: { action: 'set', variant: 'cs-16', quantity: '150' },
          quantity: {
            type: 'number',
            name: 'quantity',
            min: '50',
            step: '50',
            max: '500',
            value: '150',
            inputmode: 'numeric',
          },
          // Named for its line: a page of buttons all called "Update" tells
          // someone who cannot see them nothing.
          button: 'Update CS-16',
        },
        {
          action: `${SHOP}/cart/update`,
          method: 'post',
          fields: { action: 'remove', variant: 'cs-16' },
          quantity: null,
          button: 'Remove CS-16',
        },
      ]);
    });

    it('changes a quantity and removes a line through those forms', async () => {
      const cookie = await add(screw.path, 'CS-10');
      await add(screw.path, 'CS-16', undefined, cookie);
      const before = cartLines((await get(`${SHOP}/cart`, cookie)).html);
      const [set, remove] = before[0]?.forms ?? [];

      const changed = await submit(set as Form, cookie, { quantity: '300' });
      expect(changed.status).toBe(303);
      expect(changed.headers.get('location')).toBe(`${SHOP}/cart`);
      expect(
        cartLines((await get(`${SHOP}/cart`, cookie)).html)[0]?.terms[1],
      ).toEqual(['Total', '$126.00']);

      const removed = await submit(remove as Form, cookie);
      expect(removed.status).toBe(303);
      expect(
        cartLines((await get(`${SHOP}/cart`, cookie)).html).map(
          (line) => line.sku,
        ),
      ).toEqual(['CS-16']);
    });

    it('is the same cart in every language, each in its own words and number format', async () => {
      const cookie = await add(screwDe.path, 'CS-10');

      const { html } = await get(`${SHOP}/de/cart`, cookie);

      expect(html).toMatch(/<html lang="de"[ >]/);
      expect(cartLines(html)[0]).toMatchObject({
        name: 'Zylinderschraube',
        sku: 'CS-10',
        terms: [
          ['Stückpreis', '0,39 €'],
          ['Summe', '39,00 €'],
        ],
      });
      expect(subtotal(html)?.replace(/\s/g, ' ')).toBe('Zwischensumme 39,00 €');
      // The English page shows the same cart, in the currency it was
      // started in.
      expect(
        cartLines((await get(`${SHOP}/cart`, cookie)).html)[0],
      ).toMatchObject({
        name: 'Cap screw',
        terms: [
          ['Unit price', '€0.39'],
          ['Total', '€39.00'],
        ],
      });
    });

    it('lets the language be changed without leaving the cart', async () => {
      const { html } = await get(`${SHOP}/de/cart`);
      const switcher = between(html, '<details class="langs">', '</details>');

      // Mallok lists the same page of the plugin's under each language.
      expect(switcher).toContain(`href="${ORIGIN}${SHOP}/cart" hreflang="en"`);
      expect(switcher).toContain(
        `href="${ORIGIN}${SHOP}/de/cart" hreflang="de" lang="de" aria-current="true"`,
      );
      expect(switcher).toContain(
        `href="${ORIGIN}${SHOP}/fr/cart" hreflang="fr"`,
      );
    });

    it('offers the currencies every line has a price in, and shows the one chosen', async () => {
      const cookie = await add(screw.path, 'CS-10');
      const page = (await get(`${SHOP}/cart`, cookie)).html;
      const chooser = forms(
        between(page, '<div class="cart-foot">', '</div>'),
      )[0];

      expect(chooser).toMatchObject({
        action: `${SHOP}/cart/update`,
        method: 'post',
        fields: { action: 'currency' },
      });
      expect(
        [
          ...between(page, '<form class="currency"', '</form>').matchAll(
            /<button type="submit" name="currency" value="([A-Z]+)" aria-pressed="(true|false)">([A-Z]+)<\/button>/g,
          ),
        ].map(([, value, pressed, text]) => [value, pressed, text]),
      ).toEqual([
        ['USD', 'true', 'USD'],
        ['EUR', 'false', 'EUR'],
      ]);

      const chosen = await submit(chooser as Form, cookie, { currency: 'EUR' });
      expect(chosen.status).toBe(303);
      const after = (await get(`${SHOP}/cart`, cookie)).html;
      expect(cartLines(after)[0]?.terms[0]).toEqual(['Unit price', '€0.39']);
      expect(after).toContain(
        '<button type="submit" name="currency" value="EUR" aria-pressed="true">EUR</button>',
      );
    });

    it('goes in the currency the buyer was reading when a part was added', async () => {
      // The page's currency is in the form; the currency switch changes it
      // there along with the prices.
      const form = await offerForm(screw.path, 'CS-10');
      const response = await submit(form as Form, undefined, {
        currency: 'EUR',
      });

      const { html } = await get(`${SHOP}/cart`, cartCookie(response));

      expect(cartLines(html)[0]?.terms[0]).toEqual(['Unit price', '€0.39']);
    });

    it('is one visitor’s own page: not cached, not indexed, and no script on it', async () => {
      const cookie = await add(screw.path, 'CS-10');
      const { html, headers } = await get(`${SHOP}/cart`, cookie);

      expect(headers.get('cache-control')).toBe('private, no-store');
      expect(headers.get('x-robots-tag')).toBe('noindex');
      expect(headers.get('cache-tag')).toBeNull();
      expect(html).not.toMatch(/<script\b/);
    });

    it('costs two round trips to D1 beyond Mallok’s own, however many lines', async () => {
      const count = async (cookie?: string): Promise<number> => {
        let status = 0;
        const calls = await countD1Calls(async () => {
          status = (await get(`${SHOP}/cart`, cookie)).status;
        });
        expect(status).toBe(200);
        return calls;
      };
      const cookie = await add(screw.path, 'CS-10');
      const one = await count(cookie);
      await add(screw.path, 'CS-16', undefined, cookie);
      const two = await count(cookie);

      // Mallok reads the site and the plugin's state: one. The shop reads
      // the cart, then everything its lines depend on: two more.
      expect(one).toBe(3);
      expect(two).toBe(3);
      // An empty cart has no lines to read anything for.
      expect(await count()).toBe(2);
    });
  });

  describe('a line that can no longer be ordered as it stands', () => {
    it('says the minimum order when it has risen above what is in the cart', async () => {
      const cookie = await add(screw.path, 'CS-10');
      await db()
        .prepare("UPDATE p_shop_variant SET moq = 200 WHERE id = 'cs-10'")
        .run();

      const { html } = await get(`${SHOP}/cart`, cookie);
      const [line] = cartLines(html);

      expect(line?.problem).toBe('below_moq');
      expect(line?.note).toBe('The minimum order is 200');
      // The form already asks for the new minimum.
      expect(line?.forms[0]?.quantity).toMatchObject({
        min: '200',
        step: '200',
        value: '100',
      });
      // A sum nobody can pay is not stated.
      expect(subtotal(html)).toBeNull();
    });

    it('says the most a line may hold when the cart has more than that in it', async () => {
      // No form puts this in a cart: it is a line from before the ceiling
      // was what it is, or a row written by hand.
      const cookie = await add(screw.path, 'CS-10', '400');
      await db()
        .prepare(
          "UPDATE p_shop_cart_line SET quantity = 600 WHERE variant_id = 'cs-10'",
        )
        .run();

      const { html } = await get(`${SHOP}/cart`, cookie);
      const [line] = cartLines(html);

      expect(line?.problem).toBe('quantity_too_large');
      expect(line?.note).toBe('The most that can be ordered at once is 500');
      expect(line?.forms[0]?.quantity).toMatchObject({
        max: '500',
        value: '600',
      });
      expect(subtotal(html)).toBeNull();
    });

    it('says how many are left when the stock has fallen below what is in the cart', async () => {
      const cookie = await add(screw.path, 'CS-10', '400');
      await db()
        .prepare("UPDATE p_shop_variant SET stock = 250 WHERE id = 'cs-10'")
        .run();

      const { html } = await get(`${SHOP}/cart`, cookie);

      expect(cartLines(html)[0]).toMatchObject({
        problem: 'insufficient_stock',
        note: 'Available from stock: 250',
      });
      expect(subtotal(html)).toBeNull();
    });

    it('says a part is gone, and leaves only the way to remove it', async () => {
      const cookie = await add(screw.path, 'CS-10');
      await add(screw.path, 'CS-16', undefined, cookie);
      await db()
        .prepare(
          "UPDATE p_shop_variant SET status = 'archived' WHERE id = 'cs-10'",
        )
        .run();
      await db().prepare("DELETE FROM p_shop_variant WHERE id = 'cs-16'").run();

      const { status, html } = await get(`${SHOP}/cart`, cookie);
      const [archived, deleted] = cartLines(html);

      expect(status).toBe(200);
      expect(archived).toMatchObject({
        name: 'Cap screw',
        sku: 'CS-10',
        problem: 'unavailable',
        note: 'This part can no longer be ordered.',
      });
      expect(archived?.forms.map((form) => form.fields.action)).toEqual([
        'remove',
      ]);
      // A variant that no longer exists has no name or SKU left to show.
      expect(deleted).toMatchObject({
        name: '',
        sku: '',
        problem: 'unavailable',
      });
      expect(deleted?.forms).toHaveLength(1);
      expect(deleted?.forms[0]?.button).toBe('Remove');
      expect(deleted?.href).toBe('');
      expect(html).not.toContain('<p class="cart-name"></p>');
      expect(html).not.toContain('<p class="offer-sku"></p>');
    });

    it('says a part has no price, and states no sum', async () => {
      const cookie = await add(screw.path, 'CS-10');
      await db()
        .prepare("DELETE FROM p_shop_price WHERE variant_id = 'cs-10'")
        .run();

      const { html } = await get(`${SHOP}/cart`, cookie);
      const [line] = cartLines(html);

      expect(line?.problem).toBe('no_price');
      expect(line?.note).toBe(
        'No price is listed for this part. It will be quoted when you send this cart as a request.',
      );
      expect(line?.terms).toEqual([]);
      expect(subtotal(html)).toBeNull();
    });

    it('keeps a part whose product is out in another language only', async () => {
      // Published in German and nowhere else. It can be added from its
      // German page, and is the same part when the cart is read in English.
      const german = await createContent({
        kind: 'product',
        title: 'Nur auf Deutsch',
        slug: 'nur-auf-deutsch',
        locale: 'de',
        frontmatter: ['sizes:', '  ND-1: 1 mm'].join('\n'),
      });
      await createVariant({
        id: 'nd-1',
        productGroup: german.translationGroup,
        sku: 'ND-1',
      });
      await setPrice({
        variantId: 'nd-1',
        currency: 'USD',
        amountMinor: 100,
        source: 'base',
      });
      const cookie = await add(german.path, 'ND-1');

      for (const path of [
        `${SHOP}/cart`,
        `${SHOP}/fr/cart`,
        `${SHOP}/de/cart`,
      ]) {
        const [line] = cartLines((await get(path, cookie)).html);

        expect(line, path).toMatchObject({
          name: 'Nur auf Deutsch',
          href: german.path,
          sku: 'ND-1',
          problem: '',
        });
      }
    });

    it('says a part is gone when its product is published for later', async () => {
      // In a cart already, and then rescheduled: Mallok stops showing the
      // page until its time comes, and the cart stops selling the part.
      const held = await createContent({
        kind: 'product',
        title: 'Held back',
        slug: 'held-back',
        frontmatter: ['sizes:', '  HB-1: 1 mm'].join('\n'),
      });
      await createVariant({
        id: 'hb-1',
        productGroup: held.translationGroup,
        sku: 'HB-1',
      });
      await setPrice({
        variantId: 'hb-1',
        currency: 'USD',
        amountMinor: 100,
        source: 'base',
      });
      const cookie = await add(held.path, 'HB-1');
      await db()
        .prepare(
          "UPDATE content SET published_at = '2999-01-01T00:00:00.000Z' WHERE id = ?",
        )
        .bind(held.id)
        .run();

      const [line] = cartLines((await get(`${SHOP}/cart`, cookie)).html);

      expect(line).toMatchObject({
        name: '',
        href: '',
        sku: 'HB-1',
        problem: 'unavailable',
      });
    });

    it('shows a cart in a currency every line has, when the one chosen is not one', async () => {
      // A part priced in euros only, added from a German page; then one from
      // an English page, which asks for dollars. Dollars would leave the
      // first without a price and the buyer with no way back.
      await db()
        .prepare(
          "DELETE FROM p_shop_price WHERE variant_id = 'cs-16' AND currency = 'USD'",
        )
        .run();
      const cookie = await add(screwDe.path, 'CS-16');
      await add(screw.path, 'CS-10', undefined, cookie);

      const { html } = await get(`${SHOP}/cart`, cookie);

      expect(cartLines(html).map((line) => [line.sku, line.problem])).toEqual([
        ['CS-10', ''],
        ['CS-16', ''],
      ]);
      expect(cartLines(html).map((line) => line.terms[0]?.[1])).toEqual([
        '€0.39',
        '€0.51',
      ]);
      expect(subtotal(html)).toBe('Subtotal €64.50');
    });

    it('shows the whole cart in the base currency when one line lacks the one chosen', async () => {
      const cookie = await add(screwDe.path, 'CS-10');
      await add(screwDe.path, 'CS-16', undefined, cookie);
      await db()
        .prepare(
          "DELETE FROM p_shop_price WHERE variant_id = 'cs-16' AND currency = 'EUR'",
        )
        .run();

      const { html } = await get(`${SHOP}/de/cart`, cookie);

      // One currency for the whole order: euros for one line and dollars
      // for the next would add up to nothing.
      expect(cartLines(html).map((line) => line.terms[0]?.[1])).toEqual([
        '0,42 $',
        '0,55 $',
      ]);
      expect(html).not.toContain('<form class="currency"');
    });
  });

  describe('a change the shop refuses', () => {
    /** The refusal box of a cart page: the reason, and its words. */
    function refusal(html: string): { kind: string; text: string } | null {
      const box = /<div class="cart-problem"([^>]*)>([\s\S]*?)<\/div>/.exec(
        html,
      );
      return box === null
        ? null
        : {
            kind: /data-problem="([^"]*)"/.exec(box[1] ?? '')?.[1] ?? '',
            text: (box[2] ?? '')
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim(),
          };
    }

    it('sends the buyer to the cart page, which says what was refused in their language', async () => {
      const cookie = await add(screwDe.path, 'CS-10');
      const form = await offerForm(screwDe.path, 'CS-16');

      // The quantity field would not allow it; a request can skip the field.
      const response = await submit(form as Form, cookie, { quantity: '7' });
      expect(response.status).toBe(303);
      const location = response.headers.get('location') ?? '';
      expect(location).toBe(`${SHOP}/de/cart?refused=below_moq&variant=cs-16`);

      const { status, html, headers } = await get(location, cookie);
      expect(status).toBe(200);
      expect(html).toMatch(/<html lang="de"[ >]/);
      expect(html).toContain('<div class="cart-problem" role="alert"');
      expect(refusal(html)).toEqual({
        kind: 'below_moq',
        text: 'Diese Änderung wurde nicht übernommen. CS-16 Die Mindestmenge beträgt 50',
      });
      // The cart below it is unchanged.
      expect(cartLines(html).map((line) => line.sku)).toEqual(['CS-10']);
      expect(headers.get('cache-control')).toBe('private, no-store');
    });

    it('lands on a page whose language can be changed', async () => {
      // The page a POST renders is listed, in every language, at the POST's
      // own address — which answers a link with "method not allowed".
      const { html } = await get(
        `${SHOP}/de/cart?refused=below_moq&variant=cs-16`,
      );
      const switcher = between(html, '<details class="langs">', '</details>');
      const links = [...switcher.matchAll(/href="([^"]*)"/g)].map(
        ([, href = '']) => href,
      );

      expect(links).toEqual([
        `${ORIGIN}${SHOP}/cart`,
        `${ORIGIN}${SHOP}/de/cart`,
        `${ORIGIN}${SHOP}/fr/cart`,
        `${ORIGIN}${SHOP}/es/cart`,
      ]);
      for (const href of links) {
        expect((await SELF.fetch(href)).status, href).toBe(200);
      }
    });

    it.each([
      ['insufficient_stock', 'cs-10', 'CS-10 Available from stock: 500'],
      [
        'quantity_too_large',
        'cs-10',
        'CS-10 The most that can be ordered at once is 500',
      ],
      [
        'cart_full',
        'cs-10',
        'CS-10 The cart cannot hold more different parts.',
      ],
      ['unavailable', 'cs-10', 'CS-10 This part can no longer be ordered.'],
    ])(
      'says %s with the figure the shop has, not one from the address',
      async (kind, variantId, words) => {
        const { html } = await get(
          `${SHOP}/cart?refused=${kind}&variant=${variantId}&moq=1&available=99999&max=7&sku=EVIL`,
        );

        expect(refusal(html)).toEqual({
          kind,
          text: `That change was not made. ${words}`,
        });
        expect(html).not.toContain('99999');
        expect(html).not.toContain('EVIL');
      },
    );

    it('puts nothing of a made-up link on the page', async () => {
      // Only which reason and which variant are read from the address, and
      // both only to look something up.
      const unknownVariant = await get(
        `${SHOP}/cart?refused=below_moq&variant=${encodeURIComponent('<b>call 555-0100</b>')}`,
      );
      expect(refusal(unknownVariant.html)).toEqual({
        kind: 'unavailable',
        text: 'That change was not made. This part can no longer be ordered.',
      });
      expect(unknownVariant.html).not.toContain('555-0100');

      for (const reason of ['', 'nonsense', '<script>', 'below_moq ']) {
        const { status, html } = await get(
          `${SHOP}/cart?refused=${encodeURIComponent(reason)}&variant=cs-10`,
        );

        expect(status, reason).toBe(200);
        expect(refusal(html), reason).toBeNull();
      }
    });

    it('explains a refusal without a third round trip to D1', async () => {
      const cookie = await add(screw.path, 'CS-10');
      let status = 0;
      const calls = await countD1Calls(async () => {
        status = (
          await get(`${SHOP}/cart?refused=below_moq&variant=cs-16`, cookie)
        ).status;
      });

      expect(status).toBe(200);
      // One of Mallok's, two of the shop's: the variant rides with the cart.
      expect(calls).toBe(3);
    });

    it('refuses a form posted from another site', async () => {
      const form = await offerForm(screw.path, 'CS-10');
      const response = await SELF.fetch(`${ORIGIN}${form?.action}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'sec-fetch-site': 'cross-site',
          origin: 'https://elsewhere.example',
        },
        body: new URLSearchParams(form?.fields ?? {}).toString(),
        redirect: 'manual',
      });

      expect(response.status).toBe(403);
      const rows = await db()
        .prepare('SELECT COUNT(*) AS n FROM p_shop_cart')
        .first<{ n: number }>();
      expect(rows?.n).toBe(0);
    });
  });

  describe('the cart, sent as a request for a quote', () => {
    /** One control of the form, by its attributes. */
    type Control = Readonly<Record<string, string>>;

    interface QuoteForm {
      readonly action: string;
      readonly method: string;
      readonly title: string;
      readonly labels: readonly string[];
      readonly controls: Readonly<Record<string, Control>>;
      readonly button: string;
      readonly html: string;
    }

    function quoteForm(html: string): QuoteForm | null {
      const found = /<form class="quote-form"([^>]*)>([\s\S]*?)<\/form>/.exec(
        html,
      );
      if (found === null) {
        return null;
      }
      const [, attributes = '', inside = ''] = found;
      const controls: Record<string, Control> = {};
      for (const [, tag = '', rest = ''] of inside.matchAll(
        /<(input|textarea)\b([^>]*)>/g,
      )) {
        const control: Record<string, string> = { tag };
        for (const [, name = '', , value] of rest.matchAll(
          /\b([a-z-]+)(="([^"]*)")?/g,
        )) {
          control[name] = value ?? '';
        }
        controls[control.name ?? ''] = control;
      }
      return {
        action: /\baction="([^"]*)"/.exec(attributes)?.[1] ?? '',
        method: /\bmethod="([^"]*)"/.exec(attributes)?.[1] ?? '',
        title: /<h2[^>]*>([^<]*)<\/h2>/.exec(inside)?.[1] ?? '',
        labels: [
          ...inside.matchAll(/<label>([\s\S]*?)<(?:input|textarea)/g),
        ].map(([, label = '']) =>
          label
            .replace(/<[^>]+>/g, '')
            .replace(/\s+/g, ' ')
            .trim(),
        ),
        controls,
        button: /<button\b[^>]*>([^<]*)<\/button>/.exec(inside)?.[1] ?? '',
        html: inside,
      };
    }

    const BUYER = {
      name: 'Ada Lovelace',
      email: 'ada@buyer.example',
      company: 'Analytical Engines Ltd',
      phone: '+44 20 7946 0000',
      message: 'Delivered prices, please.',
      website: '',
    };

    /** What the page says became of a cart that was sent. */
    function sentBox(html: string): string | null {
      const box = /<div class="cart-sent" role="status">([\s\S]*?)<\/div>/.exec(
        html,
      )?.[1];
      return box === undefined
        ? null
        : box
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /** Why the page says a cart was not sent. */
    function notSentBox(html: string): { kind: string; text: string } | null {
      const found =
        /<div class="cart-problem" role="alert" data-problem="inquiry_([a-z_]*)">([\s\S]*?)<\/div>/.exec(
          html,
        );
      return found === null
        ? null
        : {
            kind: found[1] ?? '',
            text: (found[2] ?? '')
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim(),
          };
    }

    it('is a form below the cart, whose fields carry the plugin’s own rules', async () => {
      const cookie = await add(screw.path, 'CS-10');
      const form = quoteForm((await get(`${SHOP}/cart`, cookie)).html);

      expect(form).toMatchObject({
        action: `${SHOP}/cart/inquiry`,
        method: 'post',
        title: 'Send this cart as a request for a quote',
        labels: [
          'Your name',
          'Email',
          'Company (optional)',
          'Phone (optional)',
          'Message (optional)',
          'Leave this field empty',
        ],
        button: 'Send request',
      });
      // What a browser checks is what the server checks: a person using one
      // is never sent back to a form the server emptied.
      expect(form?.controls.name).toMatchObject({
        type: 'text',
        required: '',
        // `required` is satisfied by spaces, and the server is not.
        pattern: NAME_PATTERN_SOURCE,
        maxlength: String(INQUIRY_LIMITS.name),
        autocomplete: 'name',
      });
      expect(form?.controls.email).toMatchObject({
        type: 'email',
        required: '',
        maxlength: String(INQUIRY_LIMITS.email),
        // The very text the server compiles, which a browser anchors at
        // both ends and compiles the same way.
        pattern: EMAIL_PATTERN_SOURCE,
        autocomplete: 'email',
      });
      expect(form?.controls.company).toMatchObject({
        maxlength: String(INQUIRY_LIMITS.company),
        autocomplete: 'organization',
      });
      expect(form?.controls.company).not.toHaveProperty('required');
      expect(form?.controls.phone).toMatchObject({
        type: 'tel',
        maxlength: String(INQUIRY_LIMITS.phone),
        autocomplete: 'tel',
      });
      expect(form?.controls.message).toMatchObject({
        tag: 'textarea',
        maxlength: String(INQUIRY_LIMITS.message),
      });
      expect(form?.controls.message).not.toHaveProperty('required');
    });

    it('keeps the field no person fills in out of sight and out of reach', async () => {
      const cookie = await add(screw.path, 'CS-10');
      const form = quoteForm((await get(`${SHOP}/cart`, cookie)).html);

      expect(form?.controls.website).toMatchObject({
        tabindex: '-1',
        autocomplete: 'off',
      });
      expect(form?.html).toMatch(
        /<p class="quote-form-trap" aria-hidden="true"><label>[^<]*<input type="text" name="website"/,
      );
    });

    it('speaks the page’s language and posts to it', async () => {
      const cookie = await add(screwDe.path, 'CS-10');
      const form = quoteForm((await get(`${SHOP}/de/cart`, cookie)).html);

      expect(form).toMatchObject({
        action: `${SHOP}/de/cart/inquiry`,
        title: 'Diesen Warenkorb als Angebotsanfrage senden',
        labels: [
          'Ihr Name',
          'E-Mail',
          'Unternehmen (optional)',
          'Telefon (optional)',
          'Nachricht (optional)',
          'Dieses Feld bitte leer lassen',
        ],
        button: 'Anfrage senden',
      });
    });

    it('sends the cart as a browser would, and lands on the number it became', async () => {
      const cookie = await add(screw.path, 'CS-10', '300');
      const form = quoteForm((await get(`${SHOP}/cart`, cookie)).html);

      const response = await submit(
        { action: form?.action ?? '', fields: BUYER },
        cookie,
      );

      expect(response.status).toBe(303);
      const location = response.headers.get('location') ?? '';
      const stored = await db()
        .prepare('SELECT inquiry_no, name, line_count FROM p_shop_inquiry')
        .first<{ inquiry_no: string; name: string; line_count: number }>();
      expect(stored).toMatchObject({ name: 'Ada Lovelace', line_count: 1 });
      expect(location).toBe(`${SHOP}/cart?sent=${stored?.inquiry_no}`);

      const { status, html, headers } = await get(location, cookie);
      expect(status).toBe(200);
      expect(sentBox(html)).toBe(
        `Your request has been sent. ${stored?.inquiry_no} We will answer by email. Please quote this number if you write to us.`,
      );
      // The cart has gone into the inquiry.
      expect(html).toContain('<p class="empty">Your cart is empty.</p>');
      expect(cartLines(html)).toEqual([]);
      expect(quoteForm(html)).toBeNull();
      expect(headers.get('cache-control')).toBe('private, no-store');
      // Nothing that was typed is on the page it lands on.
      expect(html).not.toContain('Ada');
      expect(html).not.toContain('buyer.example');
    });

    it('says so in the page’s language', async () => {
      const cookie = await add(screwDe.path, 'CS-10');
      const form = quoteForm((await get(`${SHOP}/de/cart`, cookie)).html);
      const response = await submit(
        { action: form?.action ?? '', fields: BUYER },
        cookie,
      );

      const { html } = await get(
        response.headers.get('location') ?? '',
        cookie,
      );

      expect(sentBox(html)).toMatch(
        /^Ihre Anfrage wurde gesendet\. RFQ-\d{6}-[0-9A-Z]{8} Wir antworten Ihnen per E-Mail\./,
      );
    });

    it('confirms an inquiry only to the browser whose cart it was', async () => {
      const cookie = await add(screw.path, 'CS-10');
      const form = quoteForm((await get(`${SHOP}/cart`, cookie)).html);
      const response = await submit(
        { action: form?.action ?? '', fields: BUYER },
        cookie,
      );
      const location = response.headers.get('location') ?? '';
      const stranger = await add(screw.path, 'CS-16');

      // The number alone, in a link somebody passed on or made up.
      expect(sentBox((await get(location)).html)).toBeNull();
      expect(sentBox((await get(location, stranger)).html)).toBeNull();
      expect(
        sentBox(
          (await get(`${SHOP}/cart?sent=RFQ-261009-00000000`, cookie)).html,
        ),
      ).toBeNull();
      expect(
        sentBox((await get(`${SHOP}/cart?sent=<b>sent</b>`, cookie)).html),
      ).toBeNull();
      // And to the one whose it was, however often it looks.
      expect(sentBox((await get(location, cookie)).html)).not.toBeNull();
    });

    it('offers the form for a part with no price, and states no sum', async () => {
      const cookie = await add(screw.path, 'CS-30', '10');
      const { html } = await get(`${SHOP}/cart`, cookie);

      expect(cartLines(html)[0]).toMatchObject({
        sku: 'CS-30',
        problem: 'no_price',
        note: 'No price is listed for this part. It will be quoted when you send this cart as a request.',
      });
      expect(subtotal(html)).toBeNull();
      expect(quoteForm(html)).not.toBeNull();
    });

    it('offers no form, and says why, while a line has to be put right', async () => {
      const cookie = await add(screw.path, 'CS-10');
      await db()
        .prepare("UPDATE p_shop_variant SET moq = 200 WHERE id = 'cs-10'")
        .run();

      const { html } = await get(`${SHOP}/cart`, cookie);

      expect(quoteForm(html)).toBeNull();
      expect(html).toContain(
        '<p class="cart-note quote-form-blocked">Once the lines marked above are put right, the cart can be sent as a request for a quote.</p>',
      );
    });

    it('offers neither for an empty cart', async () => {
      const { html } = await get(`${SHOP}/cart`);

      expect(quoteForm(html)).toBeNull();
      expect(html).not.toContain('quote-form-blocked');
    });

    it.each([
      [
        'inquiry=invalid&field=email',
        'invalid',
        'Your request was not sent. Please check this field: Email',
      ],
      [
        'inquiry=invalid&field=name',
        'invalid',
        'Your request was not sent. Please check this field: Your name',
      ],
      [
        'inquiry=invalid',
        'invalid',
        'Your request was not sent. Please check this field:',
      ],
      [
        'inquiry=empty',
        'empty',
        'Your request was not sent. There is nothing in the cart to send.',
      ],
      [
        'inquiry=cart_problem',
        'cart_problem',
        'Your request was not sent. Please put right the lines marked below first.',
      ],
      [
        'inquiry=cart_changed',
        'cart_changed',
        'Your request was not sent. The cart changed while it was being sent. Please check it and send it again.',
      ],
      [
        'inquiry=too_many',
        'too_many',
        'Your request was not sent. Too many requests have been sent from here in the last hour. Please try again later.',
      ],
    ])('says why a cart was not sent: %s', async (query, kind, text) => {
      const cookie = await add(screw.path, 'CS-10');

      const { html } = await get(`${SHOP}/cart?${query}`, cookie);

      expect(notSentBox(html)).toEqual({ kind, text });
      // The cart is still there to be sent.
      expect(cartLines(html)).toHaveLength(1);
      expect(quoteForm(html)).not.toBeNull();
    });

    it('says it in the page’s language', async () => {
      const cookie = await add(screwDe.path, 'CS-10');

      const { html } = await get(
        `${SHOP}/de/cart?inquiry=invalid&field=email`,
        cookie,
      );

      expect(notSentBox(html)?.text).toBe(
        'Ihre Anfrage wurde nicht gesendet. Bitte prüfen Sie dieses Feld: E-Mail',
      );
    });

    it('puts on the page nothing a link made up', async () => {
      const cookie = await add(screw.path, 'CS-10');

      const unknown = await get(`${SHOP}/cart?inquiry=EVIL`, cookie);
      const field = await get(
        `${SHOP}/cart?inquiry=invalid&field=EVIL`,
        cookie,
      );
      // A field is named only beside the reason that has one.
      const misplaced = await get(
        `${SHOP}/cart?inquiry=too_many&field=email`,
        cookie,
      );

      expect(notSentBox(unknown.html)).toBeNull();
      expect(unknown.html).not.toContain('EVIL');
      expect(notSentBox(field.html)?.text).toBe(
        'Your request was not sent. Please check this field:',
      );
      expect(field.html).not.toContain('EVIL');
      // Nor may it pick words of the pack's that are not a field's: the
      // label is looked up as `quote_<field>`, and `quote_send` is the
      // button's.
      const borrowed = await get(
        `${SHOP}/cart?inquiry=invalid&field=send`,
        cookie,
      );
      expect(notSentBox(borrowed.html)?.text).toBe(
        'Your request was not sent. Please check this field:',
      );
      expect(notSentBox(misplaced.html)?.text).not.toContain('Email');
    });

    it('needs no script', async () => {
      const cookie = await add(screw.path, 'CS-10');

      const { html } = await get(`${SHOP}/cart`, cookie);

      expect(html).not.toMatch(/<script\b/);
    });

    it('costs the cart page no round trip more', async () => {
      const cookie = await add(screw.path, 'CS-10');
      const form = quoteForm((await get(`${SHOP}/cart`, cookie)).html);
      const response = await submit(
        { action: form?.action ?? '', fields: BUYER },
        cookie,
      );
      const location = response.headers.get('location') ?? '';

      const calls = await countD1Calls(async () => {
        await get(location, cookie);
      });

      // One of Mallok's, and the shop's one: the cart is empty, so there is
      // nothing its lines depend on to read. The inquiry rides with the cart.
      expect(calls).toBe(2);
    });
  });
});
