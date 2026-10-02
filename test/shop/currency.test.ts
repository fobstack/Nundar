import { describe, expect, it } from 'vitest';
import {
  BASE_CURRENCY,
  CURRENCIES,
  defaultCurrencyForLocale,
  isCurrency,
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
