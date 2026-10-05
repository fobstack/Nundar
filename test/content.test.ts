import assert from 'node:assert/strict';
import { access, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * Checks on the sample content that only this project can get wrong.
 *
 * Mallok resolves a `reference` field by slug **within the same language**, so
 * a German industry page has to name the German product's slug. Get that
 * wrong and the page still renders — it just quietly loses its link, which is
 * exactly the kind of mistake nobody notices until the long-tail pages stop
 * pointing at each other. The same holds for a link written in a body, for a
 * product whose attributes are named differently from its neighbours', and
 * for a SKU on a page that no variant in the shop carries.
 */

const CONTENT = 'content';

interface Item {
  readonly kind: string;
  readonly bundle: string;
  readonly locale: string;
  readonly slug: string;
  readonly file: string;
  readonly fields: ReadonlyMap<string, string>;
  readonly frontmatter: string;
  readonly body: string;
}

interface Site {
  readonly defaultLocale: string;
  readonly locales: string[];
  readonly kinds: Record<string, { base: string }>;
}

/** A YAML scalar as written, without the quotes it may be wrapped in. */
function unquote(value: string): string {
  const trimmed = value.trim();
  const quoted = /^"((?:[^"\\]|\\.)*)"$|^'((?:[^']|'')*)'$/.exec(trimmed);
  if (quoted === null) {
    return trimmed;
  }
  return quoted[1] !== undefined
    ? quoted[1].replace(/\\(.)/g, '$1')
    : (quoted[2] ?? '').replace(/''/g, "'");
}

/** The scalar front-matter fields of an `index[.<locale>].md`. */
function scalarFields(frontmatter: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of frontmatter.split('\n')) {
    // Top-level keys only: nested maps such as `specs` are indented.
    const match = /^([a-z_]+):\s*(\S.*)$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      fields.set(match[1], unquote(match[2]));
    }
  }
  return fields;
}

/**
 * The entries of a nested map such as `facets` or `sizes`, in file order.
 *
 * A reader for the one shape these files use — a key, then two-space-indented
 * `name: value` lines — rather than a YAML parser, so the project's own tests
 * need nothing installed.
 */
function mapField(frontmatter: string, name: string): [string, string][] {
  const lines = frontmatter.split('\n');
  const start = lines.indexOf(`${name}:`);
  const entries: [string, string][] = [];
  if (start === -1) {
    return entries;
  }
  for (const line of lines.slice(start + 1)) {
    const match =
      /^ {2}(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([^:]+?)):\s+(.*)$/.exec(line);
    if (match === null) {
      break;
    }
    const key = match[1] ?? match[2] ?? match[3] ?? '';
    entries.push([key.replace(/\\(.)/g, '$1'), unquote(match[4] ?? '')]);
  }
  return entries;
}

/** The image paths a bundle's front matter and body name. */
function imagePaths(item: Item): string[] {
  const paths: string[] = [];
  const cover = item.fields.get('cover');
  if (cover !== undefined) {
    paths.push(cover);
  }
  const lines = item.frontmatter.split('\n');
  const gallery = lines.indexOf('gallery:');
  if (gallery !== -1) {
    for (const line of lines.slice(gallery + 1)) {
      const match = /^ {2}- (.+)$/.exec(line);
      if (match?.[1] === undefined) {
        break;
      }
      paths.push(unquote(match[1]));
    }
  }
  for (const match of item.body.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)) {
    if (match[1] !== undefined) {
      paths.push(match[1]);
    }
  }
  return paths;
}

async function loadItems(defaultLocale: string): Promise<Item[]> {
  const items: Item[] = [];
  const kinds = await readdir(CONTENT, { withFileTypes: true });
  for (const kind of kinds.filter((entry) => entry.isDirectory())) {
    const bundles = await readdir(join(CONTENT, kind.name), {
      withFileTypes: true,
    });
    for (const bundle of bundles.filter((entry) => entry.isDirectory())) {
      const files = await readdir(join(CONTENT, kind.name, bundle.name));
      for (const file of files) {
        const match = /^index(?:\.([a-z]{2}(?:-[A-Za-z]{2})?))?\.md$/.exec(
          file,
        );
        if (match === null) {
          continue;
        }
        const path = join(CONTENT, kind.name, bundle.name, file);
        const markdown = await readFile(path, 'utf8');
        const parts = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(markdown);
        const frontmatter = parts?.[1] ?? '';
        const fields = scalarFields(frontmatter);
        items.push({
          kind: kind.name,
          bundle: bundle.name,
          locale: match[1] ?? defaultLocale,
          // The default language's slug defaults to the bundle's own name.
          slug: fields.get('slug') ?? bundle.name,
          file: path,
          fields,
          frontmatter,
          body: parts?.[2] ?? '',
        });
      }
    }
  }
  return items;
}

