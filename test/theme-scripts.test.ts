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
 * browser; what it decides is held here — and, for the calculators, held to
 * every figure the reference page prints, so that a reader who checks a
 * result by hand against the page finds the same number.
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

interface Calculators {
  THREADS: Record<string, { diameter: number; pitch: number }>;
  DENSITY: Record<string, number>;
  YIELD: Record<string, number>;
  NUT_FACTOR: Record<string, number>;
  ENGAGEMENT_RATIO: Record<string, number>;
  LAUNCH_COST_PER_KG: number;
  massReduction(input: {
    thread: string;
    length: number;
    quantity: number;
    baseline: string;
    headFactor: number;
  }): {
    each: Record<string, number>;
    baselineTotal: number;
    titaniumTotal: number;
    saved: number;
    percent: number;
    launchCost: number;
  };
  tighteningTorque(input: {
    thread: string;
    pitch: number;
    grade: string;
    percent: number;
    lubricant: string;
  }): {
    stressArea: number;
    preload: number;
    torque: number;
    torqueLbfIn: number;
    torqueLbfFt: number;
  };
  threadEngagement(input: { thread: string; housing: string }): {
    depth: number;
    threads: number;
  };
}

const PAGE = join('content', 'tool', 'fastener-calculators', 'index.md');
const FORMS = join('src', 'theme', 'partials', 'calculators.liquid');

/**
 * The rows of the first Markdown table after the line that starts with
 * `after`, without its heading row and the row of dashes under it.
 */
function tableAfter(markdown: string, after: string): string[][] {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line.startsWith(after));
  assert.notEqual(start, -1, `the page has no line starting "${after}"`);
  const rows: string[][] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('|')) {
      rows.push(
        line
          .slice(1, -1)
          .split('|')
          .map((cell) => cell.trim()),
      );
    } else if (rows.length > 0) {
      break;
    }
  }
  assert.ok(rows.length > 2, `no table follows "${after}"`);
  return rows.slice(2);
}

/** A cell of a row; a missing one is a failure, not an empty string. */
function cell(row: readonly string[], index: number): string {
  const value = row[index];
  assert.ok(
    value !== undefined,
    `the row ${row.join(' | ')} has no column ${index}`,
  );
  return value;
}

/** Below a kilogram in grams, from a kilogram on in kilograms: as the page prints a total. */
function total(kilograms: number): string {
  return kilograms < 1
    ? `${(kilograms * 1000).toFixed(1)} g`
    : `${kilograms.toFixed(3)} kg`;
}

function sizeOf(fastener: string): { thread: string; length: number } {
  const size = /^(M\d+) × (\d+) mm$/.exec(fastener);
  assert.ok(size, `cannot read the size "${fastener}"`);
  return { thread: size[1] ?? '', length: Number(size[2]) };
}

