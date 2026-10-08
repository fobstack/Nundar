import { describe, expect, it } from 'vitest';
import type { Currency } from '../../src/plugins/shop/lib/currency.js';
import {
  currenciesFor,
  listView,
  offersFor,
  productView,
  type StorefrontPriceRow,
  type StorefrontVariantRow,
} from '../../src/plugins/shop/lib/storefront.js';

/**
 * What a page shows of the shop, from rows alone.
 *
 * No database and no Worker: these are the rules a buyer reads the result
 * of — which currency a page is in, what "from" means, what an out-of-stock
 * size still says — and each is easier to get wrong than to notice.
 */

function variant(
  id: string,
  over: Partial<StorefrontVariantRow> = {},
): StorefrontVariantRow {
  return {
    id,
    product_group: 'group-a',
    sku: `SKU-${id}`,
    option_values: '{}',
    moq: 1,
    lead_time_min: null,
    lead_time_max: null,
    stock: 100,
    stock_policy: 'track',
    ...over,
  };
}

function price(
  variantId: string,
  currency: string,
  amountMinor: number,
): StorefrontPriceRow {
  return { variant_id: variantId, currency, amount_minor: amountMinor };
}

const amounts = (
  entries: [Currency, number][],
): ReadonlyMap<Currency, number> => new Map(entries);

describe('the currency a page is in', () => {
  it('is the language’s own when every priced variant has it', () => {
    const priced = [
      amounts([
        ['USD', 100],
        ['EUR', 95],
      ]),
      amounts([
        ['USD', 200],
        ['EUR', 190],
      ]),
    ];

    expect(currenciesFor('en', priced).currency).toBe('USD');
    expect(currenciesFor('de', priced).currency).toBe('EUR');
    expect(currenciesFor('fr-FR', priced).currency).toBe('EUR');
  });

  it('falls back to the base currency when one variant lacks the language’s own', () => {
    // Before the first exchange rates arrive, or for a variant added since,
    // there is a dollar price and nothing else. A page with euros in one row
    // and dollars in the next cannot be compared.
    const priced = [
      amounts([
        ['USD', 100],
        ['EUR', 95],
      ]),
      amounts([['USD', 200]]),
    ];

    expect(currenciesFor('de', priced)).toEqual({
      currency: 'USD',
      currencies: ['USD'],
    });
  });

  it('offers only the currencies every priced variant shares, in the shop’s order', () => {
    const priced = [
      amounts([
        ['GBP', 80],
        ['EUR', 95],
        ['USD', 100],
      ]),
      amounts([
        ['USD', 200],
        ['GBP', 160],
      ]),
    ];

    expect(currenciesFor('en', priced).currencies).toEqual(['USD', 'GBP']);
  });

  it('is the language’s own when nothing on the page is priced, and no currency is offered', () => {
    // Nothing to switch between: a switch that changed nothing would be a
    // control that does nothing.
    expect(currenciesFor('es', [])).toEqual({
      currency: 'EUR',
      currencies: [],
    });
  });
});

