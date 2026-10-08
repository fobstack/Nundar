import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import de from '../../src/theme/locales/de.json';
import en from '../../src/theme/locales/en.json';
import es from '../../src/theme/locales/es.json';
import fr from '../../src/theme/locales/fr.json';
import { api, createContent, ensureSite, ORIGIN } from '../shop/helpers.js';

/**
 * The inquiry form, in the page's language.
 *
 * The form is Mallok's inquiry plugin's: it replaces `[[inquiry]]` in a page.
 * The plugin has its own labels in English and Chinese, and takes any other
 * language's from the theme's language pack, one key at a time. A pack
 * without those keys fails nothing — the German page simply asks for "Your
 * name" — so only a request for the page shows whether a language has them.
 */

type Pack = Readonly<Record<string, string>>;

/** The theme's packs for the languages the plugin has no words in. */
const TRANSLATED: Readonly<Record<string, Pack>> = { de, fr, es };

/**
 * The keys the plugin reads, the form control each one labels, and the
 * plugin's own English, which is what a page shows when a key is missing.
 */
const LABELS = [
  ['inquiry_name', '<input type="text" name="name"', 'Your name'],
  ['inquiry_email', '<input type="email" name="email"', 'Email'],
  ['inquiry_company', '<input type="text" name="company"', 'Company'],
  ['inquiry_phone', '<input type="text" name="phone"', 'Phone / WhatsApp'],
  ['inquiry_message', '<textarea name="message"', 'Message'],
] as const;
const SUBMIT = ['inquiry_submit', 'Send inquiry'] as const;

/** Text as the plugin prints it into the form. */
function escaped(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function form(path: string): Promise<string> {
  const response = await SELF.fetch(`${ORIGIN}${path}`);
  const html = await response.text();
  expect(response.status, path).toBe(200);
  const found = /<form class="mallok-inquiry"[\s\S]*?<\/form>/.exec(html);
  expect(found, `${path} carries no inquiry form`).not.toBeNull();
  return found?.[0] ?? '';
}

describe('the inquiry form', () => {
  const paths: Record<string, string> = {};

  beforeAll(async () => {
    await ensureSite();

    // Before any page is requested: a page cached while the plugin was off
    // keeps its `[[inquiry]]` marker.
    const enabled = await api('POST', '/_mallok/api/plugins/inquiry/enabled', {
      enabled: true,
    });
    if (!enabled.ok) {
      throw new Error(
        `The inquiry plugin was refused: ${await enabled.text()}`,
      );
    }

    const contact = await createContent({
      kind: 'page',
      title: 'Contact',
      slug: 'contact',
      body: 'Write to us.\n\n[[inquiry]]',
    });
    paths.en = contact.path;
    for (const [locale, title, slug] of [
      ['de', 'Kontakt', 'kontakt'],
      ['fr', 'Contact', 'contactez-nous'],
      ['es', 'Contacto', 'contacto'],
    ] as const) {
      const translated = await createContent({
        kind: 'page',
        title,
        slug,
        locale,
        translationGroup: contact.translationGroup,
        body: '[[inquiry]]',
      });
      paths[locale] = translated.path;
    }
  });

  it.each(Object.keys(TRANSLATED))(
    'labels every field of a %s page from that language’s pack',
    async (locale) => {
      const pack = TRANSLATED[locale] ?? {};
      const html = await form(paths[locale] ?? '');

      for (const [key, control, english] of LABELS) {
        const label = pack[key] ?? '';
        expect(label, `${locale} has no ${key}`).not.toBe('');
        // Different from the plugin's English, or a key that went missing
        // would leave this test passing on the fallback.
        expect(label, `${locale} ${key}`).not.toBe(english);
        expect(html, `${locale} ${key}`).toContain(
          `<label>${escaped(label)}<br>${control}`,
        );
      }

      const [key, english] = SUBMIT;
      const label = pack[key] ?? '';
      expect(label, `${locale} ${key}`).not.toBe('');
      expect(label, `${locale} ${key}`).not.toBe(english);
      expect(html).toContain(
        `<button type="submit">${escaped(label)}</button>`,
      );
    },
  );

  it('leaves the default pack without the keys, so the plugin’s own languages stand', async () => {
    // A theme's pack falls back to its default language. Were these keys in
    // the English pack, a page in a language this theme has no pack for would
    // get English labels in place of the plugin's own — its Chinese included.
    const defaults: Pack = en;
    for (const key of [...LABELS.map(([name]) => name), SUBMIT[0]]) {
      expect(defaults[key], key).toBeUndefined();
    }

    const html = await form(paths.en ?? '');
    for (const [, control, english] of LABELS) {
      expect(html).toContain(`<label>${english}<br>${control}`);
    }
    expect(html).toContain(`<button type="submit">${SUBMIT[1]}</button>`);
  });
});