describe('the calculators’ constants', () => {
  it('are the threads the page lists', async () => {
    const { THREADS } = await load<Calculators>('calculators.js');
    const rows = tableAfter(
      await readFile(PAGE, 'utf8'),
      '## Thread sizes used on this page',
    );

    assert.deepEqual(
      rows.map((row) => cell(row, 0)),
      Object.keys(THREADS),
    );
    for (const row of rows) {
      const thread = THREADS[cell(row, 0)];
      assert.equal(`${thread?.diameter.toFixed(1)} mm`, cell(row, 1));
      assert.equal(thread?.pitch, Number.parseFloat(cell(row, 2)));
    }
  });

  it('are the densities, yield strengths, nut factors and ratios the page states', async () => {
    const script = await load<Calculators>('calculators.js');
    const markdown = await readFile(PAGE, 'utf8');
    const stated = new Map<string, string>();
    for (const heading of [
      '## Titanium versus steel mass reduction',
      '## Tightening torque and preload',
      '## Thread shear engagement depth',
    ]) {
      const section = markdown.slice(markdown.indexOf(heading));
      for (const row of tableAfter(section, '### Constants')) {
        stated.set(cell(row, 0), cell(row, 1));
      }
    }
    const value = (name: string): number => {
      const found = [...stated].find(([label]) => label.startsWith(name));
      assert.ok(found, `the page states no constant starting "${name}"`);
      return Number.parseFloat(found[1].replace(/,/g, ''));
    };

    assert.equal(script.DENSITY.steel, value('Density of carbon steel'));
    assert.equal(script.DENSITY.stainless, value('Density of stainless steel'));
    assert.equal(script.DENSITY.grade5, value('Density of Grade 5'));
    assert.equal(script.DENSITY.grade2, value('Density of Grade 2'));
    assert.equal(script.DENSITY.aluminum, value('Density of 7075-T6'));
    assert.equal(script.LAUNCH_COST_PER_KG, value('Launch payload penalty'));
    assert.equal(script.YIELD.grade5, value('Yield strength Sy, Grade 5'));
    assert.equal(script.YIELD.grade2, value('Yield strength Sy, Grade 2'));
    assert.equal(script.NUT_FACTOR.moly, value('Nut factor K, molybdenum'));
    assert.equal(script.NUT_FACTOR.copper, value('Nut factor K, copper'));
    assert.equal(script.NUT_FACTOR.oil, value('Nut factor K, light'));
    assert.equal(script.NUT_FACTOR.dry, value('Nut factor K, dry'));
    assert.equal(script.ENGAGEMENT_RATIO.aluminum, value('6061-T6'));
    assert.equal(script.ENGAGEMENT_RATIO.magnesium, value('Magnesium'));
    assert.equal(script.ENGAGEMENT_RATIO.titanium, value('Grade 5 titanium'));
    assert.equal(script.ENGAGEMENT_RATIO.steel, value('High-strength'));
  });

  it('are offered by the forms with the values and limits the page states', async () => {
    // The head factors and the limits of the inputs are in the form, not in
    // the script: an option's value, a field's `min` and `max`.
    const form = await readFile(FORMS, 'utf8');
    const markdown = await readFile(PAGE, 'utf8');
    const stated = new Map(
      [
        ...tableAfter(
          markdown.slice(markdown.indexOf('## Titanium versus steel')),
          '### Constants',
        ),
        ...tableAfter(
          markdown.slice(markdown.indexOf('## Tightening torque')),
          '### Constants',
        ),
      ].map((row) => [cell(row, 0), cell(row, 1)]),
    );
    const value = (name: string): string => {
      const found = [...stated].find(([label]) => label.startsWith(name));
      assert.ok(found, `the page states no constant starting "${name}"`);
      return found[1];
    };

    for (const [name, key] of [
      ['Head factor H, socket', 'calc_head_socket'],
      ['Head factor H, button', 'calc_head_button'],
      ['Head factor H, flat', 'calc_head_countersunk'],
      ['Head factor H, hex', 'calc_head_flange'],
    ] as const) {
      assert.ok(
        form.includes(`<option value="${value(name)}">{{ t.${key} }}</option>`),
        `the form does not offer ${name} as ${value(name)}`,
      );
    }
    assert.deepEqual(value('Length L, accepted range').split(' to '), [
      '6',
      '150',
    ]);
    assert.ok(form.includes('name="length" value="30" min="6" max="150"'));
    assert.deepEqual(
      value('Quantity N, accepted range').replace(/,/g, '').split(' to '),
      ['1', '50000'],
    );
    assert.ok(form.includes('name="quantity" value="100" min="1" max="50000"'));
    assert.equal(value('Preload percentage P, default'), '70');
    assert.deepEqual(
      value('Preload percentage P, lowest and highest accepted').split(' and '),
      ['50', '85'],
    );
    assert.ok(form.includes('name="percent" value="70" min="50" max="85"'));
  });
});