describe('a product page’s view', () => {
  it('is nothing when the product has no variants', () => {
    expect(productView([], [], 'en')).toBeUndefined();
  });

  it('prints each variant’s price in the page’s currency and in every other it offers', () => {
    const view = productView(
      [variant('a'), variant('b')],
      [
        price('a', 'USD', 42),
        price('a', 'EUR', 39),
        price('b', 'USD', 1250),
        price('b', 'EUR', 1199),
      ],
      'en',
    );

    expect(view?.currency).toBe('USD');
    expect(view?.currencies).toEqual(['USD', 'EUR']);
    expect(view?.variants.map((entry) => entry.price)).toEqual([
      '$0.42',
      '$12.50',
    ]);
    expect(view?.variants[0]?.prices).toEqual([
      { currency: 'USD', display: '$0.42' },
      { currency: 'EUR', display: '€0.39' },
    ]);
  });

  it('formats an amount the way the page’s language writes one', () => {
    const rows = [variant('a')];
    const prices = [price('a', 'USD', 123456), price('a', 'EUR', 119999)];

    // Compared without regard to the kind of space: the German and French
    // formats use a no-break one before the sign.
    const shown = (locale: string) =>
      productView(rows, prices, locale)?.variants[0]?.price.replace(/\s/g, ' ');

    expect(shown('en')).toBe('$1,234.56');
    expect(shown('de')).toBe('1.199,99 €');
    expect(shown('fr')).toBe('1 199,99 €');
    expect(shown('es')).toBe('1199,99 €');
  });

  it('leaves a variant without a price unpriced, and the others as they are', () => {
    const view = productView(
      [variant('a'), variant('b')],
      [price('a', 'USD', 42)],
      'en',
    );

    expect(view?.variants.map((entry) => entry.price)).toEqual(['$0.42', '']);
    expect(view?.variants[1]?.prices).toEqual([]);
    expect(view?.price_from).toBe('$0.42');
  });

  it('never passes a currency the shop does not price in, or an amount that is not whole', () => {
    const view = productView(
      [variant('a'), variant('b'), variant('c')],
      [price('a', 'USD', 42), price('b', 'JPY', 4200), price('c', 'USD', 99.5)],
      'en',
    );

    // A row the shop cannot read is no price at all for its variant. It is
    // not a price in no currency, which would leave the page with no
    // currency every variant shares and take the first variant's with it.
    expect(view?.variants.map((entry) => entry.price)).toEqual([
      '$0.42',
      '',
      '',
    ]);
    expect(view?.currencies).toEqual(['USD']);
    expect(view?.price_from).toBe('$0.42');
  });

  it('says what state each variant is in, and never how many are left', () => {
    const view = productView(
      [
        variant('a', { stock: 500, moq: 100 }),
        variant('b', { stock: 50, moq: 100 }),
        variant('c', { stock: 0, stock_policy: 'made_to_order' }),
      ],
      [],
      'en',
    );

    expect(view?.variants.map((entry) => entry.availability)).toEqual([
      'in_stock',
      'out_of_stock',
      'made_to_order',
    ]);
    expect(JSON.stringify(view)).not.toMatch(/"stock"/);
    expect(JSON.stringify(view)).not.toContain('500');
  });

  it('states a lead time only when both ends are known and in order', () => {
    const shown = (min: number | null, max: number | null) =>
      productView(
        [variant('a', { lead_time_min: min, lead_time_max: max })],
        [],
        'en',
      )?.variants[0]?.lead_time;

    expect(shown(15, 20)).toBe('15–20');
    expect(shown(5, 5)).toBe('5');
    expect(shown(null, 20)).toBe('');
    expect(shown(15, null)).toBe('');
    expect(shown(20, 15)).toBe('');
    expect(shown(-1, 5)).toBe('');
  });

  it('names a variant by its option values, in the order they were entered', () => {
    const labelled = (optionValues: string) =>
      productView([variant('a', { option_values: optionValues })], [], 'en')
        ?.variants[0]?.label;

    expect(labelled('{"length":"10 mm"}')).toBe('10 mm');
    expect(labelled('{"thread":"M5","length":"10 mm"}')).toBe('M5 / 10 mm');
    expect(labelled('{"length":16}')).toBe('16');
    expect(labelled('{"length":"","finish":"Anodised"}')).toBe('Anodised');
    expect(labelled('{}')).toBe('');
    expect(labelled('not json')).toBe('');
    expect(labelled('["10 mm"]')).toBe('');
  });

  describe('the price a product starts from', () => {
    it('is the lowest among the variants that can be ordered', () => {
      const view = productView(
        [
          variant('a', { stock: 0 }),
          variant('b'),
          variant('c', { stock: 0, stock_policy: 'made_to_order' }),
        ],
        [price('a', 'USD', 10), price('b', 'USD', 55), price('c', 'USD', 42)],
        'en',
      );

      // The cheapest variant is out of stock: nobody can buy at that price.
      expect(view?.price_from).toBe('$0.42');
      expect(view?.prices_from).toEqual([
        { currency: 'USD', display: '$0.42' },
      ]);
    });

    it('is the lowest of all when none can be ordered', () => {
      const view = productView(
        [variant('a', { stock: 0 }), variant('b', { stock: 0 })],
        [price('a', 'USD', 55), price('b', 'USD', 42)],
        'en',
      );

      expect(view?.price_from).toBe('$0.42');
    });
  });
});

