import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, createContent, ensureSite, ORIGIN } from '../shop/helpers.js';

/**
 * The theme on a site that has filled in almost nothing.
 *
 * `pages.test.ts` renders every layout with everything set. A site owner
 * starts from the other end: options left empty, a product that is a title
 * and no more, a reference that names nothing. Each of those has to leave a
 * whole page — no empty box where a section would have been, no link that
 * goes nowhere.
 */

async function page(path: string): Promise<{ status: number; html: string }> {
  const response = await SELF.fetch(`${ORIGIN}${path}`);
  return { status: response.status, html: await response.text() };
}

function between(html: string, start: string, end: string): string {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from + start.length);
  return from === -1 ? '' : html.slice(from, to === -1 ? undefined : to);
}

/** Elements that hold nothing: the trace a section leaves when its content is missing. */
function emptyElements(html: string): string[] {
  return [
    ...html.matchAll(
      /<(div|p|aside|section|nav|dl|ul|h1|h2|h3|figure|table|tbody)\b[^>]*>\s*<\/\1>/g,
    ),
  ].map((match) => match[0]);
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
  // A card beside a text that was never written.
  '/products/specified-screw',
  '/industries/measured-industry',
  '/case-studies/case-with-a-part',
];

describe('the theme with almost nothing filled in', () => {
  beforeAll(async () => {
    await ensureSite();

    // Every option that has a default the site owner can clear, cleared.
    const options = await api('PATCH', '/_mallok/api/settings', {
      themeOptions: {
        hero_title: '',
        hero_lede: '',
        quote_href: '',
        contact_href: '',
        catalogue_href: '',
        // One selling point, and not the first of the three.
        prop_2_title: 'Standard packs',
      },
    });
    if (!options.ok) {
      throw new Error(`Theme options were refused: ${await options.text()}`);
    }

    await createContent({
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
    // The product it names does not exist: a slug left over from another
    // language, which is the mistake `test/content.test.ts` exists for.
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
    // Three pages with something for the card beside the text, and no text.
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
  });

  it.each(PAGES)('renders %s', async (path) => {
    const { status } = await page(path);

    expect(status).toBe(200);
  });

  it.each(PAGES)('leaves no empty box on %s', async (path) => {
    const { html } = await page(path);

    expect(emptyElements(between(html, '<main', '</main>'))).toEqual([]);
    expect(emptyElements(between(html, '<footer', '</footer>'))).toEqual([]);
  });

  it.each(PAGES)('leaves no link without an address on %s', async (path) => {
    const { html } = await page(path);

    expect(html).not.toMatch(/href=""/);
  });

  it.each(PAGES)(
    'gives %s one main heading, with words in it',
    async (path) => {
      const { html } = await page(path);
      const headings = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)];

      expect(headings).toHaveLength(1);
      expect(headings[0]?.[1]?.trim()).not.toBe('');
    },
  );

  describe('the home page', () => {
    it('falls back to the site’s name for its headline', async () => {
      const { html } = await page('/');
      const name = /<a class="brand" href="\/">([^<]+)<\/a>/.exec(html)?.[1];

      expect(name).toBeDefined();
      expect(html).toContain(`<h1 class="hero-title">${name}</h1>`);
    });

    it('shows a selling point that is the only one written, whichever it is', async () => {
      const { html } = await page('/');
      const props = between(html, '<div class="props">', '</section>');

      expect(props).toContain('<h2>Standard packs</h2>');
      expect(props.match(/class="prop"/g)).toHaveLength(1);
    });

    it('shows none of the sections nobody wrote', async () => {
      const { html } = await page('/');

      expect(html).not.toContain('class="panel split"');
      expect(html).not.toContain('class="assure"');
      expect(html).not.toContain('class="closing"');
      expect(html).not.toContain('class="finder-more"');
    });

    it('gives the case studies the whole row when there is no quality panel', async () => {
      const { html } = await page('/');

      expect(html).toContain('href="/case-studies/bare-case"');
      expect(html).not.toContain('class="shell proof"');
    });

    it('has nothing to jump to, and no button for it, in a language with no products', async () => {
      const { html } = await page('/de/');

      expect(html).not.toContain('specification-finder');
      expect(html).not.toContain('class="hero-actions"><');
    });
  });

  describe('the header and the footer', () => {
    it('show no button and no contact link that would lead nowhere', async () => {
      const { html } = await page('/bare-page');

      expect(between(html, '<header', '</header>')).not.toContain('class="btn');
      expect(between(html, '<footer', '</footer>')).not.toContain(
        'class="footer-cta"',
      );
    });
  });

  describe('a product that is a title and no more', () => {
    it('shows no attribute list, size table, specification or pictures', async () => {
      const { html } = await page('/products/bare-screw');

      expect(html).toContain('<h1 class="detail-title">Bare screw</h1>');
      expect(html).toContain('<div class="product-top product-top-plain">');
      expect(html).not.toContain('class="facet-list"');
      expect(html).not.toContain('class="size-list"');
      expect(html).not.toContain('class="spec-card specs"');
      expect(html).not.toContain('class="gallery"');
      expect(html).not.toContain('class="buy-actions"');
    });

    it('still has a row in the catalogue, under headings it does not fill', async () => {
      // No product has attributes, so the table has no attribute columns.
      const { html } = await page('/products');
      const cells = [
        ...between(html, '<thead', '</thead>').matchAll(/role="columnheader"/g),
      ];

      expect(html).toContain('href="/products/bare-screw"');
      expect(cells).toHaveLength(3);
    });
  });

  describe('a page with a card and no text', () => {
    it.each([
      ['/products/specified-screw', 'Tensile strength'],
      ['/industries/measured-industry', 'Shock load'],
      ['/case-studies/case-with-a-part', 'href="/products/bare-screw"'],
    ])('shows the card on %s', async (path, inTheCard) => {
      const { html } = await page(path);

      expect(between(html, '<aside class="spec-card', '</aside>')).toContain(
        inTheCard,
      );
      expect(html).not.toContain('class="detail-main');
    });
  });

  describe('an industry page whose product does not exist', () => {
    it('has no card beside its text', async () => {
      const { html } = await page('/industries/bare-industry');

      expect(html).toContain('<h1 class="detail-title">Bare industry</h1>');
      expect(html).not.toContain('<aside');
    });
  });

  describe('a case study with an empty sector', () => {
    it('is labelled a case study', async () => {
      const { html } = await page('/case-studies/bare-case');

      expect(html).toContain('<p class="eyebrow">Case study</p>');
      expect(html).not.toContain('class="results"');
    });
  });

  describe('a collection with no products and no text', () => {
    it('says it is empty, and adds no box for the text', async () => {
      const { html } = await page('/collections/bare-collection');

      expect(html).toContain('<p class="empty">Nothing here yet.</p>');
      expect(html).not.toContain('class="prose more"');
    });
  });

  describe('a questions topic with no questions', () => {
    it('adds no list and no box for the text', async () => {
      const { html } = await page('/faq/bare-questions');

      expect(html).not.toContain('class="faq-list"');
      expect(html).not.toContain('class="prose more"');
    });
  });

  describe('a list of one page', () => {
    it.each(['/products', '/faq', '/news', '/tools'])(
      'has no pagination on %s',
      async (path) => {
        const { html } = await page(path);

        expect(html).not.toContain('class="pager"');
      },
    );
  });
});
