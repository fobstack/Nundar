import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import manifest from '../../src/theme/theme.json';
import {
  countD1Calls,
  createContent,
  createVariant,
  ensureSite,
  ORIGIN,
  setPrice,
  type TestContent,
} from '../shop/helpers.js';

/**
 * Prices, minimum orders and availability on the pages a buyer reads.
 *
 * The shop plugin reads its own tables while Mallok renders a page, and the
 * theme prints what it is given. Neither half is worth much alone, so these
 * go through the real Worker: content from the management API, variants in
 * the plugin's tables, a request for the page.
 *
 * The stock figures are numbers that appear nowhere else on a page, so that
 * a test can say none of them leaked into one.
 */

interface Page {
  readonly status: number;
  readonly html: string;
  readonly tags: readonly string[];
}

async function page(path: string): Promise<Page> {
  const response = await SELF.fetch(`${ORIGIN}${path}`);
  return {
    status: response.status,
    html: await response.text(),
    tags: (response.headers.get('cache-tag') ?? '').split(','),
  };
}

function between(html: string, start: string, end: string): string {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from + start.length);
  return from === -1 ? '' : html.slice(from, to === -1 ? undefined : to);
}

/** The tag that loads the currency switch's script, at this version of the theme. */
const SWITCH_SCRIPT = `<script src="/theme/${manifest.id}/${manifest.version}/currency.js" defer></script>`;

/** The currency switch of a page: what it says, as plain facts. */
function currencySwitches(html: string): {
  readonly own: string;
  readonly label: string;
  readonly hidden: boolean;
  readonly buttons: readonly (readonly [string, string, string])[];
}[] {
  return [
    ...html.matchAll(/<div class="currency"([^>]*)>([\s\S]*?)<\/div>/g),
  ].map(([, attributes = '', inside = '']) => ({
    own: /data-currency="([^"]*)"/.exec(attributes)?.[1] ?? '',
    label: /aria-label="([^"]*)"/.exec(attributes)?.[1] ?? '',
    hidden: /\shidden$/.test(attributes),
    buttons: [
      ...inside.matchAll(
        /<button type="button" value="([^"]*)" aria-pressed="([^"]*)">([^<]*)<\/button>/g,
      ),
    ].map(([, value = '', pressed = '', text = '']) => [value, pressed, text]),
  }));
}

/** One row of a product page's sizes, as plain facts. */
interface Row {
  readonly sku: string;
  readonly size: string;
  /** Label to value, in the order printed; empty when the row has no terms. */
  readonly terms: readonly (readonly [string, string])[];
}