describe('a list page’s view', () => {
  const items = [
    { id: 'content-a', translationGroup: 'group-a' },
    { id: 'content-b', translationGroup: 'group-b' },
    { id: 'content-c', translationGroup: 'group-c' },
  ];

  it('is nothing when no product on the page has a variant', () => {
    expect(listView(items, [], [], 'en')).toBeUndefined();
  });

  it('gives each product that has variants its starting price and its state, by content id', () => {
    const view = listView(
      items,
      [
        variant('a1', { product_group: 'group-a' }),
        variant('a2', { product_group: 'group-a' }),
        variant('b1', {
          product_group: 'group-b',
          stock: 0,
          stock_policy: 'made_to_order',
        }),
      ],
      [
        price('a1', 'USD', 55),
        price('a2', 'USD', 42),
        price('b1', 'USD', 1890),
      ],
      'en',
    );

    expect(view?.products).toEqual({
      'content-a': {
        price_from: '$0.42',
        prices_from: [{ currency: 'USD', display: '$0.42' }],
        availability: 'in_stock',
      },
      'content-b': {
        price_from: '$18.90',
        prices_from: [{ currency: 'USD', display: '$18.90' }],
        availability: 'made_to_order',
      },
    });
  });

  it('is in one currency for the whole page', () => {
    // One product has euros and the other does not yet.
    const view = listView(
      items,
      [
        variant('a1', { product_group: 'group-a' }),
        variant('b1', { product_group: 'group-b' }),
      ],
      [price('a1', 'USD', 42), price('a1', 'EUR', 39), price('b1', 'USD', 55)],
      'de',
    );

    expect(view?.currency).toBe('USD');
    expect(
      Object.values(view?.products ?? {}).map((entry) =>
        entry.price_from.replace(/\s/g, ' '),
      ),
    ).toEqual(['0,42 $', '0,55 $']);
  });

  it('sums a product’s variants into the best state any of them offers', () => {
    const state = (variants: StorefrontVariantRow[]) =>
      listView([{ id: 'c', translationGroup: 'group-a' }], variants, [], 'en')
        ?.products.c?.availability;

    expect(state([variant('a', { stock: 0 }), variant('b')])).toBe('in_stock');
    expect(
      state([
        variant('a', { stock: 0 }),
        variant('b', { stock: 0, stock_policy: 'made_to_order' }),
      ]),
    ).toBe('made_to_order');
    expect(state([variant('a', { stock: 0 })])).toBe('out_of_stock');
  });
});

describe('the offers in a product’s structured data', () => {
  it('are absent when the page shows no price', () => {
    expect(offersFor([variant('a')], [], 'en')).toBeUndefined();
    expect(offersFor([], [], 'en')).toBeUndefined();
  });

  it('are one Offer for one priced variant, in major units', () => {
    expect(offersFor([variant('a')], [price('a', 'USD', 9900)], 'en')).toEqual({
      '@type': 'Offer',
      sku: 'SKU-a',
      price: '99.00',
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
    });
  });

  it('are an AggregateOffer over several, with the range the page shows', () => {
    const offers = offersFor(
      [variant('a'), variant('b'), variant('c')],
      [price('a', 'USD', 55), price('b', 'USD', 42), price('c', 'USD', 1250)],
      'en',
    );

    expect(offers).toMatchObject({
      '@type': 'AggregateOffer',
      priceCurrency: 'USD',
      lowPrice: '0.42',
      highPrice: '12.50',
      offerCount: 3,
    });
    const held = (offers?.offers ?? []) as { sku: string; price: string }[];
    expect(held.map((offer) => [offer.sku, offer.price])).toEqual([
      ['SKU-a', '0.55'],
      ['SKU-b', '0.42'],
      ['SKU-c', '12.50'],
    ]);
  });

  it('are in the currency the page is in, and leave out a variant the page shows no price for', () => {
    const offers = offersFor(
      [variant('a'), variant('b')],
      [price('a', 'USD', 42), price('a', 'EUR', 39), price('b', 'USD', 55)],
      'de',
    );

    // German page, but one variant has no euro price: the page is in dollars.
    expect(offers).toMatchObject({
      '@type': 'AggregateOffer',
      priceCurrency: 'USD',
      offerCount: 2,
    });

    const single = offersFor(
      [variant('a'), variant('b')],
      [price('a', 'USD', 42), price('a', 'EUR', 39)],
      'de',
    );
    expect(single).toMatchObject({
      '@type': 'Offer',
      sku: 'SKU-a',
      price: '0.39',
      priceCurrency: 'EUR',
    });
  });

  it.each([
    [{ stock: 10, moq: 1 }, 'https://schema.org/InStock'],
    [{ stock: 5, moq: 10 }, 'https://schema.org/OutOfStock'],
    [
      { stock: 0, stock_policy: 'made_to_order' },
      'https://schema.org/BackOrder',
    ],
  ])('say %o is %s', (over, availability) => {
    expect(
      offersFor([variant('a', over)], [price('a', 'USD', 100)], 'en'),
    ).toMatchObject({ availability });
  });

  it('state a minimum order above one, and a lead time the page states', () => {
    const offer = offersFor(
      [variant('a', { moq: 100, lead_time_min: 15, lead_time_max: 20 })],
      [price('a', 'USD', 100)],
      'en',
    );

    expect(offer).toMatchObject({
      eligibleQuantity: { '@type': 'QuantitativeValue', minValue: 100 },
      deliveryLeadTime: {
        '@type': 'QuantitativeValue',
        minValue: 15,
        maxValue: 20,
        unitCode: 'DAY',
      },
    });

    const plain = offersFor(
      [variant('a', { lead_time_min: 15, lead_time_max: null })],
      [price('a', 'USD', 100)],
      'en',
    );
    expect(plain).not.toHaveProperty('eligibleQuantity');
    expect(plain).not.toHaveProperty('deliveryLeadTime');
  });
});
