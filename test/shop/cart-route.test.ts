import { SELF } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  clearShopTables,
  createProduct,
  createVariant,
  db,
  ensureSite,
  ORIGIN,
  type TestProduct,
} from './helpers.js';

let valve: TestProduct;
let draft: TestProduct;

const CART = '/_mallok/p/shop/cart';

/**
 * Posts the form a product page would post, optionally with a cart cookie.
 * `locale` is the language of the page the form is on: it is part of the
 * address the form posts to, after the plugin's id.
 */
function post(
  fields: Record<string, string>,
  cookie?: string,
  locale?: string,
): Promise<Response> {
  const base = locale === undefined ? '' : `/${locale}`;
  return SELF.fetch(`${ORIGIN}/_mallok/p/shop${base}/cart/update`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(cookie === undefined ? {} : { cookie }),
    },
    body: new URLSearchParams(fields).toString(),
    redirect: 'manual',
  });
}

/**
 * What a refused change is answered with: the cart page, saying what was
 * refused. The reason is in the page as an attribute, so that these tests
 * read the plugin's answer and not one language's words for it.
 */
async function refusal(
  response: Response,
): Promise<{ kind: string | undefined; text: string }> {
  const html = await response.text();
  const box =
    /<div class="cart-problem"[^>]*data-problem="([^"]*)"[^>]*>([\s\S]*?)<\/div>/.exec(
      html,
    );
  return {
    kind: box?.[1],
    text: (box?.[2] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '),
  };
}

/** The `name=value` pair of the cart cookie a response set, if any. */
function cartCookie(response: Response): string | undefined {
  return response.headers.get('set-cookie')?.split(';')[0];
}

async function lines(): Promise<
  { cart_id: string; variant_id: string; quantity: number }[]
> {
  const { results } = await db()
    .prepare(
      'SELECT cart_id, variant_id, quantity FROM p_shop_cart_line ORDER BY variant_id',
    )
    .all<{ cart_id: string; variant_id: string; quantity: number }>();
  return results;
}

async function cartCount(): Promise<number> {
  const row = await db()
    .prepare('SELECT COUNT(*) AS n FROM p_shop_cart')
    .first<{ n: number }>();
  return row?.n ?? 0;
}

