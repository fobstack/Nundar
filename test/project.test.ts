import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * Checks on this project's own configuration and content.
 *
 * Mallok's own behaviour is tested in the `mallok` package; what is left for a
 * site to check is what a site can get wrong — a binding removed from
 * `wrangler.jsonc`, a settings file that stopped being valid JSON, a content
 * bundle with no title. `npm run smoke` adds the other half: a real request to
 * a real Worker.
 *
 * Node's own test runner, deliberately. A site should not need a test
 * framework, a config file and a version to keep in step with its framework's
 * — `node --test` is already installed on any machine that can run the
 * project at all.
 */

/** `wrangler.jsonc` is JSONC; comments and trailing commas are allowed. */
async function readJsonc(path: string): Promise<Record<string, unknown>> {
  const text = await readFile(path, 'utf8');
  const stripped = text
    .replace(/^\s*\/\*[\s\S]*?\*\//, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(stripped) as Record<string, unknown>;
}

describe('wrangler.jsonc', () => {
  it('declares every binding the Worker reads', async () => {
    const config = await readJsonc('wrangler.jsonc');

    assert.equal(
      (config.d1_databases as { binding: string }[])[0]?.binding,
      'DB',
    );
    assert.equal(
      (config.r2_buckets as { binding: string }[])[0]?.binding,
      'MEDIA',
    );
    assert.equal((config.assets as { binding: string }).binding, 'ASSETS');

    // Optional to the Worker, but its absence silently disables the rate
    // limit on plugin routes such as inquiry submission.
    const limits = config.ratelimits as
      | { name: string; namespace_id: string }[]
      | undefined;
    assert.equal(limits?.[0]?.name, 'RATE_LIMITER');
    assert.match(limits?.[0]?.namespace_id ?? '', /^\d+$/);
  });

  it('keeps the cron trigger scheduling and cleanup need', async () => {
    const config = await readJsonc('wrangler.jsonc');
    const crons = (config.triggers as { crons: string[] }).crons;

    assert.equal(crons.length, 1);
  });
});

describe('site.json', () => {
  it('is valid and names a default locale', async () => {
    const site = JSON.parse(await readFile('site.json', 'utf8')) as {
      defaultLocale?: string;
      locales?: string[];
    };

    assert.equal(typeof site.defaultLocale, 'string');
    assert.ok(site.locales?.includes(site.defaultLocale ?? ''));
  });
});

/**
 * `site.json` carries this site's own copy: the navigation and the theme's
 * options. Mallok renders whatever is there, so a language that was left out
 * shows English on its most important page and nothing reports it.
 */
describe('site.json, in every language', () => {
  interface Settings {
    defaultLocale: string;
    locales: string[];
    nav: Record<string, { label: string; href: string }[]>;
    themeOptions: Record<string, unknown> & {
      $locales?: Record<string, Record<string, string>>;
    };
  }

  /** The option types that hold words or links rather than a setting. */
  const WRITTEN = new Set(['string', 'text']);
  // The same in every language: an address, a number, a material grade.
  const LANGUAGE_INDEPENDENT = new Set([
    'contact_email',
    'contact_phone',
    'hero_badge',
  ]);

  async function readSettings(): Promise<Settings> {
    return JSON.parse(await readFile('site.json', 'utf8')) as Settings;
  }

  async function writtenOptions(): Promise<string[]> {
    const theme = JSON.parse(
      await readFile(join('src', 'theme', 'theme.json'), 'utf8'),
    ) as { options: Record<string, { type: string }> };
    return Object.keys(theme.options).filter(
      (name) =>
        WRITTEN.has(theme.options[name]?.type ?? '') &&
        !LANGUAGE_INDEPENDENT.has(name),
    );
  }

  it('sets only options the theme declares', async () => {
    const site = await readSettings();
    const theme = JSON.parse(
      await readFile(join('src', 'theme', 'theme.json'), 'utf8'),
    ) as { options: Record<string, unknown> };

    const sets = [
      site.themeOptions,
      ...Object.values(site.themeOptions.$locales ?? {}),
    ];
    for (const options of sets) {
      for (const name of Object.keys(options)) {
        assert.ok(
          name === '$locales' || Object.hasOwn(theme.options, name),
          `site.json sets the theme option "${name}", which the theme does not have`,
        );
      }
    }
  });

  it('gives each language its own words for every written option', async () => {
    const site = await readSettings();
    const names = await writtenOptions();
    const others = site.locales.filter(
      (locale) => locale !== site.defaultLocale,
    );
    assert.ok(others.length > 0);

    let checked = 0;
    for (const name of names) {
      const original = site.themeOptions[name];
      for (const locale of others) {
        const own = site.themeOptions.$locales?.[locale]?.[name];
        if (name === 'tagline') {
          // The default language falls back to the site's own tagline; the
          // others have nothing to fall back to in their language.
          assert.ok(own, `site.json has no "${locale}" tagline`);
          continue;
        }
        if (typeof original !== 'string' || original === '') {
          continue;
        }
        assert.ok(
          typeof own === 'string' && own !== '',
          `site.json sets ${name} but gives "${locale}" no value for it`,
        );
        assert.notEqual(
          own,
          original,
          `site.json gives "${locale}" the default language's ${name}`,
        );
        checked += 1;
      }
    }
    assert.ok(checked > 0);
  });

  it('keeps each language’s links inside that language', async () => {
    const site = await readSettings();

    for (const locale of site.locales) {
      const prefix = locale === site.defaultLocale ? '/' : `/${locale}/`;
      const options =
        locale === site.defaultLocale
          ? site.themeOptions
          : (site.themeOptions.$locales?.[locale] ?? {});
      const links = [
        ...(site.nav[locale] ?? []).map((item) => item.href),
        ...Object.entries(options)
          .filter(([name]) => name.endsWith('_href'))
          .map(([, href]) => String(href)),
      ];
      assert.ok(links.length > 0, `site.json has no links for "${locale}"`);
      for (const href of links) {
        assert.ok(
          href.startsWith(prefix),
          `site.json sends "${locale}" to ${href}`,
        );
        if (locale === site.defaultLocale) {
          assert.ok(
            !site.locales.some(
              (other) =>
                other !== locale &&
                (href === `/${other}` || href.startsWith(`/${other}/`)),
            ),
            `site.json sends the default language to ${href}`,
          );
        }
      }
    }
  });

  it('offers the same navigation in every language', async () => {
    const site = await readSettings();
    const expected = site.nav[site.defaultLocale]?.length ?? 0;

    assert.ok(expected > 0);
    for (const locale of site.locales) {
      assert.equal(
        site.nav[locale]?.length,
        expected,
        `site.json gives "${locale}" a different number of navigation items`,
      );
      for (const item of site.nav[locale] ?? []) {
        assert.ok(
          item.label.trim() !== '',
          `site.json has a navigation item without a label in "${locale}"`,
        );
      }
    }
  });
});

describe('content/', () => {
  it('gives every bundle a title', async () => {
    const roots = await readdir('content', { withFileTypes: true });
    let checked = 0;

    for (const kind of roots.filter((entry) => entry.isDirectory())) {
      const bundles = await readdir(join('content', kind.name), {
        withFileTypes: true,
      });
      for (const bundle of bundles.filter((entry) => entry.isDirectory())) {
        const dir = join('content', kind.name, bundle.name);
        for (const file of await readdir(dir)) {
          if (!file.endsWith('.md')) {
            continue;
          }
          const text = await readFile(join(dir, file), 'utf8');
          assert.ok(
            text.startsWith('---\n'),
            `${dir}/${file} has no front matter`,
          );
          const end = text.indexOf('\n---', 4);
          assert.match(text.slice(4, end), /(^|\n)title:/, `${dir}/${file}`);
          checked++;
        }
      }
    }

    assert.ok(checked > 0, 'no content bundles were checked');
  });
});
