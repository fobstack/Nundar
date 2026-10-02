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

/** Posts the form a product page would post, optionally with a cart cookie. */
function post(
  fields: Record<string, string>,
  cookie?: string,
): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/_mallok/p/shop/cart`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(cookie === undefined ? {} : { cookie }),
    },
    body: new URLSearchParams(fields).toString(),
    redirect: 'manual',
  });
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

describe('POST /_mallok/p/shop/cart', () => {
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

  it('adds a line, sets a cart cookie and sends the buyer back', async () => {
    const response = await post({
      variant: 'dn50',
      quantity: '10',
      return: '/products/route-ball-valve',
    });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/products/route-ball-valve');
    expect(await lines()).toMatchObject([{ variant_id: 'dn50', quantity: 10 }]);
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
    expect(await response.json()).toEqual({
      error: 'below_moq',
      variantId: 'dn50',
      moq: 10,
      requested: 9,
    });
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
    expect(await response.json()).toMatchObject({
      error: 'insufficient_stock',
      available: 100,
      requested: 101,
    });
  });

  it('counts what is already in the cart against the stock', async () => {
    const first = await post({ variant: 'dn50', quantity: '60' });

    const second = await post(
      { variant: 'dn50', quantity: '60' },
      cartCookie(first),
    );

    expect(second.status).toBe(422);
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
      expect(await response.json()).toMatchObject({ error: 'unavailable' });
    }
    expect(await lines()).toEqual([]);
  });

  it('refuses an absurd quantity', async () => {
    await createVariant({
      id: 'bulk',
      productGroup: valve.translationGroup,
      stockPolicy: 'made_to_order',
    });

    const response = await post({ variant: 'bulk', quantity: '10001' });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: 'quantity_too_large',
    });
  });

  it('refuses malformed input', async () => {
    for (const fields of [
      { variant: 'dn50', quantity: 'ten' },
      { variant: 'dn50', quantity: '-5' },
      { variant: 'dn50', quantity: '1.5' },
      { variant: '', quantity: '10' },
      { action: 'steal', variant: 'dn50', quantity: '10' },
    ]) {
      const response = await post(fields);
      expect(response.status).toBe(400);
    }
    expect(await lines()).toEqual([]);
  });

  it('records the language and currency the buyer was browsing in', async () => {
    await post({
      variant: 'dn50',
      quantity: '10',
      locale: 'de',
      currency: 'GBP',
    });

    const cart = await db()
      .prepare('SELECT locale, currency FROM p_shop_cart')
      .first<{ locale: string; currency: string }>();
    expect(cart).toEqual({ locale: 'de', currency: 'GBP' });
  });

  it('defaults the currency from the language: USD for English, EUR otherwise', async () => {
    await post({ variant: 'dn50', quantity: '10', locale: 'de' });
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

  it('falls back to defaults for a language or currency it does not know', async () => {
    await post({
      variant: 'dn50',
      quantity: '10',
      locale: 'xx',
      currency: 'JPY',
    });

    const cart = await db()
      .prepare('SELECT locale, currency FROM p_shop_cart')
      .first<{ locale: string; currency: string }>();
    expect(cart).toEqual({ locale: 'en', currency: 'USD' });
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
      expect(response.headers.get('location')).toBe('/');
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
