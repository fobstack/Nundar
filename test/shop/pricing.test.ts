import { describe, expect, it } from 'vitest';
import {
  applyPsychologicalRounding,
  convertPrice,
  DEFAULT_PRICING_RULES,
  needsRecalculation,
  pricingRulesFromSettings,
} from '../../src/plugins/shop/lib/pricing.js';

describe('applyPsychologicalRounding', () => {
  it('rounds up to the next .99 ending', () => {
    expect(applyPsychologicalRounding(9108, 'ending99', 'EUR')).toBe(9199);
    expect(applyPsychologicalRounding(9200, 'ending99', 'EUR')).toBe(9299);
  });

  it('leaves an amount already ending in .99 untouched', () => {
    expect(applyPsychologicalRounding(9199, 'ending99', 'EUR')).toBe(9199);
  });

  it('rounds up to a whole unit under the integer strategy', () => {
    expect(applyPsychologicalRounding(9108, 'integer', 'EUR')).toBe(9200);
    expect(applyPsychologicalRounding(9200, 'integer', 'EUR')).toBe(9200);
  });

  it('never rounds down, which would eat the exchange buffer', () => {
    for (const minor of [1, 99, 100, 101, 9998, 9999, 10000]) {
      expect(
        applyPsychologicalRounding(minor, 'ending99', 'GBP'),
      ).toBeGreaterThanOrEqual(minor);
      expect(
        applyPsychologicalRounding(minor, 'integer', 'GBP'),
      ).toBeGreaterThanOrEqual(minor);
    }
  });
});

describe('convertPrice', () => {
  it('applies rate, buffer, then psychological rounding', () => {
    // 9900 * 0.92 = 9108; * 1.03 = 9381.24 -> 9381 -> rounded to .99 -> 9399
    expect(
      convertPrice({
        baseMinor: 9900,
        rate: 0.92,
        currency: 'EUR',
        rules: DEFAULT_PRICING_RULES,
      }),
    ).toBe(9399);
  });

  it('honours an explicit zero buffer', () => {
    // 9900 * 0.92 = 9108 -> 9199
    expect(
      convertPrice({
        baseMinor: 9900,
        rate: 0.92,
        currency: 'EUR',
        rules: { ...DEFAULT_PRICING_RULES, bufferRate: 0 },
      }),
    ).toBe(9199);
  });

  it('rejects a non-positive rate rather than producing a free product', () => {
    const input = {
      baseMinor: 9900,
      currency: 'EUR' as const,
      rules: DEFAULT_PRICING_RULES,
    };
    expect(() => convertPrice({ ...input, rate: 0 })).toThrow(/rate/i);
    expect(() => convertPrice({ ...input, rate: -1 })).toThrow(/rate/i);
    expect(() => convertPrice({ ...input, rate: Number.NaN })).toThrow(/rate/i);
  });
});

describe('needsRecalculation', () => {
  const threshold = DEFAULT_PRICING_RULES.recalcThreshold;

  it('stays put while the rate drifts under the threshold', () => {
    // 0.92 -> 0.93 is 1.09% of drift, under the 2% threshold.
    expect(
      needsRecalculation({ rateUsed: 0.92, currentRate: 0.93, threshold }),
    ).toBe(false);
  });

  it('triggers once the rate drifts beyond the threshold', () => {
    // 0.92 -> 0.95 is 3.26% of drift.
    expect(
      needsRecalculation({ rateUsed: 0.92, currentRate: 0.95, threshold }),
    ).toBe(true);
  });

  it('triggers symmetrically when the rate falls', () => {
    // 0.92 -> 0.88 is 4.35% of drift.
    expect(
      needsRecalculation({ rateUsed: 0.92, currentRate: 0.88, threshold }),
    ).toBe(true);
  });

  it('always recalculates when no previous rate was recorded', () => {
    expect(
      needsRecalculation({ rateUsed: null, currentRate: 0.92, threshold }),
    ).toBe(true);
    expect(
      needsRecalculation({ rateUsed: 0, currentRate: 0.92, threshold }),
    ).toBe(true);
  });
});

describe('pricingRulesFromSettings', () => {
  it('reads the three settings', () => {
    expect(
      pricingRulesFromSettings({
        buffer_rate: 0.05,
        recalc_threshold: 0.01,
        rounding: 'integer',
      }),
    ).toEqual({ bufferRate: 0.05, recalcThreshold: 0.01, rounding: 'integer' });
  });

  it('falls back to the defaults instead of throwing on bad values', () => {
    // These run inside the cron: a mistyped setting must not stop every price
    // from being maintained.
    expect(
      pricingRulesFromSettings({
        buffer_rate: 'lots',
        recalc_threshold: -1,
        rounding: 'sideways',
      }),
    ).toEqual(DEFAULT_PRICING_RULES);
    expect(pricingRulesFromSettings({})).toEqual(DEFAULT_PRICING_RULES);
  });
});
