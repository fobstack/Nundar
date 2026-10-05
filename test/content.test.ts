import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * Checks on the sample content that only this project can get wrong.
 *
 * Mallok resolves a `reference` field by slug **within the same language**, so
 * a German application note has to name the German product's slug. Get that
 * wrong and the page still renders — it just quietly loses its link, which is
 * exactly the kind of mistake nobody notices until the long-tail pages stop
 * pointing at each other.
 */

const CONTENT = 'content';

interface Item {
  readonly kind: string;
  readonly bundle: string;
  readonly locale: string;
  readonly slug: string;
  readonly fields: ReadonlyMap<string, string>;
}

/** The scalar front-matter fields of an `index[.<locale>].md`. */
function scalarFields(markdown: string): Map<string, string> {
  const block = /^---\n([\s\S]*?)\n---/.exec(markdown)?.[1] ?? '';
  const fields = new Map<string, string>();
  for (const line of block.split('\n')) {
    // Top-level keys only: nested maps such as `specs` are indented.
    const match = /^([a-z_]+):\s*(\S.*)$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      fields.set(match[1], match[2].trim());
    }
  }
  return fields;
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
        const fields = scalarFields(
          await readFile(join(CONTENT, kind.name, bundle.name, file), 'utf8'),
        );
        items.push({
          kind: kind.name,
          bundle: bundle.name,
          locale: match[1] ?? defaultLocale,
          // The default language's slug defaults to the bundle's own name.
          slug: fields.get('slug') ?? bundle.name,
          fields,
        });
      }
    }
  }
  return items;
}

async function readSite(): Promise<{
  defaultLocale: string;
  locales: string[];
  kinds: Record<string, unknown>;
}> {
  return JSON.parse(await readFile('site.json', 'utf8'));
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

  it('gives every translation its own slug within its kind and language', async () => {
    const site = await readSite();
    const items = await loadItems(site.defaultLocale);
    const seen = new Set<string>();

    for (const item of items) {
      const key = `${item.kind}/${item.locale}/${item.slug}`;
      assert.ok(!seen.has(key), `Two items share ${key}`);
      seen.add(key);
    }
  });

  it('points every reference at an item in the same language', async () => {
    const site = await readSite();
    const items = await loadItems(site.defaultLocale);

    // The reference fields the commerce theme declares, and the kind each
    // points at (src/theme/theme.json).
    const references: Record<string, Record<string, string>> = {
      application: { product: 'product' },
      product: { collection: 'collection' },
    };

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

  it('gives every application note a product', async () => {
    const site = await readSite();
    const items = await loadItems(site.defaultLocale);

    for (const item of items.filter((entry) => entry.kind === 'application')) {
      assert.ok(
        item.fields.has('product'),
        `application/${item.bundle} (${item.locale}) names no product`,
      );
    }
  });
});

describe('seed/shop-sample.sql', () => {
  it('attaches its variants to a product bundle that exists', async () => {
    const sql = await readFile(join('seed', 'shop-sample.sql'), 'utf8');
    const groups = new Set(
      [...sql.matchAll(/'([0-9a-f]{8}-[0-9a-f-]{27})'/g)].map(
        (match) => match[1],
      ),
    );
    assert.ok(groups.size > 0);

    const products = await readdir(join(CONTENT, 'product'), {
      withFileTypes: true,
    });
    const known = new Set<string>();
    for (const bundle of products.filter((entry) => entry.isDirectory())) {
      try {
        const identity = JSON.parse(
          await readFile(
            join(CONTENT, 'product', bundle.name, 'mallok.json'),
            'utf8',
          ),
        ) as { translation_group?: string };
        if (identity.translation_group !== undefined) {
          known.add(identity.translation_group);
        }
      } catch {
        // A bundle without an identity file gets one assigned on import, so
        // nothing in the seed could name it.
      }
    }

    for (const group of groups) {
      assert.ok(
        known.has(group ?? ''),
        `seed/shop-sample.sql names product_group ${group}, which no product bundle's mallok.json declares`,
      );
    }
  });
});

/**
 * `mallok.json` pins a bundle's identity.
 *
 * It is optional: Mallok puts every language of a bundle into one translation
 * group on its own. A bundle carries one here only when something outside the
 * content has to name it — the sample variants attach to the product by its
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
      assert.ok(
        entry.path?.endsWith(`/${item.slug}`),
        `${entry.path} does not end in the slug ${item.slug}`,
      );
      // The default language is unprefixed, every other one carries its code.
      assert.equal(
        entry.path?.startsWith(`/${item.locale}/`),
        item.locale !== site.defaultLocale,
      );
      assert.ok(
        entry.id !== undefined && !ids.has(entry.id),
        `content/${item.kind}/${item.bundle} reuses the id ${entry.id}`,
      );
      ids.add(entry.id);
    }
    assert.ok(ids.size > 0);
  });
});
