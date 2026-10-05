/*
 * The three fastener calculators on the engineering reference page.
 *
 * The page they sit on is complete without them: it prints the same formulas,
 * every constant and tables of results. This lets a reader put their own
 * numbers in. The forms are in the page already, hidden, with their labels in
 * the page's language; this reads them, computes, and writes the results into
 * the <output> elements beside them.
 *
 * Every constant below is also printed on the page, and a test holds the two
 * together: a figure computed here is the figure the page's tables show.
 */
(() => {
  /** Nominal diameter and coarse pitch of the metric threads offered, in mm. */
  const THREADS = {
    M3: { diameter: 3.0, pitch: 0.5 },
    M4: { diameter: 4.0, pitch: 0.7 },
    M5: { diameter: 5.0, pitch: 0.8 },
    M6: { diameter: 6.0, pitch: 1.0 },
    M8: { diameter: 8.0, pitch: 1.25 },
    M10: { diameter: 10.0, pitch: 1.5 },
    M12: { diameter: 12.0, pitch: 1.75 },
    M16: { diameter: 16.0, pitch: 2.0 },
  };

  /** Densities, in g/cm³. */
  const DENSITY = {
    steel: 7.85,
    stainless: 8.0,
    grade5: 4.43,
    grade2: 4.51,
    aluminum: 2.81,
  };

  /** What launching a kilogram is taken to cost, in dollars. */
  const LAUNCH_COST_PER_KG = 10000;

  /** Yield strength, in MPa. */
  const YIELD = { grade5: 828, grade2: 275 };

  /** Nut factor K for each condition of the threads. */
  const NUT_FACTOR = { moly: 0.11, copper: 0.13, oil: 0.16, dry: 0.22 };

  /** Engagement length as a multiple of the diameter, by housing material. */
  const ENGAGEMENT_RATIO = {
    aluminum: 1.8,
    magnesium: 2.2,
    titanium: 1.2,
    steel: 1.0,
  };

  /**
   * The mass of a set of fasteners in each metal.
   *
   * A fastener is taken as a cylinder of its nominal diameter over its whole
   * length, times an allowance for the head. Masses of one fastener are in
   * grams, totals in kilograms.
   */
  function massReduction({ thread, length, quantity, baseline, headFactor }) {
    const radius = THREADS[thread].diameter / 2;
    const volume = ((Math.PI * radius ** 2 * length) / 1000) * headFactor;
    const base = DENSITY[baseline];
    const baselineTotal = (volume * base * quantity) / 1000;
    const titaniumTotal = (volume * DENSITY.grade5 * quantity) / 1000;
    const saved = baselineTotal - titaniumTotal;
    return {
      each: {
        baseline: volume * base,
        grade5: volume * DENSITY.grade5,
        grade2: volume * DENSITY.grade2,
        aluminum: volume * DENSITY.aluminum,
      },
      baselineTotal,
      titaniumTotal,
      saved,
      percent: ((base - DENSITY.grade5) / base) * 100,
      launchCost: saved * LAUNCH_COST_PER_KG,
    };
  }

  /**
   * The tightening torque that gives a preload, by the nut factor formula
   * T = K × F × d. The preload is a share of the yield strength acting on
   * the thread's tensile stress area.
   */
  function tighteningTorque({ thread, pitch, grade, percent, lubricant }) {
    const diameter = THREADS[thread].diameter;
    const stressArea = 0.7854 * (diameter - 0.9382 * pitch) ** 2;
    const preload = (stressArea * YIELD[grade] * (percent / 100)) / 1000;
    const torque = NUT_FACTOR[lubricant] * (preload * 1000) * (diameter / 1000);
    return {
      stressArea,
      preload,
      torque,
      torqueLbfIn: torque * 8.8507,
      torqueLbfFt: torque * 0.73756,
    };
  }

  /**
   * How deep a Grade 5 bolt has to engage in a tapped hole for the bolt to
   * break before the threads strip.
   */
  function threadEngagement({ thread, housing }) {
    const { diameter, pitch } = THREADS[thread];
    const depth = diameter * ENGAGEMENT_RATIO[housing];
    return { depth, threads: Math.ceil(depth / pitch) };
  }

  /**
   * A number in the page's language, with a fixed count of decimals. Only an
   * amount of money is grouped into thousands, as on the page's own tables.
   */
  function formatter(locale) {
    return (value, decimals, grouped = false) =>
      new Intl.NumberFormat(locale, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
        useGrouping: grouped ? 'always' : false,
      }).format(value);
  }

  /**
   * A form's field, by its name. Asked of the document rather than read off
   * the form's own list of fields: that list has properties of its own, and
   * a field named after one of them — "length" is the obvious name for a
   * fastener's — is not what the list returns under that name.
   */
  function field(form, name) {
    return form.querySelector(`[name="${name}"]`);
  }

  /** A whole number an input is allowed to hold, or its nearest limit. */
  function clamp(input) {
    const value = Number.parseFloat(input.value);
    const low = Number.parseFloat(input.min);
    const high = Number.parseFloat(input.max);
    if (!Number.isFinite(value)) {
      return Number.parseFloat(input.defaultValue);
    }
    return Math.min(high, Math.max(low, value));
  }

  function enhance(root) {
    const format = formatter(document.documentElement.lang || 'en');
    // Where a language puts the sign: "44.6%" and "$3,626", "44,6 %" and
    // "3.626 $". The page says which, in its own language.
    const percent = (value) =>
      (root.dataset.percent ?? '{value}%').replace('{value}', format(value, 1));
    const money = (value) =>
      (root.dataset.money ?? '{value} $').replace(
        '{value}',
        format(value, 0, true),
      );
    const write = (form, name, text) => {
      const target = form.querySelector(`[data-out="${name}"]`);
      if (target !== null) {
        target.textContent = text;
      }
    };
    /** Below a kilogram in grams, from a kilogram on in kilograms. */
    const mass = (kilograms) =>
      kilograms < 1
        ? `${format(kilograms * 1000, 1)} g`
        : `${format(kilograms, 3)} kg`;

    const calculators = {
      mass(form) {
        const result = massReduction({
          thread: field(form, 'thread').value,
          length: clamp(field(form, 'length')),
          quantity: clamp(field(form, 'quantity')),
          baseline: field(form, 'baseline').value,
          headFactor: Number.parseFloat(field(form, 'head').value),
        });
        write(form, 'percent', percent(result.percent));
        write(form, 'baseline_total', mass(result.baselineTotal));
        write(form, 'titanium_total', mass(result.titaniumTotal));
        write(form, 'saved', mass(result.saved));
        write(form, 'launch_cost', money(result.launchCost));
        write(form, 'each_baseline', `${format(result.each.baseline, 2)} g`);
        write(form, 'each_grade5', `${format(result.each.grade5, 2)} g`);
        write(form, 'each_grade2', `${format(result.each.grade2, 2)} g`);
        write(form, 'each_aluminum', `${format(result.each.aluminum, 2)} g`);
      },
      torque(form) {
        const lubricant = field(form, 'lubricant').value;
        const result = tighteningTorque({
          thread: field(form, 'thread').value,
          pitch: clamp(field(form, 'pitch')),
          grade: field(form, 'grade').value,
          percent: clamp(field(form, 'percent')),
          lubricant,
        });
        write(form, 'torque', `${format(result.torque, 1)} N·m`);
        write(form, 'torque_lbf_in', `${format(result.torqueLbfIn, 1)} lbf·in`);
        write(form, 'torque_lbf_ft', `${format(result.torqueLbfFt, 2)} lbf·ft`);
        write(form, 'stress_area', `${format(result.stressArea, 2)} mm²`);
        write(form, 'preload', `${format(result.preload, 2)} kN`);
        const warning = form.querySelector('[data-dry-warning]');
        if (warning !== null) {
          warning.hidden = lubricant !== 'dry';
        }
      },
      engagement(form) {
        const housing = field(form, 'housing').value;
        const result = threadEngagement({
          thread: field(form, 'thread').value,
          housing,
        });
        write(form, 'depth', `${format(result.depth, 1)} mm`);
        write(form, 'threads', String(result.threads));
        for (const note of form.querySelectorAll('[data-housing]')) {
          note.hidden = note.dataset.housing !== housing;
        }
      },
    };

    for (const form of root.querySelectorAll('form[data-calculator]')) {
      const compute = calculators[form.dataset.calculator];
      if (compute === undefined) {
        continue;
      }
      // Choosing a thread sets its coarse pitch; the reader may then change it.
      const thread = field(form, 'thread');
      const pitch = field(form, 'pitch');
      if (thread !== null && pitch !== null) {
        thread.addEventListener('change', () => {
          pitch.value = String(THREADS[thread.value].pitch);
        });
      }
      form.addEventListener('input', () => compute(form));
      form.addEventListener('change', () => compute(form));
      form.addEventListener('submit', (event) => event.preventDefault());
      compute(form);
    }
    root.hidden = false;
  }

  if (typeof module === 'object' && module !== null) {
    // Loaded by a test: hand over the parts that hold the arithmetic.
    module.exports = {
      THREADS,
      DENSITY,
      YIELD,
      NUT_FACTOR,
      ENGAGEMENT_RATIO,
      LAUNCH_COST_PER_KG,
      massReduction,
      tighteningTorque,
      threadEngagement,
    };
    return;
  }
  for (const root of document.querySelectorAll('[data-calculators]')) {
    enhance(root);
  }
})();