describe('the forms the scripts read', () => {
  it('are never asked for a field under a name their own field list answers', async () => {
    // `form.elements.length` is how many fields a form has, whatever one of
    // them is called. A field with such a name has to be asked for another
    // way; this keeps a later edit from trusting the list with one.
    for (const file of ['calculators.js', 'finder.js']) {
      const source = await readFile(join(ASSETS, file), 'utf8');
      for (const name of ['length', 'item', 'namedItem']) {
        assert.ok(
          !source.includes(`.elements.${name}`),
          `${file} reads form.elements.${name}, which is not a field`,
        );
      }
    }
  });

  it('give every field the calculators ask for a name, and name no other', async () => {
    const form = await readFile(FORMS, 'utf8');
    const source = await readFile(join(ASSETS, 'calculators.js'), 'utf8');
    const asked = new Set(
      [...source.matchAll(/field\(form, '([a-z_]+)'\)/g)].map(
        (match) => match[1],
      ),
    );
    const named = new Set(
      [...form.matchAll(/<(?:input|select)[^>]* name="([a-z_]+)"/g)].map(
        (match) => match[1],
      ),
    );

    assert.ok(asked.size > 0);
    assert.deepEqual([...asked].sort(), [...named].sort());
  });

  it('give every result the calculators write a place in the page, and leave none empty', async () => {
    const form = await readFile(FORMS, 'utf8');
    const source = await readFile(join(ASSETS, 'calculators.js'), 'utf8');
    const written = new Set(
      [...source.matchAll(/write\(\s*form,\s*'([a-z0-9_]+)'/g)].map(
        (match) => match[1],
      ),
    );
    const places = new Set(
      [...form.matchAll(/data-out="([a-z0-9_]+)"/g)].map((match) => match[1]),
    );

    assert.ok(written.size > 0);
    assert.deepEqual([...written].sort(), [...places].sort());
  });
});

describe('the mass calculator', () => {
  it('gives the mass of one fastener in each metal that the page’s table gives', async () => {
    const { massReduction } = await load<Calculators>('calculators.js');
    const rows = tableAfter(
      await readFile(PAGE, 'utf8'),
      'Mass of one fastener in each metal.',
    );

    assert.equal(rows.length, 8);
    for (const row of rows) {
      const input = { ...sizeOf(cell(row, 0)), quantity: 1, headFactor: 1.25 };
      const onSteel = massReduction({ ...input, baseline: 'steel' });
      const onStainless = massReduction({ ...input, baseline: 'stainless' });
      assert.equal(`${onSteel.each.baseline?.toFixed(2)} g`, cell(row, 1));
      assert.equal(`${onStainless.each.baseline?.toFixed(2)} g`, cell(row, 2));
      assert.equal(`${onSteel.each.grade5?.toFixed(2)} g`, cell(row, 3));
      assert.equal(`${onSteel.each.grade2?.toFixed(2)} g`, cell(row, 4));
      assert.equal(`${onSteel.each.aluminum?.toFixed(2)} g`, cell(row, 5));
    }
  });

  for (const [baseline, title] of [
    ['steel', 'Mass of 100 fasteners against carbon steel.'],
    ['stainless', 'Mass of 100 fasteners against stainless steel.'],
  ] as const) {
    it(`gives the saving for a hundred fasteners against ${baseline} that the page’s table gives`, async () => {
      const { massReduction } = await load<Calculators>('calculators.js');
      const rows = tableAfter(await readFile(PAGE, 'utf8'), title);

      assert.equal(rows.length, 8);
      for (const row of rows) {
        const result = massReduction({
          ...sizeOf(cell(row, 0)),
          quantity: 100,
          baseline,
          headFactor: 1.25,
        });
        assert.equal(total(result.baselineTotal), cell(row, 1));
        assert.equal(total(result.titaniumTotal), cell(row, 2));
        assert.equal(total(result.saved), cell(row, 3));
        assert.equal(`${result.percent.toFixed(1)}%`, cell(row, 4));
        assert.equal(
          `$${result.launchCost.toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
          cell(row, 5),
        );
      }
    });
  }

  it('allows for the head as the page’s table does', async () => {
    const { massReduction } = await load<Calculators>('calculators.js');
    const rows = tableAfter(
      await readFile(PAGE, 'utf8'),
      'Effect of the head geometry.',
    );

    assert.equal(rows.length, 4);
    for (const row of rows) {
      const result = massReduction({
        thread: 'M6',
        length: 30,
        quantity: 100,
        baseline: 'steel',
        headFactor: Number.parseFloat(cell(row, 1)),
      });
      assert.equal(total(result.baselineTotal), cell(row, 2));
      assert.equal(total(result.titaniumTotal), cell(row, 3));
      assert.equal(total(result.saved), cell(row, 4));
    }
  });
});

describe('the torque calculator', () => {
  for (const [grade, heading] of [
    ['grade5', '### Reference tables for Grade 5 titanium'],
    ['grade2', '### Reference tables for Grade 2 titanium'],
  ] as const) {
    it(`gives the torque, stress area and preload of ${grade} that the page’s tables give`, async () => {
      const { tighteningTorque, THREADS } =
        await load<Calculators>('calculators.js');
      const markdown = await readFile(PAGE, 'utf8');
      const section = markdown.slice(markdown.indexOf(heading));
      const lubricants = ['moly', 'copper', 'oil', 'dry'];
      const at = (thread: string, lubricant: string) =>
        tighteningTorque({
          thread,
          pitch: THREADS[thread]?.pitch ?? 0,
          grade,
          percent: 70,
          lubricant,
        });

      const metric = tableAfter(section, 'Torque in N·m, with the stress area');
      assert.equal(metric.length, 8);
      for (const row of metric) {
        const thread = cell(row, 0);
        assert.equal(
          `${at(thread, 'moly').stressArea.toFixed(2)} mm²`,
          cell(row, 2),
        );
        assert.equal(
          `${at(thread, 'moly').preload.toFixed(2)} kN`,
          cell(row, 3),
        );
        for (const [index, lubricant] of lubricants.entries()) {
          assert.equal(
            `${at(thread, lubricant).torque.toFixed(1)} N·m`,
            cell(row, index + 4),
          );
        }
      }

      const inches = tableAfter(section, 'The same torque in lbf·in:');
      const feet = tableAfter(section, 'The same torque in lbf·ft:');
      assert.equal(inches.length, 8);
      assert.equal(feet.length, 8);
      for (const [rowIndex, row] of inches.entries()) {
        const thread = cell(row, 0);
        for (const [index, lubricant] of lubricants.entries()) {
          assert.equal(
            `${at(thread, lubricant).torqueLbfIn.toFixed(1)} lbf·in`,
            cell(row, index + 1),
          );
          assert.equal(
            `${at(thread, lubricant).torqueLbfFt.toFixed(2)} lbf·ft`,
            cell(feet[rowIndex] ?? [], index + 1),
          );
        }
      }
    });
  }

  it('scales with the share of the yield strength asked for', async () => {
    const { tighteningTorque } = await load<Calculators>('calculators.js');
    const at = (percent: number) =>
      tighteningTorque({
        thread: 'M8',
        pitch: 1.25,
        grade: 'grade5',
        percent,
        lubricant: 'moly',
      });

    assert.ok(Math.abs(at(85).preload / at(50).preload - 85 / 50) < 1e-12);
    assert.equal(at(85).stressArea, at(50).stressArea);
  });

  it('uses the pitch it is given, not only the coarse one', async () => {
    const { tighteningTorque } = await load<Calculators>('calculators.js');
    const fine = tighteningTorque({
      thread: 'M8',
      pitch: 1.0,
      grade: 'grade5',
      percent: 70,
      lubricant: 'moly',
    });

    // 0.7854 × (8 − 0.9382 × 1.0)²
    assert.equal(fine.stressArea.toFixed(2), '39.17');
  });
});

describe('the engagement calculator', () => {
  it('gives the length and the count of threads that the page’s tables give', async () => {
    const { threadEngagement } = await load<Calculators>('calculators.js');
    const markdown = await readFile(PAGE, 'utf8');
    const housings = ['aluminum', 'magnesium', 'titanium', 'steel'];
    const lengths = tableAfter(markdown, 'Minimum thread engagement length.');
    const counts = tableAfter(markdown, 'Minimum engaged full threads.');

    assert.equal(lengths.length, 8);
    assert.equal(counts.length, 8);
    for (const [rowIndex, row] of lengths.entries()) {
      const thread = cell(row, 0);
      assert.equal(cell(counts[rowIndex] ?? [], 0), thread);
      for (const [index, housing] of housings.entries()) {
        const result = threadEngagement({ thread, housing });
        assert.equal(`${result.depth.toFixed(1)} mm`, cell(row, index + 2));
        assert.equal(
          String(result.threads),
          cell(counts[rowIndex] ?? [], index + 2),
        );
      }
    }
  });
});