describe('POST /_mallok/p/shop/cart/update', () => {
  beforeAll(async () => {
    await ensureSite();
    valve = await createProduct({
      title: 'Stainless ball valve',
      slug: 'route-ball-valve',
    });
    draft = await createProduct({
      title: 'Unreleased valve',
      slug: 'route-unreleased',
      status: 'draft',
    });
  });

  beforeEach(async () => {
    await clearShopTables();
    await createVariant({
      id: 'dn50',
      productGroup: valve.translationGroup,
      moq: 10,
      stock: 100,
    });
  });

  it('adds a line, sets a cart cookie and sends the buyer to the cart', async () => {
    const response = await post({ variant: 'dn50', quantity: '10' });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(CART);
    expect(cartCookie(response)).toMatch(/^nundar_cart=[0-9a-f]{32}$/);
    expect(await lines()).toMatchObject([{ variant_id: 'dn50', quantity: 10 }]);
  });

  it('sends the buyer to the cart in the language of the page they came from', async () => {
    const response = await post(
      { variant: 'dn50', quantity: '10' },
      undefined,
      'de',
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/_mallok/p/shop/de/cart');
  });

  it('sends the buyer back where the form says, when it says', async () => {
    const response = await post({
      variant: 'dn50',
      quantity: '10',
      return: '/products/route-ball-valve',
    });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/products/route-ball-valve');
  });

  it('scopes the cookie to the plugin’s path so public pages stay cacheable', async () => {
    const response = await post({ variant: 'dn50', quantity: '10' });
    const header = response.headers.get('set-cookie') ?? '';

    expect(header).toMatch(/^nundar_cart=[0-9a-f]{32};/);
    expect(header).toContain('Path=/_mallok/p/shop');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Secure');
    expect(header).toContain('Max-Age=2592000');
  });

  it('is never cached', async () => {
    const response = await post({ variant: 'dn50', quantity: '10' });
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('refuses a quantity below the MOQ even when the form is bypassed', async () => {
    // The page's quantity field enforces `min` in the browser. A direct POST
    // skips that, so the server has to say no itself.
    const response = await post({ variant: 'dn50', quantity: '9' });

    expect(response.status).toBe(422);
    // Told on the cart page: the SKU that was asked for, and its minimum.
    const { kind, text } = await refusal(response);
    expect(kind).toBe('below_moq');
    expect(text).toContain('SKU-dn50');
    expect(text).toMatch(/\b10\b/);
    expect(await lines()).toEqual([]);
    // A refused request must not leave an empty cart behind either.
    expect(await cartCount()).toBe(0);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('adds to the quantity already in the cart', async () => {
    const first = await post({ variant: 'dn50', quantity: '10' });
    const cookie = cartCookie(first);

    await post({ variant: 'dn50', quantity: '5' }, cookie);

    expect(await lines()).toMatchObject([{ variant_id: 'dn50', quantity: 15 }]);
    expect(await cartCount()).toBe(1);
  });

  it('sets an absolute quantity, and refuses one below the MOQ', async () => {
    const first = await post({ variant: 'dn50', quantity: '10' });
    const cookie = cartCookie(first);

    await post({ action: 'set', variant: 'dn50', quantity: '40' }, cookie);
    expect(await lines()).toMatchObject([{ quantity: 40 }]);

    const tooFew = await post(
      { action: 'set', variant: 'dn50', quantity: '3' },
      cookie,
    );
    expect(tooFew.status).toBe(422);
    expect((await refusal(tooFew)).kind).toBe('below_moq');
    expect(await lines()).toMatchObject([{ quantity: 40 }]);
  });

  it('removes a line', async () => {
    const first = await post({ variant: 'dn50', quantity: '10' });
    const cookie = cartCookie(first);

    const removed = await post({ action: 'remove', variant: 'dn50' }, cookie);

    expect(removed.status).toBe(303);
    expect(await lines()).toEqual([]);
  });

  it('creates no cart when asked to remove from one that does not exist', async () => {
    const response = await post({ action: 'remove', variant: 'dn50' });

    expect(response.status).toBe(303);
    expect(await cartCount()).toBe(0);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('refuses more than the stock of a tracked variant', async () => {
    const response = await post({ variant: 'dn50', quantity: '101' });

    expect(response.status).toBe(422);
    const { kind, text } = await refusal(response);
    expect(kind).toBe('insufficient_stock');
    // How many can be had: said to the one buyer asking, on a page that is
    // theirs alone and never cached.
    expect(text).toMatch(/\b100\b/);
    expect(await lines()).toEqual([]);
  });

  it('counts what is already in the cart against the stock', async () => {
    const first = await post({ variant: 'dn50', quantity: '60' });

    const second = await post(
      { variant: 'dn50', quantity: '60' },
      cartCookie(first),
    );

    expect(second.status).toBe(422);
    expect((await refusal(second)).kind).toBe('insufficient_stock');
    expect(await lines()).toMatchObject([{ quantity: 60 }]);
  });

  it('lets a made-to-order variant be ordered beyond its stock', async () => {
    await createVariant({
      id: 'custom',
      productGroup: valve.translationGroup,
      stock: 0,
      stockPolicy: 'made_to_order',
    });

    const response = await post({ variant: 'custom', quantity: '500' });

    expect(response.status).toBe(303);
    expect(await lines()).toMatchObject([
      { variant_id: 'custom', quantity: 500 },
    ]);
  });

  it('refuses an unknown, an archived and an unpublished variant alike', async () => {
    await createVariant({
      id: 'old',
      productGroup: valve.translationGroup,
      status: 'archived',
    });
    await createVariant({ id: 'secret', productGroup: draft.translationGroup });

    for (const variant of ['ghost', 'old', 'secret']) {
      const response = await post({ variant, quantity: '1' });
      expect(response.status).toBe(409);
      expect((await refusal(response)).kind).toBe('unavailable');
    }
    expect(await lines()).toEqual([]);
    expect(await cartCount()).toBe(0);
  });

  it('refuses an absurd quantity', async () => {
    await createVariant({
      id: 'bulk',
      productGroup: valve.translationGroup,
      stockPolicy: 'made_to_order',
    });

    const response = await post({ variant: 'bulk', quantity: '10001' });

    expect(response.status).toBe(422);
    const { kind, text } = await refusal(response);
    expect(kind).toBe('quantity_too_large');
    expect(text).toMatch(/\b10000\b/);
  });

  it('refuses one more kind of part than a cart may hold', async () => {
    const first = await post({ variant: 'dn50', quantity: '10' });
    const cookie = cartCookie(first);
    const cartId = cookie?.split('=')[1] ?? '';
    // A cart at its limit, filled directly: a hundred requests would say
    // nothing more.
    await db().batch(
      Array.from({ length: 99 }, (_, index) =>
        db()
          .prepare(
            'INSERT INTO p_shop_cart_line (cart_id, variant_id, quantity) VALUES (?, ?, 1)',
          )
          .bind(cartId, `filler-${index}`),
      ),
    );
    await createVariant({ id: 'extra', productGroup: valve.translationGroup });

    const response = await post({ variant: 'extra', quantity: '1' }, cookie);

    expect(response.status).toBe(422);
    expect((await refusal(response)).kind).toBe('cart_full');
    // A part already in the cart can still be given another quantity.
    const more = await post(
      { action: 'set', variant: 'dn50', quantity: '20' },
      cookie,
    );
    expect(more.status).toBe(303);
  });

  it('refuses malformed input', async () => {
    for (const fields of [
      { variant: 'dn50', quantity: 'ten' },
      { variant: 'dn50', quantity: '-5' },
      { variant: 'dn50', quantity: '1.5' },
      { variant: '', quantity: '10' },
      { quantity: '10' },
      { action: 'steal', variant: 'dn50', quantity: '10' },
      { action: 'currency', currency: 'JPY' },
      { action: 'currency' },
    ]) {
      const response = await post(fields);
      expect(response.status).toBe(400);
    }
    expect(await lines()).toEqual([]);
  });

  it('records the language and currency the buyer was browsing in', async () => {
    await post(
      { variant: 'dn50', quantity: '10', currency: 'GBP' },
      undefined,
      'de',
    );

    const cart = await db()
      .prepare('SELECT locale, currency FROM p_shop_cart')
      .first<{ locale: string; currency: string }>();
    expect(cart).toEqual({ locale: 'de', currency: 'GBP' });
  });

  it('starts a cart in its language’s currency: USD for English, EUR otherwise', async () => {
    await post({ variant: 'dn50', quantity: '10' }, undefined, 'de');
    const german = await db()
      .prepare('SELECT currency FROM p_shop_cart')
      .first<{ currency: string }>();
    expect(german?.currency).toBe('EUR');

    await clearShopTables();
    await createVariant({ id: 'dn50', productGroup: valve.translationGroup });
    await post({ variant: 'dn50', quantity: '10' });
    const english = await db()
      .prepare('SELECT currency FROM p_shop_cart')
      .first<{ currency: string }>();
    expect(english?.currency).toBe('USD');
  });

  it('starts a cart in its language’s currency when the form names one it does not know', async () => {
    await post({ variant: 'dn50', quantity: '10', currency: 'JPY' });

    const cart = await db()
      .prepare('SELECT locale, currency FROM p_shop_cart')
      .first<{ locale: string; currency: string }>();
    expect(cart).toEqual({ locale: 'en', currency: 'USD' });
  });

  it('keeps a cart’s currency when a later change names none', async () => {
    const first = await post({
      variant: 'dn50',
      quantity: '10',
      currency: 'GBP',
    });

    // The cart page's own forms name no currency: only what changes.
    await post(
      { action: 'set', variant: 'dn50', quantity: '20' },
      cartCookie(first),
      'de',
    );

    const cart = await db()
      .prepare('SELECT currency FROM p_shop_cart')
      .first<{ currency: string }>();
    expect(cart?.currency).toBe('GBP');
  });

  it('changes the currency a cart is shown in', async () => {
    const first = await post({ variant: 'dn50', quantity: '10' });

    const response = await post(
      { action: 'currency', currency: 'EUR' },
      cartCookie(first),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(CART);
    const cart = await db()
      .prepare('SELECT currency FROM p_shop_cart')
      .first<{ currency: string }>();
    expect(cart?.currency).toBe('EUR');
    expect(await lines()).toMatchObject([{ variant_id: 'dn50', quantity: 10 }]);
  });

  it('creates no cart for a visitor who only chooses a currency', async () => {
    const response = await post({ action: 'currency', currency: 'EUR' });

    expect(response.status).toBe(303);
    expect(await cartCount()).toBe(0);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('creates no cart for a cookie that names one which does not exist', async () => {
    // A cart that expired, or an id made up: well formed, and nobody's.
    const response = await post(
      { action: 'currency', currency: 'EUR' },
      'nundar_cart=0123456789abcdef0123456789abcdef',
    );

    expect(response.status).toBe(303);
    expect(await cartCount()).toBe(0);
  });

  it('is not there under a language the site does not have', async () => {
    const response = await post(
      { variant: 'dn50', quantity: '10' },
      undefined,
      'xx',
    );

    expect(response.status).toBe(404);
    expect(await cartCount()).toBe(0);
  });

  it('only ever redirects to a path on this site', async () => {
    for (const target of [
      'https://evil.example/',
      '//evil.example/',
      '/\\evil.example',
      'javascript:alert(1)',
      'evil',
    ]) {
      const response = await post({
        variant: 'dn50',
        quantity: '10',
        return: target,
      });
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe(CART);
    }
  });

  it('ignores a cart cookie that is not a cart id', async () => {
    const response = await post(
      { variant: 'dn50', quantity: '10' },
      "nundar_cart=' OR 1=1 --",
    );

    expect(response.status).toBe(303);
    // A fresh, well-formed id was issued instead of trusting the cookie.
    expect(cartCookie(response)).toMatch(/^nundar_cart=[0-9a-f]{32}$/);
    expect(await cartCount()).toBe(1);
  });
});
