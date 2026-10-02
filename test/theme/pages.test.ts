import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { createContent, ensureSite, ORIGIN } from '../shop/helpers.js';

/**
 * The theme, rendered by the real Worker.
 *
 * Content is created through Mallok's management API and pages are requested
 * the way a visitor requests them, so these check what a buyer and a crawler
 * actually receive.
 */

async function page(path: string): Promise<{ status: number; html: string }> {
  const response = await SELF.fetch(`${ORIGIN}${path}`);
  return { status: response.status, html: await response.text() };
}

/** Every `<script>` that is not structured data. */
function executableScripts(html: string): string[] {
  return [...html.matchAll(/<script\b[^>]*>/gi)]
    .map((match) => match[0])
    .filter((tag) => !/type=["']application\/ld\+json["']/i.test(tag));
}

describe('the commerce theme', () => {
  beforeAll(async () => {
    await ensureSite();

    // Everything is created before any page is requested, so no page is
    // cached before the content it links to exists.
    const collection = await createContent({
      kind: 'collection',
      title: 'High-temperature valves',
      slug: 'high-temperature-valves',
      frontmatter:
        'description: Valves rated for sustained service above 150 °C.',
      body: 'Compare the valves in the range that hold their rating at temperature.',
    });
    await createContent({
      kind: 'collection',
      title: 'Hochtemperatur-Armaturen',
      slug: 'hochtemperatur-armaturen',
      locale: 'de',
      translationGroup: collection.translationGroup,
    });

    const product = await createContent({
      kind: 'product',
      title: 'Stainless ball valve DN50',
      slug: 'stainless-ball-valve-dn50',
      frontmatter: [
        'description: A 316L ball valve for corrosive service.',
        'material: 316L stainless steel',
        'standard: EN 10204 3.1',
        'collection: high-temperature-valves',
        'specs:',
        '  Pressure rating: PN40',
        '  Temperature range: -20 to 200 °C',
      ].join('\n'),
      body: '## Why this valve\n\nFull bore, fire-safe seats.\n',
    });
    await createContent({
      kind: 'product',
      title: 'Edelstahl-Kugelhahn DN50',
      slug: 'edelstahl-kugelhahn-dn50',
      locale: 'de',
      translationGroup: product.translationGroup,
      frontmatter: 'collection: hochtemperatur-armaturen',
    });

    const application = await createContent({
      kind: 'application',
      title: 'Ball valves for offshore seawater lines',
      slug: 'offshore-seawater-lines',
      frontmatter: [
        'description: Why 316L and a fire-safe seat matter on a platform.',
        'product: stainless-ball-valve-dn50',
        'spec_highlights:',
        '  Chloride resistance: PREN 24',
      ].join('\n'),
      body: 'Seawater attacks ordinary stainless within a season.',
    });
    await createContent({
      kind: 'application',
      title: 'Kugelhähne für Offshore-Seewasserleitungen',
      slug: 'offshore-seewasserleitungen',
      locale: 'de',
      translationGroup: application.translationGroup,
      frontmatter: 'product: edelstahl-kugelhahn-dn50',
    });

    await createContent({
      kind: 'product',
      title: 'Valve <b>with markup</b> & an ampersand',
      slug: 'markup-in-title',
    });
  });

  describe('a product page', () => {
    it('renders in the default language without a locale prefix', async () => {
      const { status, html } = await page(
        '/products/stainless-ball-valve-dn50',
      );

      expect(status).toBe(200);
      expect(html).toContain('<html lang="en">');
      expect(html).toContain(
        '<h1 class="detail-title">Stainless ball valve DN50</h1>',
      );
      expect(html).toContain('A 316L ball valve for corrosive service.');
      expect(html).toContain('Full bore, fire-safe seats.');
    });

    it('shows the specifications as a table', async () => {
      const { html } = await page('/products/stainless-ball-valve-dn50');

      expect(html).toContain(
        '<th scope="row">Pressure rating</th><td>PN40</td>',
      );
      expect(html).toContain('316L stainless steel');
      expect(html).toContain('EN 10204 3.1');
    });

    it('links to the application notes written about it', async () => {
      const { html } = await page('/products/stainless-ball-valve-dn50');

      expect(html).toContain('href="/applications/offshore-seawater-lines"');
      expect(html).toContain('Ball valves for offshore seawater lines');
    });

    it('links back to its collection in the breadcrumb', async () => {
      const { html } = await page('/products/stainless-ball-valve-dn50');

      expect(html).toContain(
        '<a href="/collections/high-temperature-valves">High-temperature valves</a>',
      );
    });

    it('carries a self-referencing canonical and hreflang for each language it exists in', async () => {
      const { html } = await page('/products/stainless-ball-valve-dn50');

      expect(html).toContain(
        `<link rel="canonical" href="${ORIGIN}/products/stainless-ball-valve-dn50">`,
      );
      expect(html).toMatch(
        /hreflang="de"[^>]*href="[^"]*\/de\/products\/edelstahl-kugelhahn-dn50"|href="[^"]*\/de\/products\/edelstahl-kugelhahn-dn50"[^>]*hreflang="de"/,
      );
      expect(html).toContain('hreflang="x-default"');
    });

    it('leaves a language it is not translated into out of hreflang', async () => {
      // The product exists in English and German only. Pointing French at
      // another language's URL would send a crawler to the wrong page.
      const { html } = await page('/products/stainless-ball-valve-dn50');

      expect(html).not.toContain('hreflang="fr"');
      expect(html).not.toContain('hreflang="es"');
    });

    it('sends no client JavaScript', async () => {
      const { html } = await page('/products/stainless-ball-valve-dn50');

      expect(executableScripts(html)).toEqual([]);
      expect(html).not.toMatch(/\son[a-z]+=/i);
    });

    it('loads the versioned stylesheet', async () => {
      const { html } = await page('/products/stainless-ball-valve-dn50');

      expect(html).toContain('href="/theme/nundar/0.1.0/style.css"');
    });

    it('escapes markup in a title instead of emitting it', async () => {
      const { html } = await page('/products/markup-in-title');

      expect(html).not.toContain('<b>with markup</b>');
      expect(html).toContain('&lt;b&gt;with markup&lt;/b&gt;');
    });
  });

  describe('the German version', () => {
    it('lives under /de/ with its own slug and German interface strings', async () => {
      const { status, html } = await page(
        '/de/products/edelstahl-kugelhahn-dn50',
      );

      expect(status).toBe(200);
      expect(html).toContain('<html lang="de">');
      expect(html).toContain('Edelstahl-Kugelhahn DN50');
      expect(html).toContain('Angebot anfordern');
      expect(html).toContain('Anwendungsnotiz');
    });

    it('links to the German application note by its German slug', async () => {
      const { html } = await page('/de/products/edelstahl-kugelhahn-dn50');

      expect(html).toContain(
        'href="/de/applications/offshore-seewasserleitungen"',
      );
      expect(html).not.toContain(
        'href="/applications/offshore-seawater-lines"',
      );
    });

    it('names each language in its own words in the switcher', async () => {
      const { html } = await page('/de/products/edelstahl-kugelhahn-dn50');

      expect(html).toContain('>English</a>');
      expect(html).toContain('>Deutsch</a>');
    });
  });

  describe('an application note', () => {
    it('is its own page with its own canonical, not the product’s', async () => {
      const { status, html } = await page(
        '/applications/offshore-seawater-lines',
      );

      expect(status).toBe(200);
      expect(html).toContain(
        `<link rel="canonical" href="${ORIGIN}/applications/offshore-seawater-lines">`,
      );
      expect(html).toContain('Application note');
      expect(html).toContain(
        'Seawater attacks ordinary stainless within a season.',
      );
    });

    it('points at the product it discusses', async () => {
      const { html } = await page('/applications/offshore-seawater-lines');

      expect(html).toContain('href="/products/stainless-ball-valve-dn50"');
      expect(html).toContain('The part discussed here');
      expect(html).toContain(
        '<th scope="row">Chloride resistance</th><td>PREN 24</td>',
      );
    });

    it('resolves hreflang to the German note’s own slug', async () => {
      const { html } = await page('/applications/offshore-seawater-lines');

      expect(html).toContain('/de/applications/offshore-seewasserleitungen');
    });
  });

  describe('a collection page', () => {
    it('lists the products that name it', async () => {
      const { status, html } = await page(
        '/collections/high-temperature-valves',
      );

      expect(status).toBe(200);
      expect(html).toContain('High-temperature valves');
      expect(html).toContain('href="/products/stainless-ball-valve-dn50"');
      expect(html).toContain('Products in this collection');
    });
  });

  describe('the home and list pages', () => {
    // Mallok 0.1.0-rc.7 supplies the home page with recent articles only,
    // although its theme format documents `recent.<kind>` for every kind. The
    // template's product and application sections are written to that
    // contract and appear once Mallok fills them in; until then the home page
    // leads with the headline and the navigation.
    it('leads with the headline and links to the catalogue', async () => {
      const { status, html } = await page('/');

      expect(status).toBe(200);
      expect(html).toContain('<html lang="en">');
      expect(html).toContain('class="hero-title"');
      expect(html).toContain('<a href="/products">Products</a>');
      expect(html).toContain('Request a quote');
    });

    it('serves the German home page under /de/', async () => {
      const { status, html } = await page('/de/');

      expect(status).toBe(200);
      expect(html).toContain('<html lang="de">');
      expect(html).toContain('<a href="/de/products">Produkte</a>');
      expect(html).toContain('Angebot anfordern');
    });

    it('lists products', async () => {
      const { status, html } = await page('/products');

      expect(status).toBe(200);
      expect(html).toContain('href="/products/stainless-ball-valve-dn50"');
    });
  });

  describe('a missing page', () => {
    it('answers 404 inside the theme, in the visitor’s language', async () => {
      const { status, html } = await page('/de/products/gibt-es-nicht');

      expect(status).toBe(404);
      expect(html).toContain('Seite nicht gefunden');
      expect(html).toContain('href="/theme/nundar/0.1.0/style.css"');
    });
  });
});
