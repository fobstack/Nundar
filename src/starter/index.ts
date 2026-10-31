/**
 * The sample shop, as a starter Mallok's first-run wizard offers
 * (`mallok: docs/ARCHITECTURE.md §11.1`; design §21).
 *
 * A site deployed from this repository with `mallok create` can be filled
 * with the sample from the wizard, with no command to run: the catalogue in
 * four languages, its variants and prices, and the zones it ships to. The
 * documents are `content/`, listed by `scripts/starter-documents.mjs`; the
 * settings are `site.json`'s; the records are what `seed/shop-sample.sql`
 * loads for `npm run preview`, and `test/shop/starter.test.ts` holds the two
 * to each other.
 *
 * **Without its images.** A starter carries Markdown and records, and no
 * files: the wizard has nowhere to upload a picture from. A cover, a gallery
 * and a picture in a body would each point at a file that is not there, so
 * they are left out, and the theme draws every page whole without them. The
 * sample with its pictures is `mallok publish .` from this repository, as
 * `npm run preview` does.
 */

import { defineStarter, type StarterRecord } from 'mallok/worker';
import site from '../../site.json';
import { SAMPLE_BUNDLES } from './documents.generated.js';

/**
 * A bundle's Markdown without what names a picture of its own: the `cover`
 * and `gallery` of its front matter, and a picture on a line of its own in
 * its body. Nothing else is touched.
 */
export function withoutImages(markdown: string): string {
  const end = markdown.indexOf('\n---', 3);
  if (!markdown.startsWith('---') || end === -1) {
    return markdown.replace(/^!\[[^\]]*\]\(images\/[^)]*\)\s*\n?/gm, '');
  }
  const head = markdown.slice(0, end).split('\n');
  const kept: string[] = [];
  let inGallery = false;
  for (const line of head) {
    if (inGallery && /^\s+-\s/.test(line)) {
      continue;
    }
    inGallery = false;
    if (/^cover:\s*images\//.test(line)) {
      continue;
    }
    if (/^gallery:\s*$/.test(line)) {
      inGallery = true;
      continue;
    }
    kept.push(line);
  }
  const body = markdown
    .slice(end)
    .replace(/^!\[[^\]]*\]\(images\/[^)]*\)[ \t]*\n(\n)?/gm, '');
  return `${kept.join('\n')}${body}`;
}

/** A variant of the sample, as its product's form under the editor takes it. */
interface SampleVariant {
  readonly product: string;
  readonly sku: string;
  readonly length: string;
  readonly moq: number;
  readonly stock: number;
  readonly stockPolicy: 'track' | 'made_to_order';
  readonly leadTime: readonly [number, number];
  /** USD, EUR and GBP, in minor units: the base price and two set by hand. */
  readonly prices: readonly [number, number, number];
  readonly position: number;
}

/** The sample's variants: one per SKU a product page lists. */
export const SAMPLE_VARIANTS: readonly SampleVariant[] = [
  {
    product: 'titanium-socket-head-cap-screw-m5',
    sku: 'TI-SHC-M5-10',
    length: '10 mm',
    moq: 100,
    stock: 12_000,
    stockPolicy: 'track',
    leadTime: [5, 10],
    prices: [185, 175, 150],
    position: 0,
  },
  {
    product: 'titanium-socket-head-cap-screw-m5',
    sku: 'TI-SHC-M5-16',
    length: '16 mm',
    moq: 100,
    stock: 9000,
    stockPolicy: 'track',
    leadTime: [5, 10],
    prices: [205, 195, 165],
    position: 1,
  },
  {
    product: 'titanium-socket-head-cap-screw-m5',
    sku: 'TI-SHC-M5-20',
    length: '20 mm',
    moq: 100,
    stock: 15_000,
    stockPolicy: 'track',
    leadTime: [5, 10],
    prices: [220, 210, 180],
    position: 2,
  },
  {
    product: 'titanium-socket-head-cap-screw-m5',
    sku: 'TI-SHC-M5-25',
    length: '25 mm',
    moq: 100,
    stock: 6000,
    stockPolicy: 'track',
    leadTime: [5, 10],
    prices: [245, 230, 200],
    position: 3,
  },
  {
    product: 'titanium-button-head-torx-screw-m3',
    sku: 'TI-BTN-M3-10',
    length: '10 mm',
    moq: 200,
    stock: 20_000,
    stockPolicy: 'track',
    leadTime: [5, 10],
    prices: [160, 150, 130],
    position: 0,
  },
  {
    product: 'titanium-button-head-hex-screw-m4',
    sku: 'TI-BTN-M4-12',
    length: '12 mm',
    moq: 200,
    stock: 8000,
    stockPolicy: 'track',
    leadTime: [10, 15],
    prices: [210, 200, 170],
    position: 0,
  },
  {
    product: 'titanium-countersunk-flat-screw-m6',
    sku: 'TI-CSK-M6-16',
    length: '16 mm',
    moq: 100,
    stock: 7000,
    stockPolicy: 'track',
    leadTime: [5, 10],
    prices: [260, 245, 210],
    position: 0,
  },
  {
    product: 'titanium-hex-head-flange-bolt-m8',
    sku: 'TI-HEX-M8-30',
    length: '30 mm',
    moq: 50,
    stock: 3000,
    stockPolicy: 'track',
    leadTime: [10, 15],
    prices: [480, 455, 390],
    position: 0,
  },
  {
    product: 'titanium-shoulder-screw-m6',
    sku: 'TI-SHL-M6-20',
    length: '20 mm',
    moq: 25,
    stock: 0,
    stockPolicy: 'made_to_order',
    leadTime: [20, 30],
    prices: [1250, 1185, 1020],
    position: 0,
  },
];

