import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  api,
  createContent,
  createVariant,
  db,
  ensureSite,
  ORIGIN,
  setPrice,
} from '../shop/helpers.js';

/**
 * The editorial theme on a site that has filled in almost nothing, as
 * `test/theme/bare.test.ts` holds the commerce theme: options left empty, a
 * product that is a title and no more, a reference that names nothing, a
 * cart line whose size has since been deleted. Each has to leave a whole
 * page — no empty box, no cell with nothing in it, no link to nowhere.
 */

const SHOP = '/_mallok/p/shop';

async function page(
  path: string,
  cookie?: string,
): Promise<{ status: number; html: string }> {
  const response = await SELF.fetch(`${ORIGIN}${path}`, {
    headers: cookie === undefined ? {} : { cookie },
  });
  return { status: response.status, html: await response.text() };
}

function between(html: string, start: string, end: string): string {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from + start.length);
  return from === -1 ? '' : html.slice(from, to === -1 ? undefined : to);
}

/** Elements that hold nothing: the trace a value leaves when it is missing. */
function emptyElements(html: string): string[] {
  return [
    ...html.matchAll(
      /<(div|p|aside|section|nav|dl|ul|li|h1|h2|h3|dd|dt|th|td|span|label|figure|table|tbody)\b[^>]*>\s*<\/\1>/g,
    ),
  ].map((match) => match[0]);
}

function expectWhole(path: string, html: string): void {
  const main = between(html, '<main', '</main>');
  expect(emptyElements(main), path).toEqual([]);
  expect(emptyElements(between(html, '<footer', '</footer>')), path).toEqual(
    [],
  );
  expect(html, path).not.toMatch(/href=""/);
  // A picture is drawn only when there is one.
  expect(html, path).not.toMatch(/src=""/);
  const headings = [...main.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)];
  expect(headings, path).toHaveLength(1);
  expect(headings[0]?.[1]?.trim(), path).not.toBe('');
}

const PAGES = [
  '/',
  '/de/',
  '/products',
  '/products/bare-screw',
  '/collections/bare-collection',
  '/industries/bare-industry',
  '/case-studies/bare-case',
  '/faq',
  '/faq/bare-questions',
  '/tools/bare-tool',
  '/news',
  '/bare-page',
  '/products/specified-screw',
  '/industries/measured-industry',
  '/case-studies/case-with-a-part',
];

let cartCookie = '';

beforeAll(async () => {
  await ensureSite();

  const options = await api('PATCH', '/_mallok/api/settings', {
    themeOptions: {
      hero_title: '',
      hero_lede: '',
      quote_href: '',
      contact_href: '',
      prop_2_title: 'Standard packs',
    },
  });
  if (!options.ok) {
    throw new Error(`Theme options were refused: ${await options.text()}`);
  }

  const bare = await createContent({
    kind: 'product',
    title: 'Bare screw',
    slug: 'bare-screw',
    body: '',
  });
  await createContent({
    kind: 'collection',
    title: 'Bare collection',
    slug: 'bare-collection',
    body: '',
  });
  await createContent({
    kind: 'application',
    title: 'Bare industry',
    slug: 'bare-industry',
    frontmatter: 'product: no-such-product',
    body: '',
  });
  await createContent({
    kind: 'case',
    title: 'Bare case',
    slug: 'bare-case',
    frontmatter: 'sector: ""',
    body: '',
  });
  await createContent({
    kind: 'faq',
    title: 'Bare questions',
    slug: 'bare-questions',
    body: '',
  });
  await createContent({
    kind: 'product',
    title: 'Specified screw',
    slug: 'specified-screw',
    frontmatter: ['specs:', '  Tensile strength: 895 MPa'].join('\n'),
    body: '',
  });
  await createContent({
    kind: 'application',
    title: 'Measured industry',
    slug: 'measured-industry',
    frontmatter: [
      'product: no-such-product',
      'spec_highlights:',
      '  Shock load: 12g',
    ].join('\n'),
    body: '',
  });
  await createContent({
    kind: 'case',
    title: 'Case with a part',
    slug: 'case-with-a-part',
    frontmatter: 'product: bare-screw',
    body: '',
  });
  await createContent({
    kind: 'tool',
    title: 'Bare tool',
    slug: 'bare-tool',
    body: '',
  });
  await createContent({
    kind: 'page',
    title: 'Bare page',
    slug: 'bare-page',
    body: '',
  });

  // A size of the bare product — which names no sizes in its front matter —
  // put in a cart, and then deleted: the line stays, with no SKU and no
  // name of its own.
  await createVariant({
    id: 'gone',
    productGroup: bare.translationGroup,
    sku: 'GONE-1',
    moq: 1,
    stock: 100,
  });
  await setPrice({
    variantId: 'gone',
    currency: 'USD',
    amountMinor: 120,
    source: 'base',
  });
  const added = await SELF.fetch(`${ORIGIN}${SHOP}/cart/update`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ variant: 'gone', quantity: '5' }).toString(),
    redirect: 'manual',
  });
  cartCookie = added.headers.get('set-cookie')?.split(';')[0] ?? '';
  await db().batch([
    db().prepare("DELETE FROM p_shop_price WHERE variant_id = 'gone'"),
    db().prepare("DELETE FROM p_shop_variant WHERE id = 'gone'"),
  ]);
});

describe('the editorial theme with almost nothing filled in', () => {
  it.each(PAGES)('draws %s whole', async (path) => {
    const { status, html } = await page(path);

    expect(status).toBe(200);
    expectWhole(path, html);
  });

  it('lists a product that names no sizes with a dash where its sizes would be', async () => {
    const { html } = await page('/products');
    const row = between(html, 'href="/products/bare-screw"', '</tr>');

    expect(row).toContain('data-label="Sizes">—</td>');
  });

  it('draws a cart whose size has since been deleted', async () => {
    expect(cartCookie).not.toBe('');
    const { status, html } = await page(`${SHOP}/cart`, cartCookie);

    expect(status).toBe(200);
    expectWhole('cart', html);
    expect(html).toContain('data-problem="unavailable"');
  });

  it.each([
    'asking',
    '?sent=1',
    `?t=${'A'.repeat(43)}`,
    '?lookup=too_many',
    '?lookup=invalid',
  ])('draws the page a buyer finds their orders on, %s', async (query) => {
    const path = `${SHOP}/orders${query === 'asking' ? '' : query}`;
    const { status, html } = await page(path);

    expect(status).toBe(200);
    expectWhole(path, html);
  });
});
