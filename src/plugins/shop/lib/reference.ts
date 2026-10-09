/**
 * The numbers people quote back to a shop: an order's, an inquiry's.
 *
 * A prefix, the date and a random suffix — `ND-261005-7K3M9QXA` — so a
 * number says nothing about how many the shop has had.
 */

/**
 * Crockford's base 32: no I, L, O or U, so a number read over the phone or
 * copied from paper is not mistaken for another.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Eight characters are forty bits. */
const SUFFIX_LENGTH = 8;

/**
 * A new number under a prefix.
 *
 * Eight characters, because six hexadecimal ones, as the first implementation
 * had, are twenty-four bits: at a thousand a day two of them would collide
 * about once a month, and a collision is a checkout that fails.
 */
export function newReference(prefix: string, now: Date): string {
  const date = now.toISOString().slice(2, 10).replace(/-/g, '');
  let suffix = '';
  for (const byte of crypto.getRandomValues(new Uint8Array(SUFFIX_LENGTH))) {
    // 256 is a multiple of 32, so the low five bits are uniform.
    suffix += ALPHABET.charAt(byte & 31);
  }
  return `${prefix}-${date}-${suffix}`;
}

/** Whether a text has the shape of a number made under this prefix. */
export function isReference(prefix: string, value: string): boolean {
  if (!value.startsWith(`${prefix}-`)) {
    return false;
  }
  const [date = '', suffix = '', ...rest] = value
    .slice(prefix.length + 1)
    .split('-');
  return (
    rest.length === 0 &&
    /^\d{6}$/.test(date) &&
    suffix.length === SUFFIX_LENGTH &&
    [...suffix].every((character) => ALPHABET.includes(character))
  );
}
