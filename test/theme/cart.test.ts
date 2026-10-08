import { SELF } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
      ['p_shop_cart_line', 'p_shop_cart', 'p_shop_price', 'p_shop_variant'].map(
        (table) => db().prepare(`DELETE FROM ${table}`),
      ),
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

    it('offers no form for a size that is out of stock, has no price, or is not sold', async () => {
      expect(await offerForm(screw.path, 'CS-25')).toBeNull();
      expect(await offerForm(screw.path, 'CS-30')).toBeNull();
      expect(await offerForm(screw.path, 'CS-99')).toBeNull();
      expect(await offerForm(washer.path, 'WA-5')).toBeNull();
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
        'This part has no price here. Please ask for a quote.',
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
        'CS-10 The most that can be ordered at once is 10000',
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
});
