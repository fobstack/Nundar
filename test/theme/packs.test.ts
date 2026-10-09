import { describe, expect, it } from 'vitest';
import { INQUIRY_FIELDS } from '../../src/plugins/shop/lib/inquiries.js';
import { INQUIRY_REFUSALS } from '../../src/plugins/shop/routes/inquiry.js';
import de from '../../src/theme/locales/de.json';
import en from '../../src/theme/locales/en.json';
import es from '../../src/theme/locales/es.json';
import fr from '../../src/theme/locales/fr.json';

/**
 * The theme's words, held to each other and to the shop.
 *
 * A key missing from a language falls back to English without a sound, and
 * a kind the shop names that the pack has no words for prints nothing at
 * all: neither shows on a page that is merely looked at.
 */

const PACKS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  en,
  de,
  fr,
  es,
};

describe('the theme’s language packs', () => {
  it.each(['de', 'fr', 'es'])(
    'say in %s everything the default language says',
    (locale) => {
      const pack = PACKS[locale] ?? {};

      const missing = Object.keys(en).filter(
        (key) => typeof pack[key] !== 'string' || pack[key].trim() === '',
      );

      expect(missing).toEqual([]);
    },
  );

  it('leave nothing blank in the default language', () => {
    expect(
      Object.entries(en)
        .filter(([, text]) => text.trim() === '')
        .map(([key]) => key),
    ).toEqual([]);
  });

  it.each(Object.keys(PACKS))(
    'have words in %s for every reason the shop gives and every field it names',
    (locale) => {
      const pack = PACKS[locale] ?? {};
      const keys = [
        // Why a cart was not sent as an inquiry, and which field was wrong.
        ...INQUIRY_REFUSALS.map((kind) => `quote_problem_${kind}`),
        ...INQUIRY_FIELDS.map((field) => `quote_${field}`),
        // Why a change to the cart was refused, or a line cannot be ordered.
        ...[
          'unavailable',
          'below_moq',
          'insufficient_stock',
          'quantity_too_large',
          'cart_full',
          'no_price',
        ].map((kind) => `problem_${kind}`),
        ...['in_stock', 'made_to_order', 'out_of_stock'].map(
          (state) => `avail_${state}`,
        ),
      ];

      expect(keys.filter((key) => !(key in pack))).toEqual([]);
    },
  );

  it('keep the words of Mallok’s own inquiry form out of the default language', () => {
    // English keys would replace the plugin's own text in every language
    // this theme has no pack for. The cart's form has keys of its own.
    expect(Object.keys(en).filter((key) => key.startsWith('inquiry_'))).toEqual(
      [],
    );
  });
});
