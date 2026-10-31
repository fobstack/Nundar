/// <reference types="vite/client" />
import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import seedSql from '../../seed/shop-sample.sql';
import { SAMPLE_BUNDLES } from '../../src/starter/documents.generated.js';
import {
  SAMPLE_VARIANTS,
  SAMPLE_ZONES,
  sampleShop,
  withoutImages,
} from '../../src/starter/index.js';
import { api, db, ensureSite, ORIGIN } from './helpers.js';

/**
 * The sample shop as a starter: held to the seed `npm run preview` loads, and
 * run through Mallok's own wizard step on a site of its own.
 */

/**
 * Each product's slug, by the translation group its identity file fixes —
 * the group the seed attaches its variants to.
 */
const PRODUCT_SLUG_OF_GROUP = new Map(
  Object.values(
    import.meta.glob<{
      translation_group: string;
      items: { en: { slug: string } };
    }>('../../content/product/*/mallok.json', {
      eager: true,
      import: 'default',
    }),
  ).map((identity) => [identity.translation_group, identity.items.en.slug]),
);

/** The value tuples of one `INSERT … VALUES` of the seed, as strings. */
function seedRows(table: string): string[][] {
  const start = seedSql.indexOf(`INSERT OR IGNORE INTO ${table}`);
  const values = seedSql.indexOf('VALUES', start);
  const end = seedSql.indexOf(';', values);
  return [...seedSql.slice(values, end).matchAll(/\(([^()]*)\)/g)].map(
    (match) =>
      (match[1] ?? '')
        .split(/,(?=(?:[^']*'[^']*')*[^']*$)/)
        .map((part) => part.trim().replace(/^'(.*)'$/, '$1')),
  );
}

describe('the starter’s Markdown', () => {
  it('leaves out a cover, a gallery and a picture in the body, and nothing else', () => {
    const before = [
      '---',
      'title: A bolt',
      'cover: images/cover.jpg',
      'gallery:',
      '  - images/cover.jpg',
      '  - images/side.jpg',
      'collection: bolts',
      'sizes:',
      '  B-1: 10 mm',
      '---',
      '',
      'Text.',
      '',
      '![A drawing](images/drawing.png)',
      '',
      'More text, with ![an inline one](images/x.png) left as it is.',
      '',
    ].join('\n');

    expect(withoutImages(before)).toBe(
      [
        '---',
        'title: A bolt',
        'collection: bolts',
        'sizes:',
        '  B-1: 10 mm',
        '---',
        '',
        'Text.',
        '',
        'More text, with ![an inline one](images/x.png) left as it is.',
        '',
      ].join('\n'),
    );
  });

  it('names no picture of the sample’s anywhere', () => {
    for (const document of sampleShop.documents) {
      const texts = [
        document.markdown,
        ...Object.values(document.translations ?? {}).map((t) => t.markdown),
      ];
      for (const text of texts) {
        expect(text, document.slug).not.toMatch(/images\//);
      }
    }
    expect(sampleShop.documents).toHaveLength(SAMPLE_BUNDLES.length);
  });
});

describe('the starter’s records', () => {
  it('are the seed’s variants, prices and zones', () => {
    const variants = seedRows('p_shop_variant');
    const prices = seedRows('p_shop_price');
    expect(PRODUCT_SLUG_OF_GROUP.size).toBeGreaterThan(0);
    expect(
      SAMPLE_VARIANTS.map((variant) => [
        variant.product,
        variant.sku,
        JSON.stringify({ length: variant.length }),
        String(variant.moq),
        String(variant.leadTime[0]),
        String(variant.leadTime[1]),
        String(variant.stock),
        variant.stockPolicy,
        String(variant.position),
      ]),
    ).toEqual(
      variants.map((row) => [
        PRODUCT_SLUG_OF_GROUP.get(row[1] ?? ''),
        row[2],
        row[3],
        row[4],
        row[5],
        row[6],
        row[7],
        row[8],
        row[10],
      ]),
    );
    const priceOf = (sku: string, currency: string) => {
      const variant = variants.find((row) => row[2] === sku)?.[0];
      return Number(
        prices.find((row) => row[0] === variant && row[1] === currency)?.[2],
      );
    };
    for (const variant of SAMPLE_VARIANTS) {
      expect(variant.prices, variant.sku).toEqual([
        priceOf(variant.sku, 'USD'),
        priceOf(variant.sku, 'EUR'),
        priceOf(variant.sku, 'GBP'),
      ]);
    }

    const zones = seedRows('p_shop_shipping_zone');
    const countries = seedRows('p_shop_shipping_country');
    const rates = seedRows('p_shop_shipping_rate');
    expect(
      SAMPLE_ZONES.map((zone) => ({
        name: zone.name,
        countries: [...zone.countries].sort(),
        rates: zone.rates
          .map(
            (rate) =>
              `${rate.currency}:${rate.amount}:${rate.freeOver ?? 'NULL'}`,
          )
          .sort(),
      })),
    ).toEqual(
      zones.map((zone) => ({
        name: zone[1],
        countries: countries
          .filter((row) => row[1] === zone[0])
          .map((row) => row[0])
          .sort(),
        rates: rates
          .filter((row) => row[0] === zone[0])
          .map((row) => `${row[1]}:${row[2]}:${row[3]}`)
          .sort(),
      })),
    );
  });
});

describe('the starter, through Mallok’s wizard', () => {
  let answer: Record<string, unknown> = {};

  beforeAll(async () => {
    await ensureSite();
    const response = await api('POST', '/_mallok/api/setup/starter', {
      starter: 'nundar-sample',
    });
    answer = (await response.json()) as Record<string, unknown>;
    expect(response.status, JSON.stringify(answer)).toBe(200);
  });

  it('imports every document, translation and record, and refuses none', () => {
    expect(answer.failed).toEqual([]);
    expect(answer.failedRecords).toEqual([]);
    const documents = SAMPLE_BUNDLES.reduce(
      (sum, bundle) => sum + 1 + Object.keys(bundle.translations).length,
      0,
    );
    expect(answer.created).toBe(documents);
    expect(answer.records).toBe(SAMPLE_VARIANTS.length + SAMPLE_ZONES.length);
  });

  it('gives each product its variants, with their prices, and the zones their countries', async () => {
    const variants = await db()
      .prepare('SELECT COUNT(*) AS n FROM p_shop_variant')
      .first<{ n: number }>();
    const prices = await db()
      .prepare(
        'SELECT source, COUNT(*) AS n FROM p_shop_price GROUP BY source ORDER BY source',
      )
      .all<{ source: string; n: number }>();
    const countries = await db()
      .prepare('SELECT COUNT(*) AS n FROM p_shop_shipping_country')
      .first<{ n: number }>();
    expect(variants?.n).toBe(SAMPLE_VARIANTS.length);
    expect(prices.results).toEqual([
      { source: 'base', n: SAMPLE_VARIANTS.length },
      { source: 'manual', n: 2 * SAMPLE_VARIANTS.length },
    ]);
    expect(countries?.n).toBe(
      SAMPLE_ZONES.reduce((sum, zone) => sum + zone.countries.length, 0),
    );
    const rates = await db()
      .prepare(
        `SELECT z.name, r.currency, r.amount_minor, r.free_over_minor
         FROM p_shop_shipping_rate AS r
         JOIN p_shop_shipping_zone AS z ON z.id = r.zone_id
         ORDER BY z.name, r.currency`,
      )
      .all<{
        name: string;
        currency: string;
        amount_minor: number;
        free_over_minor: number | null;
      }>();
    expect(rates.results).toEqual(
      SAMPLE_ZONES.flatMap((zone) =>
        zone.rates.map((rate) => ({
          name: zone.name,
          currency: rate.currency,
          amount_minor: rate.amount,
          free_over_minor: rate.freeOver,
        })),
      ).sort(
        (a, b) =>
          a.name.localeCompare(b.name) || a.currency.localeCompare(b.currency),
      ),
    );
  });

  it('serves a product page with its prices, in every language', async () => {
    for (const [path, price] of [
      ['/products/titanium-socket-head-cap-screw-m5', '$1.85'],
      ['/de/products/titan-zylinderschraube-innensechskant-m5', '1,75'],
      ['/fr/products/vis-titane-tete-cylindrique-six-pans-creux-m5', '1,75'],
      ['/es/products/tornillo-titanio-cabeza-cilindrica-allen-m5', '1,75'],
    ] as const) {
      const response = await SELF.fetch(`${ORIGIN}${path}`);
      const html = await response.text();
      expect(response.status, path).toBe(200);
      expect(html, path).toContain('TI-SHC-M5-10');
      expect(html, path).toContain(price);
      expect(html, path).not.toMatch(/images\/cover/);
    }
  });
});
