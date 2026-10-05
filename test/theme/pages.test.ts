import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import manifest from '../../src/theme/theme.json';
import {
  api,
  createContent,
  ensureSite,
  ORIGIN,
  testFile,
  uploadMedia,
} from '../shop/helpers.js';

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

/** The part of a page between two markers, so a check reads one section. */
function between(html: string, start: string, end: string): string {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from + start.length);
  return from === -1 ? '' : html.slice(from, to === -1 ? undefined : to);
}

/**
 * The `<head>` of a page. An address also appears in the body — the language
 * switcher links to every translation — so a check on hreflang has to look
 * here and nowhere else.
 */
function head(html: string): string {
  return between(html, '<head>', '</head>');
}

/**
 * Where this version of the theme's files are served. Read from the
 * manifest, because the version changes whenever a file does.
 */
const ASSETS = `/theme/${manifest.id}/${manifest.version}`;

const CAP_SCREW = '/products/titanium-socket-head-cap-screw-m5';
const CAP_SCREW_DE = '/de/products/titan-zylinderschraube-m5';

describe('the commerce theme', () => {
  beforeAll(async () => {
    await ensureSite();

    // The copy a site owner sets, and one language's override of it. A theme
    // option has one value for the site; `$locales` carries the exceptions.
    const options = await api('PATCH', '/_mallok/api/settings', {
      themeOptions: {
        tagline: 'Titanium fasteners',
        home_description: 'Find titanium fasteners by specification.',
        hero_title: 'Titanium fasteners, built to your drawing.',
        hero_badge: 'Grade 5 Ti-6Al-4V',
        prop_1_title: 'Exact specifications',
        prop_1_text: 'Clear dimensions and complete product details.',
        custom_title: 'Custom manufacturing capabilities',
        quality_1_title: 'Traceable material',
        quality_1_text: 'Every lot maps to a heat number.',
        cta_title: 'Discuss your component requirements.',
        footer_note: 'Sample catalogue.',
        contact_email: 'sales@example.com',
        quote_href: '/custom-manufacturing',
        contact_href: '/contact',
        terms_href: '/terms',
        $locales: {
          de: {
            tagline: 'Verbindungselemente aus Titan',
            home_description:
              'Titan-Verbindungselemente nach Spezifikation finden.',
            hero_title: 'Titan-Verbindungselemente nach Ihrer Zeichnung.',
            quote_href: '/de/sonderanfertigung',
            catalogue_href: '/de/products',
          },
        },
      },
    });
    if (!options.ok) {
      throw new Error(`Theme options were refused: ${await options.text()}`);
    }

    // Everything is created before any page is requested, so no page is
    // cached before the content it links to exists.
    const collection = await createContent({
      kind: 'collection',
      title: 'Socket head cap screws',
      slug: 'socket-head-cap-screws',
      frontmatter: 'description: Cylindrical heads with an internal hex drive.',
      body: 'Chosen where there is little room around the head.',
    });
    await createContent({
      kind: 'collection',
      title: 'Zylinderschrauben',
      slug: 'zylinderschrauben',
      locale: 'de',
      translationGroup: collection.translationGroup,
    });

    const product = await createContent({
      kind: 'product',
      title: 'M5 titanium socket head cap screw',
      slug: 'titanium-socket-head-cap-screw-m5',
      frontmatter: [
        'description: A Grade 5 titanium M5 cap screw in two lengths.',
        'collection: socket-head-cap-screws',
        'facets:',
        '  Head type: Socket head cap',
        '  Thread: M5 × 0.8',
        '  Material: Grade 5 titanium',
        'sizes:',
        '  TI-SHC-M5-10: 10 mm',
        '  TI-SHC-M5-16: 16 mm',
        'specs:',
        '  Tensile strength: 895 MPa',
        '  Material certificate: EN 10204 3.1',
      ].join('\n'),
      body: '## Why this fastener\n\nRolled threads, verified with ring gauges.\n',
    });
    await createContent({
      kind: 'product',
      title: 'M5 Titan-Zylinderschraube',
      slug: 'titan-zylinderschraube-m5',
      locale: 'de',
      translationGroup: product.translationGroup,
      frontmatter: [
        'collection: zylinderschrauben',
        'facets:',
        '  Kopfform: Zylinderkopf',
        '  Gewinde: M5 × 0,8',
        '  Werkstoff: Titan Grade 5',
        'sizes:',
        '  TI-SHC-M5-10: 10 mm',
      ].join('\n'),
    });
    // A second product, in English only and in no collection. It is the
    // one with pictures and a datasheet; the first path its gallery names is
    // of a file that was never uploaded.
    const [cover, detail, sheet] = await Promise.all([
      uploadMedia(testFile('cover.png', 1), 'cover.png'),
      uploadMedia(testFile('detail.png', 2), 'detail.png'),
      uploadMedia(testFile('sheet.pdf', 3), 'sheet.pdf'),
    ]);
    await createContent({
      kind: 'product',
      title: 'M6 titanium countersunk screw',
      slug: 'titanium-countersunk-screw-m6',
      frontmatter: [
        'cover: images/cover.png',
        'gallery:',
        '  - images/missing.png',
        '  - images/cover.png',
        '  - images/detail.png',
        'datasheet: files/sheet.pdf',
        'facets:',
        '  Head type: Countersunk',
        '  Thread: M6 × 1.0',
        '  Material: Grade 2 titanium',
        'sizes:',
        '  TI-CSK-M6-16: 16 mm',
      ].join('\n'),
      assets: {
        'images/cover.png': cover,
        'images/detail.png': detail,
        'files/sheet.pdf': sheet,
      },
    });
    await createContent({
      kind: 'product',
      title: 'Screw <b>with markup</b> & an ampersand',
      slug: 'markup-in-title',
    });

    const industry = await createContent({
      kind: 'application',
      title: 'Titanium fasteners for motorsport',
      slug: 'motorsport',
      frontmatter: [
        'description: Why unsprung mass decides the fastener.',
        'product: titanium-socket-head-cap-screw-m5',
        'spec_highlights:',
        '  Curb shock load: 12g',
      ].join('\n'),
      body: 'Every gram of unsprung mass costs grip.',
    });
    await createContent({
      kind: 'application',
      title: 'Titan-Verbindungselemente für den Rennsport',
      slug: 'rennsport',
      locale: 'de',
      translationGroup: industry.translationGroup,
      frontmatter: 'product: titan-zylinderschraube-m5',
    });
    await createContent({
      kind: 'application',
      title: 'Titanium fasteners for marine energy',
      slug: 'marine-energy',
      frontmatter: [
        'cover: images/cover.png',
        'product: titanium-countersunk-screw-m6',
      ].join('\n'),
      assets: { 'images/cover.png': cover },
    });

    await createContent({
      kind: 'case',
      title: 'Stage separation fasteners',
      slug: 'stage-separation-fasteners',
      frontmatter: [
        'description: Cap screws that cut joint weight on a launch vehicle.',
        'sector: Aerospace and spacecraft',
        'product: titanium-socket-head-cap-screw-m5',
        'results:',
        '  Joint weight reduction: "-44%"',
        '  Vibration profile qualified: 28g RMS',
      ].join('\n'),
      body: 'The steel fasteners added parasitic mass.',
    });
    // No sector and no product: the page must stand without either.
    await createContent({
      kind: 'case',
      title: 'Subsea pressure enclosures',
      slug: 'subsea-pressure-enclosures',
    });

    // The two spellings Mallok accepts for `faq`: a list of pairs, and the
    // question-to-answer mapping the admin's control writes.
    await createContent({
      kind: 'faq',
      title: 'Tolerances and torque',
      slug: 'tolerances-and-torque',
      frontmatter: [
        'description: What our lathes hold and how tight to go.',
        'faq:',
        '  - question: What tolerance do you hold?',
        '    answer: ISO 2768-m as standard.',
        '  - question: How tight is an M5 screw?',
        '    answer: About 4.5 N·m with anti-seize paste.',
      ].join('\n'),
      body: 'Figures for each thread size are on the calculators page.',
    });
    await createContent({
      kind: 'faq',
      title: 'Titanium grades',
      slug: 'titanium-grades',
      frontmatter: [
        'faq:',
        '  "Which grades do you supply?": Grade 5 and Grade 2.',
      ].join('\n'),
    });
    // The short spelling, and a pair that is half written.
    await createContent({
      kind: 'faq',
      title: 'Ordering',
      slug: 'ordering',
      frontmatter: [
        'faq:',
        '  - q: Is there a minimum order?',
        '    a: It depends on the part.',
        '  - question: When will this be answered?',
        '    answer: ""',
      ].join('\n'),
    });

    await createContent({
      kind: 'tool',
      title: 'Fastener calculators',
      slug: 'fastener-calculators',
      frontmatter: 'description: Formulas and reference tables.',
      body: '## Torque\n\n| Thread | Torque |\n| --- | ---: |\n| M5 | 4.5 N·m |\n',
    });

    await createContent({
      kind: 'page',
      title: 'About our facility',
      slug: 'about',
      frontmatter: [
        'description: Where the parts are made.',
        'cover: images/cover.png',
      ].join('\n'),
      body: 'We machine titanium fasteners.',
      assets: { 'images/cover.png': cover },
    });

    // In German only: two products whose attributes are named after things
    // Liquid answers on any map, and a list long enough to have a second
    // page. Mallok puts twenty items on a page.
    await createContent({
      kind: 'collection',
      title: 'Sonderfälle',
      slug: 'sonderfaelle',
      locale: 'de',
    });
    await createContent({
      kind: 'product',
      title: 'Schraube ohne Größenangabe',
      slug: 'schraube-ohne-groessenangabe',
      locale: 'de',
      frontmatter: [
        'collection: sonderfaelle',
        'facets:',
        '  Gewinde: M6',
      ].join('\n'),
    });
    await createContent({
      kind: 'product',
      title: 'Schraube mit Größenangabe',
      slug: 'schraube-mit-groessenangabe',
      locale: 'de',
      frontmatter: [
        'collection: sonderfaelle',
        'facets:',
        '  size: M5',
        '  first: A',
        '  last: Z',
      ].join('\n'),
    });
    for (let number = 1; number <= 21; number += 1) {
      await createContent({
        kind: 'article',
        title: `Meldung ${number}`,
        slug: `meldung-${number}`,
        locale: 'de',
        frontmatter: 'description: Eine Meldung aus dem Werk.',
        body: 'Der Text der Meldung.',
      });
    }
  });

  describe('a product page', () => {
    it('renders in the default language without a locale prefix', async () => {
      const { status, html } = await page(CAP_SCREW);

      expect(status).toBe(200);
      expect(html).toMatch(/<html lang="en"[ >]/);
      expect(html).toContain(
        '<h1 class="detail-title">M5 titanium socket head cap screw</h1>',
      );
      expect(html).toContain('A Grade 5 titanium M5 cap screw in two lengths.');
      expect(html).toContain('Rolled threads, verified with ring gauges.');
    });

    it('lists the attributes a buyer filters by', async () => {
      const { html } = await page(CAP_SCREW);

      expect(html).toContain('<dt>Head type</dt><dd>Socket head cap</dd>');
      expect(html).toContain('<dt>Thread</dt><dd>M5 × 0.8</dd>');
    });

    it('shows each size with the SKU a buyer quotes', async () => {
      const { html } = await page(CAP_SCREW);

      expect(html).toContain('<tr><td>TI-SHC-M5-10</td><td>10 mm</td></tr>');
      expect(html).toContain('<tr><td>TI-SHC-M5-16</td><td>16 mm</td></tr>');
    });

    it('shows the specification as a table', async () => {
      const { html } = await page(CAP_SCREW);

      expect(html).toContain(
        '<th scope="row">Tensile strength</th><td>895 MPa</td>',
      );
      expect(html).toContain('EN 10204 3.1');
    });

    it('names its collection in the breadcrumb and above the title', async () => {
      const { html } = await page(CAP_SCREW);

      expect(html).toContain(
        '<a href="/collections/socket-head-cap-screws">Socket head cap screws</a>',
      );
      expect(html).toContain('<p class="eyebrow">Socket head cap screws</p>');
    });

    it('links to the industry pages written about it', async () => {
      const { html } = await page(CAP_SCREW);

      expect(html).toContain('Industries that specify it');
      expect(html).toContain('href="/industries/motorsport"');
      expect(html).toContain('Titanium fasteners for motorsport');
      // The other industry page names the other product.
      expect(html).not.toContain('href="/industries/marine-energy"');
    });

    it('links to the case studies that used it', async () => {
      const { html } = await page(CAP_SCREW);

      expect(html).toContain('Case studies with this part');
      expect(html).toContain('href="/case-studies/stage-separation-fasteners"');
    });

    it('compares it with the other products in a specification table', async () => {
      const { html } = await page(CAP_SCREW);
      const related = between(html, 'Related products', '</article>');

      expect(related).toContain(
        'href="/products/titanium-countersunk-screw-m6"',
      );
      expect(related).toContain('data-label="Head type">Countersunk</td>');
    });

    it('sends the quote button where the site owner pointed it', async () => {
      const { html } = await page(CAP_SCREW);

      expect(between(html, 'class="buy-actions"', '</div>')).toContain(
        '<a class="btn btn-solid" href="/custom-manufacturing">Request a custom quote</a>',
      );
    });

    it('carries a self-referencing canonical and hreflang for each language it exists in', async () => {
      const { html } = await page(CAP_SCREW);

      expect(html).toContain(
        `<link rel="canonical" href="${ORIGIN}${CAP_SCREW}">`,
      );
      expect(head(html)).toContain(
        `<link rel="alternate" hreflang="de" href="${ORIGIN}${CAP_SCREW_DE}">`,
      );
      expect(head(html)).toContain(
        `<link rel="alternate" hreflang="x-default" href="${ORIGIN}${CAP_SCREW}">`,
      );
    });

    it('leaves a language it is not translated into out of hreflang', async () => {
      // The product exists in English and German only. Pointing French at
      // another language's URL would send a crawler to the wrong page.
      const { html } = await page(CAP_SCREW);

      expect(html).not.toContain('hreflang="fr"');
      expect(html).not.toContain('hreflang="es"');
    });

    it('describes itself in its own words, not the home page’s', async () => {
      const { html } = await page(CAP_SCREW);

      expect(html).toContain(
        '<meta name="description" content="A Grade 5 titanium M5 cap screw in two lengths.">',
      );
      expect(html).toContain('<title>M5 titanium socket head cap screw — ');
    });

    it('describes itself to a link preview', async () => {
      const { html } = await page(CAP_SCREW);

      expect(html).toContain(
        '<meta property="og:title" content="M5 titanium socket head cap screw">',
      );
      expect(html).toContain(
        `<meta property="og:url" content="${ORIGIN}${CAP_SCREW}">`,
      );
    });

    it('loads the versioned stylesheet and hints the fonts it starts with', async () => {
      const { html } = await page(CAP_SCREW);

      expect(html).toContain(`href="${ASSETS}/style.css"`);
      expect(html).toContain(
        `<link rel="preload" href="${ASSETS}/fonts/inter-latin.woff2" as="font" type="font/woff2" crossorigin>`,
      );
    });

    it('escapes markup in a title instead of emitting it', async () => {
      const { html } = await page('/products/markup-in-title');

      expect(html).not.toContain('<b>with markup</b>');
      expect(html).toContain('&lt;b&gt;with markup&lt;/b&gt;');
    });
  });

  describe('a product’s pictures and files', () => {
    const PICTURED = '/products/titanium-countersunk-screw-m6';

    it('shows the pictures that exist, the first of them large', async () => {
      // The gallery names three files and one was never uploaded. The large
      // picture is the first that exists, not the first that was named.
      const { html } = await page(PICTURED);
      const pictures = [
        ...between(html, '<figure class="gallery"', '</figure>').matchAll(
          /<img [^>]*>/g,
        ),
      ].map((match) => match[0]);

      expect(pictures).toHaveLength(2);
      expect(pictures[0]).toContain('loading="eager"');
      expect(pictures[0]).toContain('alt="M6 titanium countersunk screw 1"');
      expect(pictures[1]).toContain('loading="lazy"');
      expect(pictures[1]).toContain('alt="M6 titanium countersunk screw 2"');
    });

    it('offers the datasheet as a download', async () => {
      const { html } = await page(PICTURED);

      expect(html).toMatch(
        /<a class="datasheet" href="[^"]+" download>Download datasheet<\/a>/,
      );
    });

    it('gives the buying facts the row to themselves when there is no picture', async () => {
      const pictured = await page(PICTURED);
      const plain = await page(CAP_SCREW);

      expect(pictured.html).toContain('<div class="product-top">');
      expect(plain.html).toContain(
        '<div class="product-top product-top-plain">',
      );
      expect(plain.html).not.toContain('<figure class="gallery"');
      expect(plain.html).not.toContain('class="datasheet"');
    });

    it('puts a product’s picture beside its name in the catalogue', async () => {
      const { html } = await page('/products');
      const rows = between(html, '<tbody', '</tbody>').split('<tr role="row">');
      const pictured = rows.filter((row) =>
        row.includes('class="finder-thumb"'),
      );

      expect(pictured).toHaveLength(1);
      expect(pictured[0]).toContain(`href="${PICTURED}"`);
    });

    it('opens a plain page with its cover', async () => {
      const { html } = await page('/about');

      expect(html).toMatch(/<div class="detail-cover"><img src="[^"]+"/);
    });
  });

  describe('the German version', () => {
    it('lives under /de/ with its own slug and German interface strings', async () => {
      const { status, html } = await page(CAP_SCREW_DE);

      expect(status).toBe(200);
      expect(html).toMatch(/<html lang="de"[ >]/);
      expect(html).toContain('M5 Titan-Zylinderschraube');
      expect(html).toContain('Individuelles Angebot anfragen');
      expect(html).toContain('<dt>Kopfform</dt><dd>Zylinderkopf</dd>');
    });

    it('links to the German industry page by its German slug', async () => {
      const { html } = await page(CAP_SCREW_DE);

      expect(html).toContain('href="/de/industries/rennsport"');
      expect(html).not.toContain('href="/industries/motorsport"');
    });

    it('takes the language’s own value for an option that has one', async () => {
      const { html } = await page(CAP_SCREW_DE);

      expect(between(html, 'class="buy-actions"', '</div>')).toContain(
        'href="/de/sonderanfertigung"',
      );
    });
  });

  describe('the other languages', () => {
    it.each([
      [
        'fr',
        'Aller au contenu',
        'Rien ici pour l’instant.',
        'Page introuvable',
      ],
      [
        'es',
        'Saltar al contenido',
        'Todavía no hay nada aquí.',
        'Página no encontrada',
      ],
    ])(
      'speak %s from their own language pack',
      async (locale, skip, empty, missing) => {
        // Nothing was written in these two languages: what they show is the
        // theme's own vocabulary.
        const list = await page(`/${locale}/news`);
        const lost = await page(`/${locale}/products/nothing-here`);

        expect(list.status).toBe(200);
        expect(list.html).toMatch(new RegExp(`<html lang="${locale}"[ >]`));
        expect(list.html).toContain(`<a class="skip" href="#main">${skip}</a>`);
        expect(list.html).toContain(`<p class="empty">${empty}</p>`);
        expect(lost.status).toBe(404);
        expect(lost.html).toContain(missing);
      },
    );
  });

  describe('the header and the footer', () => {
    it('names each language in its own words in the switcher', async () => {
      const { html } = await page(CAP_SCREW_DE);
      const switcher = between(html, '<details class="langs">', '</details>');

      expect(switcher).toContain('>English</a>');
      expect(switcher).toContain('>Deutsch</a>');
    });

    it('labels the closed switcher with the language’s name and its code', async () => {
      // The stylesheet shows one or the other, by how much room the bar has.
      const { html } = await page(CAP_SCREW_DE);

      expect(between(html, '<summary', '</summary>')).toContain(
        '<span class="lang-name">Deutsch</span><span class="lang-code">de</span>',
      );
    });

    it('says what the switcher is in words that are part of it', async () => {
      // An aria-label would replace the visible language in the control's
      // name: every page would then announce the same thing.
      const { html } = await page(CAP_SCREW_DE);
      const summary = between(html, '<summary', '</summary>');

      expect(summary).toContain(
        '<span class="visually-hidden">Sprache: </span>',
      );
      expect(summary).not.toContain('aria-label');
    });

    it('marks the page a visitor is on in the navigation', async () => {
      const { html } = await page('/products');

      expect(between(html, '<nav class="menu-nav"', '</nav>')).toContain(
        '<a href="/products" aria-current="page">Products</a>',
      );
    });

    it('lets a keyboard skip the header', async () => {
      const { html } = await page(CAP_SCREW);

      expect(html).toContain(
        '<a class="skip" href="#main">Skip to content</a>',
      );
      expect(html).toContain('<main id="main">');
    });

    it('puts the short wording on the button that shares a line with the navigation', async () => {
      const english = await page(CAP_SCREW);
      const german = await page(CAP_SCREW_DE);

      expect(between(english.html, '<header', '</header>')).toContain(
        '<a class="btn btn-solid" href="/custom-manufacturing">Request a quote</a>',
      );
      expect(between(german.html, '<header', '</header>')).toContain(
        '<a class="btn btn-solid" href="/de/sonderanfertigung">Angebot anfragen</a>',
      );
    });

    it('offers no switcher on a page that exists in one language', async () => {
      const { html } = await page('/products/titanium-countersunk-screw-m6');

      expect(html).not.toContain('class="langs"');
    });

    it('prints the site owner’s contact details and legal links, and only those set', async () => {
      const { html } = await page('/about');
      const footer = between(html, '<footer', '</footer>');

      expect(footer).toContain(
        '<a href="mailto:sales@example.com">sales@example.com</a>',
      );
      expect(footer).toContain('<a href="/terms">Terms and conditions</a>');
      expect(footer).toContain('Sample catalogue.');
      // No privacy or compliance page was configured.
      expect(footer).not.toContain('Privacy policy');
      expect(footer).not.toContain('Compliance');
    });

    it('prints no year beside the copyright sign', async () => {
      // Mallok renders the same content to the same bytes every time, and
      // caches on that promise. A date in a template would break it.
      const { html } = await page('/about');
      const line = between(html, 'class="footer-base"', '</p>');

      expect(line).toContain('©');
      expect(line).not.toMatch(/\d/);
    });
  });

  describe('the catalogue', () => {
    it('gives every product a row, with a column for each attribute', async () => {
      const { status, html } = await page('/products');

      expect(status).toBe(200);
      expect(html).toContain(`href="${CAP_SCREW}"`);
      expect(html).toContain('href="/products/titanium-countersunk-screw-m6"');
      expect(html).toContain(
        '<th scope="col" role="columnheader">Head type</th>',
      );
      expect(html).toContain(
        '<td class="facet" role="cell" data-label="Thread">M5 × 0.8</td>',
      );
    });

    it('keeps the columns aligned for a product that lacks the attributes', async () => {
      // One product here has no attributes at all, and is the newest, so it
      // is the first row. Its cells are empty; nothing moves sideways.
      const { html } = await page('/products');
      const cellsPerRow = [
        ...html.matchAll(/<tr role="row">([\s\S]*?)<\/tr>/g),
      ].map(
        (row) => (row[1]?.match(/role="(?:cell|columnheader)"/g) ?? []).length,
      );

      expect(cellsPerRow).toHaveLength(4);
      expect(new Set(cellsPerRow).size).toBe(1);
      expect(cellsPerRow[0]).toBe(6);
    });

    it('leaves a cell empty for an attribute called size, first or last', async () => {
      // Liquid answers those three names on any map — with a count, or with
      // an entry — so a product without such an attribute would show one.
      const { status, html } = await page('/de/collections/sonderfaelle');
      const row = between(
        html,
        'schraube-ohne-groessenangabe">Schraube ohne Größenangabe</a>',
        '</tr>',
      );

      expect(status).toBe(200);
      expect(html).toContain(
        '<td class="facet" role="cell" data-label="size">M5</td>',
      );
      expect(row).toContain(
        '<td class="facet" role="cell" data-label="size"></td>',
      );
      expect(row).toContain(
        '<td class="facet" role="cell" data-label="first"></td>',
      );
      expect(row).toContain(
        '<td class="facet" role="cell" data-label="last"></td>',
      );
    });

    it('shows the sizes on offer, each carrying its SKU', async () => {
      const { html } = await page('/products');

      expect(html).toContain(
        '<span class="chip" title="TI-SHC-M5-16">16 mm</span>',
      );
      expect(html).toContain('data-label="Sizes"');
    });
  });

  describe('a collection page', () => {
    it('lists the products that name it, and no others', async () => {
      const { status, html } = await page(
        '/collections/socket-head-cap-screws',
      );

      expect(status).toBe(200);
      expect(html).toContain('Products of this type');
      expect(html).toContain(`href="${CAP_SCREW}"`);
      expect(html).not.toContain(
        'href="/products/titanium-countersunk-screw-m6"',
      );
      expect(html).toContain(
        'Chosen where there is little room around the head.',
      );
    });
  });

  describe('an industry page', () => {
    it('is its own page with its own canonical, not the product’s', async () => {
      const { status, html } = await page('/industries/motorsport');

      expect(status).toBe(200);
      expect(html).toContain(
        `<link rel="canonical" href="${ORIGIN}/industries/motorsport">`,
      );
      expect(
        between(html, '<header class="detail-head">', '</header>'),
      ).toContain('<p class="eyebrow">Industry</p>');
      expect(html).toContain('Every gram of unsprung mass costs grip.');
    });

    it('points at the product it discusses and the figures that matter', async () => {
      const { html } = await page('/industries/motorsport');

      expect(html).toContain(`href="${CAP_SCREW}"`);
      expect(html).toContain('The part discussed here');
      expect(html).toContain(
        '<th scope="row">Curb shock load</th><td>12g</td>',
      );
    });

    it('leads its breadcrumb home, not through the product', async () => {
      // An industry is not a child of the part it happens to mention.
      const { html } = await page('/industries/motorsport');
      const crumbs = between(html, 'class="crumbs"', '</nav>');

      expect(crumbs).toContain('<a href="/">Home</a>');
      expect(crumbs).not.toContain('/products/');
    });

    it('resolves hreflang to the German page’s own slug', async () => {
      const { html } = await page('/industries/motorsport');

      expect(head(html)).toContain(
        `<link rel="alternate" hreflang="de" href="${ORIGIN}/de/industries/rennsport">`,
      );
    });

    it('links to the other industries', async () => {
      const { html } = await page('/industries/motorsport');

      expect(between(html, 'Other industries', '</article>')).toContain(
        'href="/industries/marine-energy"',
      );
    });
  });

  describe('a case study', () => {
    it('leads with the measured results', async () => {
      const { status, html } = await page(
        '/case-studies/stage-separation-fasteners',
      );

      expect(status).toBe(200);
      // Name first, as a description list is read; the stylesheet puts the
      // figure on top.
      expect(html).toContain(
        '<div><dt>Joint weight reduction</dt><dd>-44%</dd></div>',
      );
      expect(html).toContain('<p class="eyebrow">Aerospace and spacecraft</p>');
      expect(html).toContain('The steel fasteners added parasitic mass.');
    });

    it('names the part that was used', async () => {
      const { html } = await page('/case-studies/stage-separation-fasteners');
      const aside = between(html, '<aside class="spec-card">', '</aside>');

      expect(aside).toContain('The part used');
      expect(aside).toContain(
        `<a href="${CAP_SCREW}">M5 titanium socket head cap screw</a>`,
      );
    });

    it('stands without a sector, results or a product', async () => {
      const { status, html } = await page(
        '/case-studies/subsea-pressure-enclosures',
      );

      expect(status).toBe(200);
      expect(html).toContain('<p class="eyebrow">Case study</p>');
      expect(html).not.toContain('class="results"');
      expect(html).not.toContain('<aside class="spec-card">');
    });
  });

  describe('the questions and answers', () => {
    it('prints every pair the structured data describes', async () => {
      // Mallok publishes the pairs as FAQPage data; a page that did not show
      // them would be describing content it does not have.
      const { status, html } = await page('/faq/tolerances-and-torque');

      expect(status).toBe(200);
      expect(html).toContain('"FAQPage"');
      expect(html).toContain('<summary>What tolerance do you hold?</summary>');
      expect(html).toContain('<p>ISO 2768-m as standard.</p>');
      expect(html).toContain('<summary>How tight is an M5 screw?</summary>');
    });

    it('reads the mapping spelling as well as the list', async () => {
      const { html } = await page('/faq/titanium-grades');

      expect(html).toContain('<summary>Which grades do you supply?</summary>');
      expect(html).toContain('<p>Grade 5 and Grade 2.</p>');
    });

    it('gathers every topic’s questions on the list page, in either spelling', async () => {
      const { status, html } = await page('/faq');

      expect(status).toBe(200);
      expect(html).toContain(
        '<a href="/faq/tolerances-and-torque">Tolerances and torque</a>',
      );
      expect(html).toContain('<summary>What tolerance do you hold?</summary>');
      expect(html).toContain('<p>About 4.5 N·m with anti-seize paste.</p>');
      expect(html).toContain('<summary>Which grades do you supply?</summary>');
      expect(html).toContain('<p>Grade 5 and Grade 2.</p>');
    });

    it('reads the short spelling on the list page, and skips a pair that is half written', async () => {
      // Mallok drops a pair without an answer from the topic's own page; the
      // list page reads the front matter itself and has to do the same.
      const { html } = await page('/faq');
      const topic = between(
        html,
        '<a href="/faq/ordering">Ordering</a>',
        '</section>',
      );

      expect(topic).toContain('<summary>Is there a minimum order?</summary>');
      expect(topic).toContain('<p>It depends on the part.</p>');
      expect(topic.match(/<details class="faq-item"/g)).toHaveLength(1);
      expect(html).not.toContain('When will this be answered?');
    });
  });

  describe('an engineering tool', () => {
    it('renders its reference tables', async () => {
      const { status, html } = await page('/tools/fastener-calculators');

      expect(status).toBe(200);
      expect(html).toContain('<p class="eyebrow">Engineering tool</p>');
      expect(html).toMatch(/<td[^>]*>4\.5 N·m<\/td>/);
    });

    it('has a list page at the address its own page sits under', async () => {
      // A kind with an address of its own and no list layout answers that
      // address with a server error.
      const { status, html } = await page('/tools');

      expect(status).toBe(200);
      expect(html).toContain('href="/tools/fastener-calculators"');
    });
  });

  describe('a plain page', () => {
    it('renders its title, summary and body', async () => {
      const { status, html } = await page('/about');

      expect(status).toBe(200);
      expect(html).toContain(
        '<h1 class="detail-title">About our facility</h1>',
      );
      expect(html).toContain(
        '<p class="detail-lede">Where the parts are made.</p>',
      );
      expect(html).toContain('We machine titanium fasteners.');
    });
  });

  describe('the home page', () => {
    it('leads with the site owner’s headline and the way into the catalogue', async () => {
      const { status, html } = await page('/');

      expect(status).toBe(200);
      expect(html).toMatch(/<html lang="en"[ >]/);
      expect(html).toContain(
        '<h1 class="hero-title">Titanium fasteners, built to your drawing.</h1>',
      );
      expect(html).toContain('<p class="hero-badge">Grade 5 Ti-6Al-4V</p>');
      expect(html).toContain('href="#specification-finder"');
      expect(html).toContain('<a href="/products">Products</a>');
    });

    it('titles and describes itself in the visitor’s language', async () => {
      // The site's own tagline is one string for every language; the theme's
      // options stand in front of it because they can differ by language.
      const english = await page('/');
      const german = await page('/de/');

      expect(english.html).toContain(' — Titanium fasteners</title>');
      expect(english.html).toContain(
        '<meta name="description" content="Find titanium fasteners by specification.">',
      );
      expect(german.html).toContain(' — Verbindungselemente aus Titan</title>');
      expect(german.html).toContain(
        '<meta name="description" content="Titan-Verbindungselemente nach Spezifikation finden.">',
      );
      expect(german.html).toContain(
        '<meta property="og:description" content="Titan-Verbindungselemente nach Spezifikation finden.">',
      );
    });

    it('shows a selling point only when it has been written', async () => {
      const { html } = await page('/');
      const props = between(html, '<div class="props">', '</section>');

      expect(props).toContain('<h2>Exact specifications</h2>');
      expect(props.match(/class="prop"/g)).toHaveLength(1);
    });

    it('lets a buyer browse by type', async () => {
      const { html } = await page('/');

      expect(html).toContain(
        '<a class="type-card" href="/collections/socket-head-cap-screws">',
      );
    });

    it('carries the whole specification finder in the page', async () => {
      // Readable, and indexable, before any script has run.
      const { html } = await page('/');
      const finder = between(html, 'id="specification-finder"', '</section>');

      expect(finder).toContain(`href="${CAP_SCREW}"`);
      expect(finder).toContain('data-label="Material">Grade 5 titanium</td>');
      expect(finder).toContain(
        'href="/products/titanium-countersunk-screw-m6"',
      );
    });

    it('links to the case studies and the industry pages directly', async () => {
      // These are the long-tail landing pages, so the home page links to
      // them itself instead of leaving them to be found through a product.
      const { html } = await page('/');

      expect(html).toContain('href="/case-studies/stage-separation-fasteners"');
      expect(html).toContain('href="/industries/motorsport"');
      expect(html).toContain('<h3>Traceable material</h3>');
    });

    it('frames a picture on a card only where there is a picture', async () => {
      // An empty frame above a title reads as a broken image.
      const { html } = await page('/');
      const withCover = between(
        html,
        '<a class="card" href="/industries/marine-energy">',
        '</a>',
      );
      const without = between(
        html,
        '<a class="card" href="/industries/motorsport">',
        '</a>',
      );

      expect(withCover).toMatch(/<div class="card-art">\s*<img src="[^"]+"/);
      expect(without).toContain('class="card-body"');
      expect(without).not.toContain('class="card-art"');
    });

    it('offers the jump to the finder only where there is a finder', async () => {
      // No product exists in French, so the French home page has no finder
      // for the button to jump to.
      const english = await page('/');
      const french = await page('/fr/');

      expect(english.html).toContain(
        '<a class="btn btn-solid" href="#specification-finder">',
      );
      expect(french.status).toBe(200);
      expect(french.html).not.toContain('specification-finder');
    });

    it('links to the whole catalogue under the finder, in the visitor’s language', async () => {
      // The home page holds the ten newest products and no more.
      const english = await page('/');
      const german = await page('/de/');

      expect(
        between(english.html, 'id="specification-finder"', '</section>'),
      ).toContain('<a class="text-link" href="/products">');
      expect(
        between(german.html, 'id="specification-finder"', '</section>'),
      ).toContain('<a class="text-link" href="/de/products">');
    });

    it('closes with the call to action', async () => {
      const { html } = await page('/');
      const closing = between(html, '<section class="closing">', '</section>');

      expect(closing).toContain(
        '<h2>Discuss your component requirements.</h2>',
      );
      expect(closing).toContain('href="/custom-manufacturing"');
      expect(closing).toContain('href="/contact"');
    });

    it('serves the German home page under /de/, with the German items and copy', async () => {
      const { status, html } = await page('/de/');

      expect(status).toBe(200);
      expect(html).toMatch(/<html lang="de"[ >]/);
      expect(html).toContain(
        '<h1 class="hero-title">Titan-Verbindungselemente nach Ihrer Zeichnung.</h1>',
      );
      expect(html).toContain('<a href="/de/products">Produkte</a>');
      expect(html).toContain(`href="${CAP_SCREW_DE}"`);
      expect(html).toContain('href="/de/industries/rennsport"');
      // Never another language's page in this language's home.
      expect(html).not.toContain(`href="${CAP_SCREW}"`);
    });
  });

  describe('a list', () => {
    it('has no pagination when it is one page long', async () => {
      const { html } = await page('/products');

      expect(html).not.toContain('class="pager"');
      expect(html).toContain('<title>Products — ');
    });

    it('leads to its second page, and says which page a reader is on', async () => {
      // Twenty-one German articles: twenty to a page.
      const first = await page('/de/news');
      const second = await page('/de/news/page/2');

      expect(first.status).toBe(200);
      expect(first.html).toContain('<title>Aktuelles — ');
      expect(between(first.html, '<nav class="pager"', '</nav>')).toContain(
        '<a class="pager-next" href="/de/news/page/2">Weiter →</a>',
      );
      expect(first.html).not.toContain('class="pager-prev"');

      expect(second.status).toBe(200);
      expect(second.html).toContain('<title>Aktuelles, Seite 2 — ');
      expect(between(second.html, '<nav class="pager"', '</nav>')).toContain(
        '<a class="pager-prev" href="/de/news">← Zurück</a>',
      );
      expect(second.html).not.toContain('class="pager-next"');
    });

    it('says so when there is nothing in it', async () => {
      // The articles exist in German only.
      const { status, html } = await page('/news');

      expect(status).toBe(200);
      expect(html).toContain('<p class="empty">Nothing here yet.</p>');
    });
  });

  describe('an article', () => {
    it('renders its title, summary, date and body', async () => {
      const { status, html } = await page('/de/news/meldung-7');

      expect(status).toBe(200);
      expect(html).toContain('<h1 class="detail-title">Meldung 7</h1>');
      expect(html).toContain(
        '<p class="detail-lede">Eine Meldung aus dem Werk.</p>',
      );
      expect(html).toMatch(/<time datetime="[^"]+">\d{4}-\d{2}-\d{2}<\/time>/);
      expect(html).toContain('Der Text der Meldung.');
    });
  });

  describe('client JavaScript', () => {
    const FINDER = `<script src="${ASSETS}/finder.js" defer>`;

    it.each([
      CAP_SCREW,
      '/collections/socket-head-cap-screws',
      '/industries/motorsport',
      '/case-studies/stage-separation-fasteners',
      '/faq',
      '/faq/tolerances-and-torque',
      '/tools/fastener-calculators',
      '/about',
      '/news',
    ])('is not sent on %s', async (path) => {
      const { html } = await page(path);

      expect(executableScripts(html)).toEqual([]);
      expect(html).not.toMatch(/\son[a-z]+=/i);
    });

    it.each(['/', '/products', '/de/', '/de/products'])(
      'is one declared file on %s, where the finder is',
      async (path) => {
        const { html } = await page(path);

        expect(executableScripts(html)).toEqual([FINDER]);
        expect(html).not.toMatch(/\son[a-z]+=/i);
      },
    );

    it('is not sent where there is no table for it to work on', async () => {
      // No product exists in French.
      const home = await page('/fr/');
      const catalogue = await page('/fr/products');

      expect(executableScripts(home.html)).toEqual([]);
      expect(executableScripts(catalogue.html)).toEqual([]);
    });
  });

  describe('the finder’s filters', () => {
    it('are in the page, hidden, with a list for each attribute and one for the sizes', async () => {
      // Hidden until the script has filled the lists: a form that cannot
      // filter is not offered.
      const { html } = await page('/products');
      const form = between(html, '<form class="finder-filters"', '</form>');

      expect(form).toMatch(/^<form class="finder-filters" hidden /);
      expect(form).toContain('aria-label="Filter the parts"');
      expect(form).toContain('data-count="{shown} of {total} parts"');
      expect(form).toContain(
        '<span>Search</span><input type="search" name="q"',
      );
      expect(form).toContain(
        '<span>Head type</span><select name="facet-1" data-facet="Head type"><option value="">All</option></select>',
      );
      expect(form.match(/<select /g)).toHaveLength(4);
      expect(form).toContain('<select name="size">');
      expect(form).toContain(
        '<button class="btn btn-outline btn-sm" type="reset">Clear filters</button>',
      );
    });

    it('leave the whole table in the page, and a way on when nothing matches', async () => {
      const { html } = await page('/products');
      const finder = between(
        html,
        '<div class="finder" data-finder>',
        '</section>',
      );

      expect(finder.match(/<tr role="row">/g)).toHaveLength(4);
      expect(finder).not.toMatch(/<tr[^>]* hidden/);
      expect(finder).toMatch(
        /<p class="finder-none" hidden>No standard part matches this combination\. <a class="text-link" href="\/custom-manufacturing">/,
      );
    });

    it('speak the page’s language', async () => {
      const { html } = await page('/de/products');
      const form = between(html, '<form class="finder-filters"', '</form>');

      expect(form).toContain('aria-label="Teile filtern"');
      expect(form).toContain('data-count="{shown} von {total} Teilen"');
      // The lists are the columns: the attributes of the newest German
      // product that has any, which is the one named after Liquid's words.
      expect(form).toContain(
        '<span>size</span><select name="facet-1" data-facet="size">',
      );
    });

    it('are offered above the home page’s finder and the catalogue, and nowhere else', async () => {
      const home = await page('/');
      const collection = await page('/collections/socket-head-cap-screws');
      const product = await page(CAP_SCREW);

      expect(home.html).toContain('<form class="finder-filters" hidden ');
      expect(collection.html).not.toContain('finder-filters');
      expect(product.html).not.toContain('finder-filters');
    });
  });

  describe('a missing page', () => {
    it('answers 404 inside the theme, in the visitor’s language', async () => {
      const { status, html } = await page('/de/products/gibt-es-nicht');

      expect(status).toBe(404);
      expect(html).toContain('Seite nicht gefunden');
      expect(html).toContain(`href="${ASSETS}/style.css"`);
    });
  });
});