function rows(html: string): Row[] {
  const list = between(html, '<ul class="offers">', '</ul>');
  return [...list.matchAll(/<li class="offer">([\s\S]*?)<\/li>/g)].map(
    ([, row = '']) => ({
      sku: /<span class="offer-sku">([^<]*)<\/span>/.exec(row)?.[1] ?? '',
      size: /<span class="offer-size">([^<]*)<\/span>/.exec(row)?.[1] ?? '',
      terms: [...row.matchAll(/<dt>([^<]*)<\/dt><dd>([\s\S]*?)<\/dd>/g)].map(
        ([, label = '', value = '']) =>
          [label, value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ')] as const,
      ),
    }),
  );
}

/** The structured data of a page: the one node Mallok emits for it. */
function structuredData(html: string): Record<string, unknown> {
  const block =
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
  return block === undefined
    ? {}
    : (JSON.parse(block) as Record<string, unknown>);
}

/** What the finder prints under one product's name. */
function listed(html: string, path: string): string | null {
  const cell = between(html, `<a href="${path}">`, '</td>');
  const offer = /<p class="finder-offer">([\s\S]*?)<\/p>/.exec(cell)?.[1];
  return offer === undefined
    ? null
    : offer
        .replace(/<\/span><span/g, '</span> | <span')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ');
}

describe('prices on the pages', () => {
  let screw: TestContent;
  let screwDe: TestContent;
  let bolt: TestContent;
  let washer: TestContent;
  let spacer: TestContent;
  let collection: TestContent;

  beforeAll(async () => {
    await ensureSite();

    // Everything exists before any page is requested.
    collection = await createContent({
      kind: 'collection',
      title: 'Cap screws',
      slug: 'cap-screws',
    });
    screw = await createContent({
      kind: 'product',
      title: 'Cap screw',
      slug: 'cap-screw',
      frontmatter: [
        'collection: cap-screws',
        'facets:',
        '  Thread: M5 × 0.8',
        'sizes:',
        '  CS-10: 10 mm',
        '  CS-16: 16 mm',
        '  CS-99: 99 mm',
      ].join('\n'),
    });
    screwDe = await createContent({
      kind: 'product',
      title: 'Zylinderschraube',
      slug: 'zylinderschraube',
      locale: 'de',
      translationGroup: screw.translationGroup,
      frontmatter: [
        'facets:',
        '  Gewinde: M5 × 0,8',
        'sizes:',
        '  CS-10: 10 mm',
        '  CS-16: 16 mm',
      ].join('\n'),
    });
    bolt = await createContent({
      kind: 'product',
      title: 'Flange bolt',
      slug: 'flange-bolt',
      frontmatter: ['facets:', '  Thread: M8 × 1.25'].join('\n'),
    });
    washer = await createContent({
      kind: 'product',
      title: 'Washer',
      slug: 'washer',
      frontmatter: ['sizes:', '  WA-5: M5'].join('\n'),
    });

    // Sold, and not priced yet.
    spacer = await createContent({
      kind: 'product',
      title: 'Spacer',
      slug: 'spacer',
    });
    await createVariant({
      id: 'sp-1',
      productGroup: spacer.translationGroup,
      sku: 'SP-1',
    });

    const group = screw.translationGroup;
    // Three variants the page does not name. They are entered in an order
    // that is neither the one the shop keeps them in nor that of their
    // SKUs, so that only the query's own ordering puts them right: by
    // `sortOrder`, and by SKU where two share one.
    await createVariant({
      id: 'cs-30',
      productGroup: group,
      sku: 'CS-30',
      optionValues: { length: '30 mm' },
      stock: 61873,
      sortOrder: 5,
    });
    await createVariant({
      id: 'cs-12',
      productGroup: group,
      sku: 'CS-12',
      optionValues: { length: '12 mm' },
      sortOrder: 9,
    });
    await createVariant({
      id: 'cs-16',
      productGroup: group,
      sku: 'CS-16',
      moq: 50,
      stock: 0,
      stockPolicy: 'made_to_order',
      leadTime: [15, 20],
      sortOrder: 2,
    });
    await createVariant({
      id: 'cs-10',
      productGroup: group,
      sku: 'CS-10',
      moq: 100,
      stock: 73519,
      leadTime: [5, 10],
      sortOrder: 1,
    });
    await createVariant({
      id: 'cs-old',
      productGroup: group,
      sku: 'CS-OLD',
      status: 'archived',
    });
    await createVariant({
      id: 'cs-25',
      productGroup: group,
      sku: 'CS-25',
      optionValues: { length: '25 mm' },
      moq: 100,
      stock: 73,
      sortOrder: 5,
    });
    for (const [variantId, usd, eur] of [
      ['cs-10', 42, 39],
      ['cs-16', 55, 51],
      ['cs-25', 60, 56],
      ['cs-old', 1, 1],
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
        source: 'auto',
        rateUsed: 0.92,
      });
    }

    await createVariant({
      id: 'fb-30',
      productGroup: bolt.translationGroup,
      sku: 'FB-30',
      stock: 0,
      stockPolicy: 'made_to_order',
    });
    await setPrice({
      variantId: 'fb-30',
      currency: 'USD',
      amountMinor: 1890,
      source: 'base',
    });
    await setPrice({
      variantId: 'fb-30',
      currency: 'EUR',
      amountMinor: 1799,
      source: 'manual',
    });
  });

  describe('a product page', () => {
    it('lists the sizes it names in its own order, then what else the shop sells of it', async () => {
      const { status, html } = await page(screw.path);

      expect(status).toBe(200);
      expect(rows(html).map((row) => [row.sku, row.size])).toEqual([
        ['CS-10', '10 mm'],
        ['CS-16', '16 mm'],
        ['CS-99', '99 mm'],
        // Not in the page's front matter: named by their option values,
        // in the order the shop keeps them in.
        ['CS-25', '25 mm'],
        ['CS-30', '30 mm'],
        ['CS-12', '12 mm'],
      ]);
    });

    it('gives each size its price, its minimum order, its state and its lead time', async () => {
      const [first, second] = rows((await page(screw.path)).html);

      expect(first?.terms).toEqual([
        ['Unit price', '$0.42'],
        ['Minimum order', '100'],
        ['Availability', 'In stock'],
        ['Lead time', '5–10 business days'],
      ]);
      expect(second?.terms).toEqual([
        ['Unit price', '$0.55'],
        ['Minimum order', '50'],
        ['Availability', 'Made to order'],
        ['Lead time', '15–20 business days'],
      ]);
    });

    it('says a size that cannot fill one minimum order is out of stock, and still what it costs', async () => {
      const row = rows((await page(screw.path)).html).find(
        (entry) => entry.sku === 'CS-25',
      );

      // 73 left with a minimum order of 100.
      expect(row?.terms).toEqual([
        ['Unit price', '$0.60'],
        ['Minimum order', '100'],
        ['Availability', 'Out of stock'],
      ]);
    });

    it('offers a size without a price on request', async () => {
      const row = rows((await page(screw.path)).html).find(
        (entry) => entry.sku === 'CS-30',
      );

      expect(row?.terms[0]).toEqual(['Unit price', 'On request']);
    });

    it('leaves a size the shop does not sell as its name and no more', async () => {
      const row = rows((await page(screw.path)).html).find(
        (entry) => entry.sku === 'CS-99',
      );

      expect(row).toEqual({ sku: 'CS-99', size: '99 mm', terms: [] });
    });

    it('does not show an archived variant, or its price', async () => {
      const { html } = await page(screw.path);

      expect(html).not.toContain('CS-OLD');
      expect(html).not.toContain('$0.01');
    });

    it('never prints how many are left', async () => {
      for (const path of [screw.path, '/products', '/']) {
        const { html } = await page(path);

        expect(html, path).not.toContain('73519');
        expect(html, path).not.toContain('61873');
      }
    });

    it('speaks the page’s language and its currency', async () => {
      const [first, second] = rows((await page(screwDe.path)).html);
      const plain = (terms: Row['terms'] | undefined) =>
        terms?.map(([label, value]) => [label, value.replace(/\s/g, ' ')]);

      expect(plain(first?.terms)).toEqual([
        ['Stückpreis', '0,39 €'],
        ['Mindestmenge', '100'],
        ['Verfügbarkeit', 'Auf Lager'],
        ['Lieferzeit', '5–10 Werktage'],
      ]);
      expect(plain(second?.terms)?.[2]).toEqual([
        'Verfügbarkeit',
        'Auftragsfertigung',
      ]);
    });

    it('is the sizes alone for a product the shop has no variants of', async () => {
      const { status, html } = await page(washer.path);

      expect(status).toBe(200);
      expect(rows(html)).toEqual([{ sku: 'WA-5', size: 'M5', terms: [] }]);
    });

    it('has no list of sizes when it names none and the shop sells none', async () => {
      const lone = await createContent({
        kind: 'product',
        title: 'Lone part',
        slug: 'lone-part',
      });

      expect((await page(lone.path)).html).not.toContain('class="size-list"');
    });

    it('lists what the shop sells of a product that names no sizes itself', async () => {
      const found = rows((await page(bolt.path)).html);

      expect(found).toHaveLength(1);
      expect(found[0]?.sku).toBe('FB-30');
      expect(found[0]?.terms[0]).toEqual(['Unit price', '$18.90']);
    });
  });

  describe('the structured data', () => {
    it('offers exactly the prices the page prints, in the page’s currency', async () => {
      for (const [path, currency] of [
        [screw.path, 'USD'],
        [screwDe.path, 'EUR'],
      ] as const) {
        const { html } = await page(path);
        const offers = structuredData(html).offers as {
          '@type': string;
          priceCurrency: string;
          lowPrice: string;
          highPrice: string;
          offerCount: number;
          offers: { sku: string; price: string; priceCurrency: string }[];
        };

        expect(offers['@type']).toBe('AggregateOffer');
        expect(offers.priceCurrency).toBe(currency);

        // Every offer is a row the page prints a price in, and the amount is
        // the row's: digits for digits, whatever the language does with
        // separators and the sign.
        const printed = new Map(
          rows(html).flatMap((row) => {
            const amount = row.terms[0]?.[1].replace(/[^\d]/g, '') ?? '';
            return amount === '' ? [] : [[row.sku, amount] as const];
          }),
        );
        expect(offers.offers.map((offer) => offer.sku).sort()).toEqual(
          [...printed.keys()].sort(),
        );
        for (const offer of offers.offers) {
          expect(offer.priceCurrency).toBe(currency);
          expect(offer.price.replace('.', ''), offer.sku).toBe(
            `0${printed.get(offer.sku)}`.replace(/^0+(\d{3,})$/, '$1'),
          );
        }
        expect(offers.offerCount).toBe(printed.size);
        const amounts = offers.offers.map((offer) => Number(offer.price));
        expect(Number(offers.lowPrice)).toBe(Math.min(...amounts));
        expect(Number(offers.highPrice)).toBe(Math.max(...amounts));
      }
    });

    it('says of each offer what its row says: the state, the minimum order, the lead time', async () => {
      const offers = structuredData((await page(screw.path)).html).offers as {
        offers: Record<string, unknown>[];
      };
      const bySku = new Map(offers.offers.map((offer) => [offer.sku, offer]));

      expect(bySku.get('CS-10')).toEqual({
        '@type': 'Offer',
        sku: 'CS-10',
        price: '0.42',
        priceCurrency: 'USD',
        availability: 'https://schema.org/InStock',
        eligibleQuantity: { '@type': 'QuantitativeValue', minValue: 100 },
        deliveryLeadTime: {
          '@type': 'QuantitativeValue',
          minValue: 5,
          maxValue: 10,
          unitCode: 'DAY',
        },
      });
      expect(bySku.get('CS-16')?.availability).toBe(
        'https://schema.org/BackOrder',
      );
      expect(bySku.get('CS-25')?.availability).toBe(
        'https://schema.org/OutOfStock',
      );
    });

    it('is one Offer for a product sold in one size', async () => {
      expect(structuredData((await page(bolt.path)).html).offers).toEqual({
        '@type': 'Offer',
        sku: 'FB-30',
        price: '18.90',
        priceCurrency: 'USD',
        availability: 'https://schema.org/BackOrder',
      });
    });

    it('stays Mallok’s own node, with the offers added to it', async () => {
      const node = structuredData((await page(screw.path)).html);

      expect(node['@type']).toBe('Product');
      expect(node.name).toBe('Cap screw');
      expect(node.url).toBe(`${ORIGIN}${screw.path}`);
    });

    it('has no offers for a product with nothing priced', async () => {
      const node = structuredData((await page(washer.path)).html);

      expect(node['@type']).toBe('Product');
      expect(node).not.toHaveProperty('offers');
    });
  });

  describe('the catalogue and the home page', () => {
    it.each(['/products', '/'])(
      'print under each product on %s what it starts at and whether it can be had',
      async (path) => {
        const { status, html } = await page(path);

        expect(status).toBe(200);
        expect(listed(html, screw.path)).toBe('from $0.42 | In stock');
        expect(listed(html, bolt.path)).toBe('from $18.90 | Made to order');
        // Sold and not priced: its state, and no "from" with nothing after.
        expect(listed(html, spacer.path)).toBe('In stock');
        // No variants: the name and nothing under it.
        expect(listed(html, washer.path)).toBeNull();
      },
    );

    it('do so in the page’s language and currency', async () => {
      const { html } = await page('/de/products');

      expect(listed(html, screwDe.path)?.replace(/\s/g, ' ')).toBe(
        'ab 0,39 € | Auf Lager',
      );
    });

    it('leave the finder’s filters the rows they had', async () => {
      // The script reads a product's name from the link, and nothing else
      // from the cell it sits in.
      const { html } = await page('/products');
      const cell = between(html, '<div class="finder-product">', '</td>');

      expect(cell).toMatch(/<a href="[^"]+">[^<]+<\/a>/);
      expect(html).toContain('<form class="finder-filters" hidden ');
    });
  });

  describe('the currency switch', () => {
    it('gives each price its amount in every currency the page offers', async () => {
      const english = (await page(screw.path)).html;
      const german = (await page(screwDe.path)).html;

      // The amount showing is the page's own currency's; the others wait in
      // attributes, formatted as this language writes them.
      expect(english).toContain(
        '<span class="price" data-price data-usd="$0.42" data-eur="€0.39">$0.42</span>',
      );
      expect(german.replace(/\u00a0/g, ' ')).toContain(
        '<span class="price" data-price data-usd="0,42 $" data-eur="0,39 €">0,39 €</span>',
      );
    });

    it('is in the page once, hidden, with the page’s own currency pressed', async () => {
      expect(currencySwitches((await page(screw.path)).html)).toEqual([
        {
          own: 'usd',
          label: 'Currency',
          hidden: true,
          buttons: [
            ['usd', 'true', 'USD'],
            ['eur', 'false', 'EUR'],
          ],
        },
      ]);
      expect(currencySwitches((await page(screwDe.path)).html)).toEqual([
        {
          own: 'eur',
          label: 'Währung',
          hidden: true,
          buttons: [
            ['usd', 'false', 'USD'],
            ['eur', 'true', 'EUR'],
          ],
        },
      ]);
    });

    it.each(['/products', '/'])(
      'is above the finder on %s, whose starting prices it can change',
      async (path) => {
        const { html } = await page(path);

        expect(currencySwitches(html)).toHaveLength(1);
        expect(html).toContain(
          '<span class="price">from <span data-price data-usd="$0.42" data-eur="€0.39">$0.42</span></span>',
        );
        expect(html).toContain(SWITCH_SCRIPT);
      },
    );

    it('comes with its script, and only where there is a switch', async () => {
      expect((await page(screw.path)).html).toContain(SWITCH_SCRIPT);

      // Nothing priced, so nothing to switch: no control, no script.
      for (const path of [washer.path, spacer.path, collection.path]) {
        const { html } = await page(path);

        expect(currencySwitches(html), path).toEqual([]);
        expect(html, path).not.toContain('currency.js');
        expect(html, path).not.toContain('data-price');
      }
    });

    it('is absent from a page priced in one currency only', async () => {
      const single = await createContent({
        kind: 'product',
        title: 'Dollar part',
        slug: 'dollar-part',
      });
      await createVariant({
        id: 'dp-1',
        productGroup: single.translationGroup,
        sku: 'DP-1',
      });
      await setPrice({
        variantId: 'dp-1',
        currency: 'USD',
        amountMinor: 100,
        source: 'base',
      });
      const { html } = await page(single.path);

      expect(html).toContain('<span class="price">$1.00</span>');
      expect(currencySwitches(html)).toEqual([]);
      expect(html).not.toContain('currency.js');
    });
  });

  describe('a collection page', () => {
    it('lists its products without prices, because Mallok does not tell the plugin which products a content page lists', async () => {
      // Not a choice: `renderData` is given the items of a list or the home
      // page, and nothing of what a content page shows through a reference.
      // When Mallok passes those, this test fails, and the table here should
      // then be priced like the catalogue's.
      const { status, html } = await page(collection.path);

      expect(status).toBe(200);
      expect(html).toContain(`<a href="${screw.path}">Cap screw</a>`);
      expect(html).not.toContain('finder-offer');
    });
  });

  describe('the cache', () => {
    const tag = (content: TestContent) => `p:shop:${content.translationGroup}`;

    it('tags a product page with its product, in every language', async () => {
      expect((await page(screw.path)).tags).toContain(tag(screw));
      expect((await page(screwDe.path)).tags).toContain(tag(screw));
    });

    it('tags a product page that has no variants yet, so that the first one reaches it', async () => {
      expect((await page(washer.path)).tags).toContain(tag(washer));
    });

    it('tags a list and the home page with every product they show', async () => {
      for (const path of ['/products', '/']) {
        const { tags } = await page(path);

        for (const product of [screw, bolt, washer, spacer]) {
          expect(tags, path).toContain(tag(product));
        }
      }
    });

    it('tags the home page with products and nothing else it shows', async () => {
      // The home page also shows the newest collections; a price change
      // would purge it for those too if they were tagged.
      const { tags } = await page('/');

      expect(
        tags.filter((entry) => entry.startsWith('p:shop:')).sort(),
      ).toEqual([screw, bolt, washer, spacer].map(tag).sort());
    });

    it('gives a page that shows no product no tag of the shop’s', async () => {
      const { tags } = await page(collection.path);

      expect(tags.filter((entry) => entry.startsWith('p:shop:'))).toEqual([]);
    });

    it('stores a priced page like any other', async () => {
      const response = await SELF.fetch(`${ORIGIN}${screw.path}`);

      expect(response.headers.get('cache-control')).toBe(
        'public, max-age=0, s-maxage=3600',
      );
    });
  });

  describe('the cost of a cold render', () => {
    it('is three round trips to D1 for a product page: two of Mallok’s and one of the shop’s', async () => {
      // Created here so that no earlier test has put the page in the cache.
      const cold = await createContent({
        kind: 'product',
        title: 'Cold screw',
        slug: 'cold-screw',
        frontmatter: ['sizes:', '  CO-10: 10 mm'].join('\n'),
      });
      await createVariant({
        id: 'co-10',
        productGroup: cold.translationGroup,
        sku: 'CO-10',
      });
      await setPrice({
        variantId: 'co-10',
        currency: 'USD',
        amountMinor: 100,
        source: 'base',
      });

      let html = '';
      const calls = await countD1Calls(async () => {
        html = await (await SELF.fetch(`${ORIGIN}${cold.path}`)).text();
      });

      expect(rows(html)[0]?.terms[0]).toEqual(['Unit price', '$1.00']);
      expect(calls).toBe(3);
    });
  });
});
