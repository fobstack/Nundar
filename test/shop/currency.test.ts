import { describe, expect, it } from 'vitest';
import {
  BASE_CURRENCY,
  CURRENCIES,
  defaultCurrencyForLocale,
  isCurrency,
  settleCurrency,
} from '../../src/plugins/shop/lib/currency.js';

describe('defaultCurrencyForLocale', () => {
  it('shows English pages in USD', () => {
    expect(defaultCurrencyForLocale('en')).toBe('USD');
    expect(defaultCurrencyForLocale('en-GB')).toBe('USD');
    expect(defaultCurrencyForLocale('EN')).toBe('USD');
  });

  it('shows every other language in EUR', () => {
    expect(defaultCurrencyForLocale('de')).toBe('EUR');
    expect(defaultCurrencyForLocale('fr')).toBe('EUR');
    expect(defaultCurrencyForLocale('es')).toBe('EUR');
  });
});

describe('isCurrency', () => {
  it('accepts the supported currencies and nothing else', () => {
    for (const currency of CURRENCIES) {
      expect(isCurrency(currency)).toBe(true);
    }
    expect(isCurrency('JPY')).toBe(false);
    expect(isCurrency('usd')).toBe(false);
    expect(isCurrency('')).toBe(false);
  });

  it('prices by hand in a currency the shop supports', () => {
    expect(isCurrency(BASE_CURRENCY)).toBe(true);
  });
});

describe('settleCurrency', () => {
  it('is the currency asked for when everything has a price in it', () => {
    expect(settleCurrency('EUR', ['USD', 'EUR', 'GBP'])).toBe('EUR');
    expect(settleCurrency('GBP', ['USD', 'GBP'])).toBe('GBP');
  });

  it('is the base currency when the one asked for is not shared', () => {
    expect(settleCurrency('EUR', ['USD', 'GBP'])).toBe('USD');
  });

  it('is whatever is shared when neither is', () => {
    // A part priced only in euros, on a page that asked for dollars: shown
    // in euros rather than not at all.
    expect(settleCurrency('USD', ['EUR'])).toBe('EUR');
    expect(settleCurrency('GBP', ['EUR'])).toBe('EUR');
  });

  it('is the currency asked for when nothing is shared at all', () => {
    expect(settleCurrency('EUR', [])).toBe('EUR');
  });
});
