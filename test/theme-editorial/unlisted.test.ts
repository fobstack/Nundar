import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  api,
  createProduct,
  createVariant,
  ensureSite,
  ORIGIN,
  setPrice,
} from '../shop/helpers.js';

/**
 * The editorial theme on a site that serves its products with no list page
 * and takes no payments: a cart then has neither a way back to a catalogue
 * nor a way to checkout, and must not keep an empty place for them.
 */

const SHOP = '/_mallok/p/shop';

let cookie = '';

beforeAll(async () => {
  await ensureSite();
  const settings = await api('PATCH', '/_mallok/api/settings', {
    kinds: {
      page: { base: '' },
      article: { base: 'news' },
      product: { base: '' },
      collection: { base: 'collections' },
      application: { base: 'industries' },
      case: { base: 'case-studies' },
      faq: { base: 'faq' },
      tool: { base: 'tools' },
    },
  });
  if (!settings.ok) {
    throw new Error(`Settings were refused: ${await settings.text()}`);
  }
  const screw = await createProduct({
    title: 'Unlisted screw',
    slug: 'unlisted-screw',
  });
  await createVariant({
    id: 'unlisted',
    productGroup: screw.translationGroup,
    sku: 'UL-1',
    moq: 1,
    stock: 100,
  });
  await setPrice({
    variantId: 'unlisted',
    currency: 'USD',
    amountMinor: 250,
    source: 'base',
  });
  const added = await SELF.fetch(`${ORIGIN}${SHOP}/cart/update`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      variant: 'unlisted',
      quantity: '4',
    }).toString(),
    redirect: 'manual',
  });
  cookie = added.headers.get('set-cookie')?.split(';')[0] ?? '';
});

describe('a cart on a site with no list of products and no payments', () => {
  it('offers neither, and keeps no empty place for them', async () => {
    const response = await SELF.fetch(`${ORIGIN}${SHOP}/cart`, {
      headers: { cookie },
    });
    const html = await response.text();
    const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));

    expect(response.status).toBe(200);
    expect(main).toContain('UL-1');
    expect(main).not.toContain(`${SHOP}/checkout`);
    expect(main).not.toMatch(/<p>\s*<\/p>/);
    expect(html).not.toMatch(/href=""/);
  });
});
