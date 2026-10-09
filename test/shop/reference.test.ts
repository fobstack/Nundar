import { describe, expect, it } from 'vitest';
import {
  isReference,
  newReference,
} from '../../src/plugins/shop/lib/reference.js';

describe('the numbers people quote', () => {
  const now = new Date('2026-10-09T23:59:59.000Z');

  it('are a prefix, the date and eight characters nobody mistakes for another', () => {
    for (let made = 0; made < 200; made += 1) {
      // No I, L, O or U: Crockford's alphabet.
      expect(newReference('RFQ', now)).toMatch(
        /^RFQ-261009-[0-9A-HJKMNP-TV-Z]{8}$/,
      );
    }
  });

  it('do not repeat', () => {
    const made = new Set(
      Array.from({ length: 500 }, () => newReference('ND', now)),
    );

    expect(made.size).toBe(500);
  });

  it('are recognised by their shape, under their own prefix only', () => {
    const number = newReference('RFQ', now);

    expect(isReference('RFQ', number)).toBe(true);
    expect(isReference('ND', number)).toBe(false);
    // A prefix of the same length, which leaves the rest in the same place.
    expect(isReference('ABC', number)).toBe(false);
    expect(isReference('RFQ', `ABC${number.slice(3)}`)).toBe(false);
    expect(isReference('RFQ', number.toLowerCase())).toBe(false);
    for (const not of [
      '',
      'RFQ',
      'RFQ-261009',
      'RFQ-261009-7K3M9QX',
      'RFQ-261009-7K3M9QXAB',
      'RFQ-26100-7K3M9QXA',
      'RFQ-261009-7K3M9QXI',
      'RFQ-261009-7K3M9QXA-1',
      'RFQ-261009-7K3M9QX%',
      "RFQ-261009-' OR 1=1",
      'XRFQ-261009-7K3M9QXA',
    ]) {
      expect(isReference('RFQ', not), not).toBe(false);
    }
  });
});