async function readSite(): Promise<Site> {
  return JSON.parse(await readFile('site.json', 'utf8'));
}

/** Where a language's pages start: nothing for the default, `/de` for German. */
function prefixOf(site: Site, locale: string): string {
  return locale === site.defaultLocale ? '' : `/${locale}`;
}

/** The public path Mallok gives an item. */
function pathOf(site: Site, item: Item): string {
  const base = site.kinds[item.kind]?.base ?? '';
  return `${prefixOf(site, item.locale)}${base === '' ? '' : `/${base}`}/${item.slug}`;
}

describe('sample content', () => {
  it('uses only kinds and languages the site declares', async () => {
    const site = await readSite();
    const items = await loadItems(site.defaultLocale);

    assert.ok(items.length > 0);
    for (const item of items) {
      assert.ok(
        Object.hasOwn(site.kinds, item.kind),
        `content/${item.kind} is not a kind in site.json`,
      );
      assert.ok(
        site.locales.includes(item.locale),
        `${item.kind}/${item.bundle} has a file for "${item.locale}", which site.json does not list`,
      );
    }
  });

  it('carries every bundle in every language of the site', async () => {
    // The sample is what a visitor of the demo switches languages on: a
    // bundle missing one would drop out of that language's lists and leave
    // its other versions without that hreflang.
    const site = await readSite();
    const items = await loadItems(site.defaultLocale);
    const bundles = new Set(items.map((item) => `${item.kind}/${item.bundle}`));

    for (const bundle of bundles) {
      for (const locale of site.locales) {
        assert.ok(
          items.some(
            (item) =>
              `${item.kind}/${item.bundle}` === bundle &&
              item.locale === locale,
          ),
          `content/${bundle} has no "${locale}" version`,
        );
      }
    }
  });

  it('gives every translation its own slug within its kind and language', async () => {
    const site = await readSite();
    const items = await loadItems(site.defaultLocale);
    const seen = new Set<string>();

    for (const item of items) {
      const key = `${item.kind}/${item.locale}/${item.slug}`;
      assert.ok(!seen.has(key), `Two items share ${key}`);
      seen.add(key);
      if (item.locale !== site.defaultLocale) {
        // Without its own `slug` a translation would take the bundle's name
        // and collide with nothing, but answer at an English address.
        assert.ok(item.fields.has('slug'), `${item.file} declares no slug`);
      }
    }
  });

  it('points every reference at an item in the same language', async () => {
    const site = await readSite();
    const items = await loadItems(site.defaultLocale);

    // The reference fields the commerce theme declares, and the kind each
    // points at, read from the theme itself: a copy kept here would stay
    // behind the first time a kind gained a reference.
    const theme = JSON.parse(
      await readFile(join('src', 'theme', 'theme.json'), 'utf8'),
    ) as {
      kinds: Record<
        string,
        { fields?: Record<string, { type: string; kind?: string }> }
      >;
    };
    const references: Record<string, Record<string, string>> = {};
    for (const [kind, definition] of Object.entries(theme.kinds)) {
      for (const [field, declared] of Object.entries(definition.fields ?? {})) {
        if (declared.type === 'reference' && declared.kind !== undefined) {
          references[kind] = { ...references[kind], [field]: declared.kind };
        }
      }
    }
    assert.deepEqual(Object.keys(references).sort(), [
      'application',
      'case',
      'product',
    ]);

    let checked = 0;
    for (const item of items) {
      for (const [field, targetKind] of Object.entries(
        references[item.kind] ?? {},
      )) {
        const target = item.fields.get(field);
        if (target === undefined) {
          continue;
        }
        assert.ok(
          items.some(
            (other) =>
              other.kind === targetKind &&
              other.locale === item.locale &&
              other.slug === target,
          ),
          `${item.kind}/${item.bundle} (${item.locale}) names ${field}: ${target}, but no ${targetKind} has that slug in "${item.locale}"`,
        );
        checked += 1;
      }
    }
    assert.ok(checked > 0);
  });

  it('gives every industry page a product', async () => {
    const site = await readSite();
    const items = await loadItems(site.defaultLocale);

    for (const item of items.filter((entry) => entry.kind === 'application')) {
      assert.ok(
        item.fields.has('product'),
        `application/${item.bundle} (${item.locale}) names no product`,
      );
    }
  });

  it('links, in every body, only to pages that exist in that language', async () => {
    // A link in Markdown is plain text to Mallok: nothing rewrites it for the
    // language and nothing reports it when its target is renamed.
    const site = await readSite();
    const items = await loadItems(site.defaultLocale);

    const pages = new Map<string, Set<string>>();
    for (const locale of site.locales) {
      const prefix = prefixOf(site, locale);
      const known = new Set([prefix === '' ? '/' : prefix, `${prefix}/`]);
      for (const kind of Object.values(site.kinds)) {
        if (kind.base !== '') {
          known.add(`${prefix}/${kind.base}`);
        }
      }
      pages.set(locale, known);
    }
    for (const item of items) {
      pages.get(item.locale)?.add(pathOf(site, item));
    }

    let checked = 0;
    for (const item of items) {
      for (const match of item.body.matchAll(
        /(?<!!)\[[^\]]*\]\(([^)\s]+)\)/g,
      )) {
        const target = match[1] ?? '';
        if (/^(https?:|mailto:|#)/.test(target)) {
          continue;
        }
        assert.ok(
          target.startsWith('/'),
          `${item.file} links to ${target}, which is neither a site path nor a URL`,
        );
        const path = target.replace(/[#?].*$/, '');
        assert.ok(
          pages.get(item.locale)?.has(path),
          `${item.file} links to ${path}, which is not a page in "${item.locale}"`,
        );
        checked += 1;
      }
    }
    assert.ok(checked > 0);
  });

  it('is what the navigation and the buttons in site.json point at', async () => {
    // The header, the footer and every call to action take their addresses
    // from `site.json`. A page renamed here and not there is a dead link on
    // every page of that language.
    const site = await readSite();
    const items = await loadItems(site.defaultLocale);
    const settings = JSON.parse(await readFile('site.json', 'utf8')) as {
      nav: Record<string, { href: string }[]>;
      themeOptions: Record<string, unknown> & {
        $locales?: Record<string, Record<string, string>>;
      };
    };

    let checked = 0;
    for (const locale of site.locales) {
      const prefix = prefixOf(site, locale);
      const known = new Set([prefix === '' ? '/' : prefix, `${prefix}/`]);
      for (const kind of Object.values(site.kinds)) {
        if (kind.base !== '') {
          known.add(`${prefix}/${kind.base}`);
        }
      }
      for (const item of items.filter((entry) => entry.locale === locale)) {
        known.add(pathOf(site, item));
      }

      const options =
        locale === site.defaultLocale
          ? settings.themeOptions
          : (settings.themeOptions.$locales?.[locale] ?? {});
      const links = [
        ...(settings.nav[locale] ?? []).map((entry) => entry.href),
        ...Object.entries(options)
          .filter(([name]) => name.endsWith('_href'))
          .map(([, href]) => String(href)),
      ];
      for (const href of links) {
        assert.ok(
          known.has(href.replace(/[#?].*$/, '')),
          `site.json sends "${locale}" to ${href}, which is not a page in that language`,
        );
        checked += 1;
      }
    }
    assert.ok(checked > 0);
  });

  it('keeps every image a bundle names inside that bundle', async () => {
    const site = await readSite();
    const items = await loadItems(site.defaultLocale);

    let checked = 0;
    for (const item of items) {
      for (const path of imagePaths(item)) {
        assert.ok(
          !/^[a-z]+:/i.test(path) && !path.startsWith('/'),
          `${item.file} names ${path}; an image is a path inside the bundle`,
        );
        await assert.doesNotReject(
          access(join(CONTENT, item.kind, item.bundle, path)),
          `${item.file} names ${path}, which is not in the bundle`,
        );
        checked += 1;
      }
    }
    assert.ok(checked > 0);
  });
});

describe('sample products', () => {
  it('name the same attributes, in the same order, within a language', async () => {
    // The attribute names of the first product are the columns of the
    // specification finder, and what its filters are built from.
    const site = await readSite();
    const items = await loadItems(site.defaultLocale);

    for (const locale of site.locales) {
      const products = items.filter(
        (item) => item.kind === 'product' && item.locale === locale,
      );
      const expected = mapField(products[0]?.frontmatter ?? '', 'facets').map(
        ([name]) => name,
      );
      assert.ok(expected.length > 0, `no product attributes in "${locale}"`);
      for (const product of products) {
        assert.deepEqual(
          mapField(product.frontmatter, 'facets').map(([name]) => name),
          expected,
          `${product.file} names different attributes from ${products[0]?.file}`,
        );
      }
    }
  });

  it('offer the same sizes under the same SKUs in every language', async () => {
    const site = await readSite();
    const items = await loadItems(site.defaultLocale);
    const products = items.filter((item) => item.kind === 'product');

    for (const source of products.filter(
      (item) => item.locale === site.defaultLocale,
    )) {
      const sizes = mapField(source.frontmatter, 'sizes');
      assert.ok(sizes.length > 0, `${source.file} offers no size`);
      for (const version of products.filter(
        (item) => item.bundle === source.bundle,
      )) {
        assert.deepEqual(
          mapField(version.frontmatter, 'sizes'),
          sizes,
          `${version.file} lists different sizes from ${source.file}`,
        );
      }
    }
  });
});

describe('seed/shop-sample.sql', () => {
  /** product_group to the SKUs of its variants, as the seed inserts them. */
  async function seededVariants(): Promise<Map<string, string[]>> {
    const sql = await readFile(join('seed', 'shop-sample.sql'), 'utf8');
    const variants = new Map<string, string[]>();
    for (const match of sql.matchAll(
      /\('[^']+',\s*'([0-9a-f]{8}-[0-9a-f-]{27})',\s*'([^']+)'/g,
    )) {
      const group = match[1] ?? '';
      variants.set(group, [...(variants.get(group) ?? []), match[2] ?? '']);
    }
    return variants;
  }

  async function translationGroup(bundle: string): Promise<string | null> {
    try {
      const identity = JSON.parse(
        await readFile(join(CONTENT, 'product', bundle, 'mallok.json'), 'utf8'),
      ) as { translation_group?: string };
      return identity.translation_group ?? null;
    } catch {
      // A bundle without an identity file gets one assigned on import, so
      // nothing in the seed could name it.
      return null;
    }
  }

  it('attaches its variants to a product bundle that exists', async () => {
    const variants = await seededVariants();
    assert.ok(variants.size > 0);

    const products = await readdir(join(CONTENT, 'product'), {
      withFileTypes: true,
    });
    const known = new Set<string>();
    for (const bundle of products.filter((entry) => entry.isDirectory())) {
      const group = await translationGroup(bundle.name);
      if (group !== null) {
        known.add(group);
      }
    }

    for (const group of variants.keys()) {
      assert.ok(
        known.has(group),
        `seed/shop-sample.sql names product_group ${group}, which no product bundle's mallok.json declares`,
      );
    }
  });

  it('carries one variant for each SKU a product page lists, and no other', async () => {
    // The page prints the SKU a buyer quotes; the shop sells the variant
    // that carries it. A size on the page with no variant could never be
    // bought, and a variant with no size on the page could never be found.
    const site = await readSite();
    const items = await loadItems(site.defaultLocale);
    const variants = await seededVariants();

    const products = items.filter(
      (item) => item.kind === 'product' && item.locale === site.defaultLocale,
    );
    assert.ok(products.length > 0);
    for (const product of products) {
      const group = await translationGroup(product.bundle);
      assert.ok(group !== null, `${product.file} has no mallok.json`);
      assert.deepEqual(
        [...(variants.get(group) ?? [])].sort(),
        mapField(product.frontmatter, 'sizes')
          .map(([sku]) => sku)
          .sort(),
        `the variants seeded for ${product.bundle} are not the SKUs its page lists`,
      );
    }
  });
});

/**
 * `mallok.json` pins a bundle's identity.
 *
 * It is optional: Mallok puts every language of a bundle into one translation
 * group on its own. A bundle carries one here only when something outside the
 * content has to name it — the sample variants attach to a product by its
 * translation group. Where the file exists, it has to agree with the bundle.
 */
describe('bundle identity', () => {
  interface Identity {
    translation_group?: string;
    items?: Record<string, { id?: string; slug?: string; path?: string }>;
  }

  async function readIdentity(item: Item): Promise<Identity | null> {
    try {
      return JSON.parse(
        await readFile(
          join(CONTENT, item.kind, item.bundle, 'mallok.json'),
          'utf8',
        ),
      ) as Identity;
    } catch {
      return null;
    }
  }

  it('keeps each identity file in step with its bundle’s languages and slugs', async () => {
    const site = await readSite();
    const items = await loadItems(site.defaultLocale);
    const ids = new Set<string>();

    for (const item of items) {
      const identity = await readIdentity(item);
      if (identity === null) {
        continue;
      }
      const entry = identity.items?.[item.locale];
      assert.ok(
        entry !== undefined,
        `content/${item.kind}/${item.bundle}/mallok.json has no entry for "${item.locale}"`,
      );
      assert.equal(entry.slug, item.slug);
      assert.equal(
        entry.path,
        pathOf(site, item),
        `content/${item.kind}/${item.bundle}/mallok.json gives "${item.locale}" a path that is not where the page is`,
      );
      assert.ok(
        entry.id !== undefined && !ids.has(entry.id),
        `content/${item.kind}/${item.bundle} reuses the id ${entry.id}`,
      );
      ids.add(entry.id);
    }
    assert.ok(ids.size > 0);
  });

  it('gives every translation group to one bundle only', async () => {
    const site = await readSite();
    const items = await loadItems(site.defaultLocale);
    const owners = new Map<string, string>();

    for (const item of items) {
      const group = (await readIdentity(item))?.translation_group;
      if (group === undefined) {
        continue;
      }
      const bundle = `${item.kind}/${item.bundle}`;
      assert.equal(
        owners.get(group) ?? bundle,
        bundle,
        `the translation group ${group} is claimed by two bundles`,
      );
      owners.set(group, bundle);
    }
    assert.ok(owners.size > 0);
  });
});
