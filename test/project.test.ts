import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
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

    // Optional to the Worker, but without the first nothing limits a plugin
    // route such as inquiry submission, and without the second a route that
    // asks for the relaxed tier is held to the strict one.
    const limits = config.ratelimits as
      | { name: string; namespace_id: string }[]
      | undefined;
    assert.deepEqual(
      limits?.map((limit) => limit.name),
      ['RATE_LIMITER', 'RATE_LIMITER_RELAXED'],
    );
    for (const limit of limits ?? []) {
      assert.match(limit.namespace_id, /^\d+$/);
    }
    // Two tiers sharing a namespace would count against one limiter.
    assert.notEqual(limits?.[0]?.namespace_id, limits?.[1]?.namespace_id);
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
    tagline: string | Record<string, string>;
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

  it('gives each language a tagline of its own', async () => {
    // The tagline follows the site's name in the home page's title and
    // describes that page to a search engine. A language without one gets
    // the default language's, and nothing reports it.
    const site = await readSettings();
    assert.equal(
      typeof site.tagline,
      'object',
      'site.json has one tagline for every language',
    );
    const taglines = site.tagline as Record<string, string>;
    assert.deepEqual(Object.keys(taglines).sort(), [...site.locales].sort());

    const seen = new Set<string>();
    for (const locale of site.locales) {
      const tagline = taglines[locale] ?? '';
      assert.ok(tagline.trim() !== '', `site.json has no "${locale}" tagline`);
      assert.ok(
        !seen.has(tagline),
        `site.json gives "${locale}" another language's tagline`,
      );
      seen.add(tagline);
    }
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

/**
 * What the theme runs in a visitor's browser is the list in `theme.json`,
 * which Mallok shows the site's owner. The list is only worth showing if it
 * is the whole truth: every script a template loads is on it, at the size it
 * says, and nothing on it is dead weight.
 */
describe('the theme’s client scripts', () => {
  const THEME = join('src', 'theme');

  interface Declared {
    path: string;
    purpose: string;
    bytes?: number;
  }

  async function declared(): Promise<Declared[]> {
    const theme = JSON.parse(
      await readFile(join(THEME, 'theme.json'), 'utf8'),
    ) as { clientScripts: Declared[] };
    return theme.clientScripts;
  }

  /** Every `<script …>` tag in the theme's templates, with its file. */
  async function scriptTags(): Promise<{ file: string; tag: string }[]> {
    const tags: { file: string; tag: string }[] = [];
    for (const directory of ['layouts', 'partials']) {
      for (const file of await readdir(join(THEME, directory))) {
        const text = await readFile(join(THEME, directory, file), 'utf8');
        for (const match of text.matchAll(/<script\b[^>]*>/gi)) {
          tags.push({ file: `${directory}/${file}`, tag: match[0] });
        }
      }
    }
    return tags;
  }

  it('are files of the size the manifest states', async () => {
    for (const script of await declared()) {
      assert.match(script.path, /^assets\/[a-z0-9-]+\.js$/);
      assert.ok(script.purpose.trim() !== '', `${script.path} has no purpose`);
      const { size } = await stat(join(THEME, script.path));
      assert.equal(
        script.bytes,
        size,
        `theme.json says ${script.path} is ${script.bytes} bytes; it is ${size}`,
      );
    }
  });

  it('are the only scripts a template loads, each in the one permitted form', async () => {
    const paths = new Set((await declared()).map((script) => script.path));

    for (const { file, tag } of await scriptTags()) {
      const name =
        /^<script src="\{\{ theme\.asset_base \}\}\/([a-z0-9-]+\.js)" defer>$/.exec(
          tag,
        )?.[1];
      assert.ok(
        name !== undefined,
        `${file} has a script tag in a form the theme does not use: ${tag}`,
      );
      assert.ok(
        paths.has(`assets/${name}`),
        `${file} loads ${name}, which theme.json does not declare`,
      );
    }
  });

  it('are each loaded by a template', async () => {
    const loaded = (await scriptTags()).map(({ tag }) => tag).join('\n');

    for (const script of await declared()) {
      const name = script.path.replace(/^assets\//, '');
      assert.ok(
        loaded.includes(`/${name}"`),
        `theme.json declares ${script.path}, and no template loads it`,
      );
    }
  });

  it('are the only JavaScript among the theme’s files', async () => {
    const paths = new Set((await declared()).map((script) => script.path));

    for (const file of await readdir(join(THEME, 'assets'))) {
      if (file.endsWith('.js')) {
        assert.ok(
          paths.has(`assets/${file}`),
          `src/theme/assets/${file} is served to visitors and theme.json does not declare it`,
        );
      }
    }
  });
});

describe('the form that sends a cart as a request for a quote', () => {
  it('keeps the field no person fills in where nobody sees it', async () => {
    // The field is in the page for whatever fills in every field it finds.
    // It is the stylesheet, and nothing in the markup, that keeps it from a
    // person's eyes: without this rule every buyer is shown a field that
    // throws their request away when they fill it in.
    const theme = join('src', 'theme');
    const layout = await readFile(
      join(theme, 'layouts', 'shop-cart.liquid'),
      'utf8',
    );
    const styles = await readFile(join(theme, 'assets', 'style.css'), 'utf8');

    assert.match(
      layout,
      /<p class="quote-form-trap" aria-hidden="true">[\s\S]*?name="website" tabindex="-1" autocomplete="off"/,
    );
    const rule = /\.quote-form-trap\s*\{([^}]*)\}/.exec(styles)?.[1] ?? '';
    assert.match(rule, /position:\s*absolute/);
    assert.match(
      rule,
      /left:\s*-\d{3,}/,
      'the field is not moved off the page',
    );
    assert.match(rule, /overflow:\s*hidden/);
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