/** A shipping zone of the sample, with its rates in USD, EUR and GBP. */
interface SampleZone {
  readonly name: string;
  readonly countries: readonly string[];
  readonly rates: readonly {
    readonly currency: 'USD' | 'EUR' | 'GBP';
    readonly amount: number;
    readonly freeOver: number | null;
  }[];
  readonly position: number;
}

export const SAMPLE_ZONES: readonly SampleZone[] = [
  {
    name: 'Europe',
    countries: [
      'AT',
      'BE',
      'DE',
      'DK',
      'ES',
      'FI',
      'FR',
      'IE',
      'IT',
      'LU',
      'NL',
      'PL',
      'PT',
      'SE',
    ],
    rates: [
      { currency: 'EUR', amount: 2500, freeOver: 50_000 },
      { currency: 'USD', amount: 2900, freeOver: null },
      { currency: 'GBP', amount: 2200, freeOver: null },
    ],
    position: 0,
  },
  {
    name: 'United Kingdom',
    countries: ['GB'],
    rates: [
      { currency: 'GBP', amount: 1500, freeOver: 40_000 },
      { currency: 'EUR', amount: 1800, freeOver: null },
      { currency: 'USD', amount: 1900, freeOver: null },
    ],
    position: 1,
  },
  {
    name: 'North America',
    countries: ['CA', 'US'],
    rates: [
      { currency: 'USD', amount: 3500, freeOver: 75_000 },
      { currency: 'EUR', amount: 3200, freeOver: null },
      { currency: 'GBP', amount: 2800, freeOver: null },
    ],
    position: 2,
  },
  {
    name: 'Asia Pacific',
    countries: ['AU', 'JP', 'KR', 'NZ', 'SG'],
    rates: [
      { currency: 'USD', amount: 4500, freeOver: null },
      { currency: 'EUR', amount: 4200, freeOver: null },
      { currency: 'GBP', amount: 3600, freeOver: null },
    ],
    position: 3,
  },
];

function variantRecord(variant: SampleVariant): StarterRecord {
  const [usd, eur, gbp] = variant.prices;
  return {
    plugin: 'shop',
    panel: 'variants',
    attachedTo: { kind: 'product', slug: variant.product },
    values: {
      sku: variant.sku,
      options: { length: variant.length },
      status: 'active',
      price: { amount: usd, currency: 'USD' },
      other_prices: [
        { price: { amount: eur, currency: 'EUR' } },
        { price: { amount: gbp, currency: 'GBP' } },
      ],
      moq: variant.moq,
      stock_policy: variant.stockPolicy,
      stock: variant.stock,
      lead_time_min: variant.leadTime[0],
      lead_time_max: variant.leadTime[1],
      sort_order: variant.position,
    },
  };
}

function zoneRecord(zone: SampleZone): StarterRecord {
  return {
    plugin: 'shop',
    panel: 'shipping',
    values: {
      name: zone.name,
      countries: [...zone.countries],
      rates: zone.rates.map((rate) => ({
        price: { amount: rate.amount, currency: rate.currency },
        free_over:
          rate.freeOver === null
            ? null
            : { amount: rate.freeOver, currency: rate.currency },
      })),
      sort_order: zone.position,
    },
  };
}

export const sampleShop = defineStarter({
  id: 'nundar-sample',
  name: 'Titanium fastener sample shop',
  description:
    'A catalogue of titanium fasteners in English, German, French and Spanish, with variants, prices in three currencies and four shipping zones. Without its pictures, which a starter cannot carry.',
  theme: 'nundar',
  plugins: ['shop', 'inquiry'],
  settings: {
    locales: site.locales,
    kinds: site.kinds,
    nav: site.nav,
    themeOptions: site.themeOptions,
    tagline: site.tagline,
  },
  documents: SAMPLE_BUNDLES.map((bundle) => ({
    kind: bundle.kind,
    slug: bundle.slug,
    markdown: withoutImages(bundle.markdown),
    translations: Object.fromEntries(
      Object.entries(bundle.translations).map(([locale, translation]) => [
        locale,
        {
          slug: translation.slug,
          markdown: withoutImages(translation.markdown),
        },
      ]),
    ),
  })),
  records: [
    ...SAMPLE_VARIANTS.map(variantRecord),
    ...SAMPLE_ZONES.map(zoneRecord),
  ],
});
