import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';

/**
 * The logic of the theme's scripts.
 *
 * A theme script is a plain file served to a browser: no build step, no
 * imports. It hands its pure functions to `module.exports` when a `module`
 * exists, which is only ever here. What it does to a page is looked at in a
 * browser; what it decides is held here.
 */

const ASSETS = join('src', 'theme', 'assets');

async function load<T>(file: string): Promise<T> {
  const source = await readFile(join(ASSETS, file), 'utf8');
  const sandbox = { module: { exports: {} as T }, Intl };
  runInNewContext(source, sandbox, { filename: file });
  return sandbox.module.exports;
}

interface Finder {
  fold(text: string): string;
  matches(
    product: {
      title: string;
      facets: Record<string, string>;
      sizes: string[];
      skus: string[];
    },
    wanted: { facets: Record<string, string>; size: string; query: string },
  ): boolean;
  inOrder(values: string[], locale: string): string[];
}

describe('the finder’s filters', () => {
  const capScrew = {
    title: 'M5 × 0.8 Titanium Socket Head Cap Screw',
    facets: {
      'Head type': 'Socket head cap',
      Thread: 'M5 × 0.8',
      Material: 'Grade 5 titanium',
    },
    sizes: ['10 mm', '16 mm'],
    skus: ['TI-SHC-M5-10', 'TI-SHC-M5-16'],
  };
  const nothing = { facets: {}, size: '', query: '' };

  it('keeps every product when nothing is asked for', async () => {
    const { matches } = await load<Finder>('finder.js');

    assert.equal(matches(capScrew, nothing), true);
    assert.equal(
      matches(capScrew, { facets: { Thread: '' }, size: '', query: '  ' }),
      true,
    );
  });

  it('keeps a product only if every attribute asked for is the one it has', async () => {
    const { matches } = await load<Finder>('finder.js');

    assert.equal(
      matches(capScrew, { ...nothing, facets: { Thread: 'M5 × 0.8' } }),
      true,
    );
    assert.equal(
      matches(capScrew, {
        ...nothing,
        facets: { Thread: 'M5 × 0.8', Material: 'Grade 2 titanium' },
      }),
      false,
    );
    // An attribute the product does not carry cannot be the one asked for.
    assert.equal(
      matches(capScrew, { ...nothing, facets: { Finish: 'Natural' } }),
      false,
    );
  });

  it('keeps a product only if it is offered in the size asked for', async () => {
    const { matches } = await load<Finder>('finder.js');

    assert.equal(matches(capScrew, { ...nothing, size: '16 mm' }), true);
    assert.equal(matches(capScrew, { ...nothing, size: '20 mm' }), false);
    // "6 mm" is not "16 mm": a size is the whole value, not a part of one.
    assert.equal(matches(capScrew, { ...nothing, size: '6 mm' }), false);
  });

  it('finds every word typed, in any order, in the name, the attributes or a SKU', async () => {
    const { matches } = await load<Finder>('finder.js');

    assert.equal(matches(capScrew, { ...nothing, query: 'cap m5' }), true);
    assert.equal(matches(capScrew, { ...nothing, query: 'grade 5' }), true);
    assert.equal(
      matches(capScrew, { ...nothing, query: 'ti-shc-m5-16' }),
      true,
    );
    assert.equal(matches(capScrew, { ...nothing, query: 'cap m6' }), false);
  });

  it('does not let case or an accent hide a word', async () => {
    const { fold, matches } = await load<Finder>('finder.js');

    assert.equal(fold('  Tête   FRAISÉE '), 'tete fraisee');
    assert.equal(
      matches(
        { ...capScrew, title: 'Vis à tête fraisée' },
        { ...nothing, query: 'TETE fraisee' },
      ),
      true,
    );
  });

  it('lists values once, in the order a person reads sizes', async () => {
    const { inOrder } = await load<Finder>('finder.js');

    assert.deepEqual(
      [
        ...inOrder(
          ['M10 × 1.5', 'M3 × 0.5', '', 'M8 × 1.25', 'M3 × 0.5'],
          'en',
        ),
      ],
      ['M3 × 0.5', 'M8 × 1.25', 'M10 × 1.5'],
    );
    assert.deepEqual(
      [...inOrder(['25 mm', '8 mm', '100 mm'], 'de')],
      ['8 mm', '25 mm', '100 mm'],
    );
  });
});
