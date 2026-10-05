/*
 * Filters for the specification finder.
 *
 * The table this works on is complete without it: every product is a row the
 * server rendered. This adds a way to narrow the rows — a list for each
 * attribute, one for the sizes on offer, and a search box — and never the rows
 * themselves. A visitor without the script, and a crawler, lose nothing.
 *
 * The form is in the page already, hidden, with its labels in the page's
 * language. All this does is fill the lists from what the table holds, show
 * the form, and hide the rows that do not match.
 */
(() => {
  /**
   * Text as it is compared: case and accents do not keep a search from
   * finding a word, so "tete" finds "tête".
   */
  function fold(text) {
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Whether a product is still in the running.
   *
   * `product` is what a row says: its name, its attributes by column name,
   * its sizes and its SKUs. `wanted` is what the form asks for: a value per
   * attribute, a size, and the words typed. Empty means no preference.
   */
  function matches(product, wanted) {
    for (const [name, value] of Object.entries(wanted.facets)) {
      if (value !== '' && product.facets[name] !== value) {
        return false;
      }
    }
    if (wanted.size !== '' && !product.sizes.includes(wanted.size)) {
      return false;
    }
    // Every word typed has to be somewhere in the row, in any order.
    const haystack = fold(
      [
        product.title,
        ...Object.values(product.facets),
        ...product.sizes,
        ...product.skus,
      ].join(' '),
    );
    return fold(wanted.query)
      .split(' ')
      .every((word) => haystack.includes(word));
  }

  /** Values in the order a person expects: "M3" before "M10", "8 mm" before "10 mm". */
  function inOrder(values, locale) {
    const compare = new Intl.Collator(locale, {
      numeric: true,
      sensitivity: 'base',
    }).compare;
    return [...new Set(values)].filter((value) => value !== '').sort(compare);
  }

  function readRow(row) {
    const facets = {};
    for (const cell of row.querySelectorAll('td.facet')) {
      facets[cell.dataset.label] = cell.textContent.trim();
    }
    const chips = [...row.querySelectorAll('.chip')];
    return {
      title: row.querySelector('.finder-product a')?.textContent.trim() ?? '',
      facets,
      sizes: chips.map((chip) => chip.textContent.trim()),
      skus: chips.map((chip) => chip.title),
    };
  }

  function enhance(finder) {
    const form = finder.querySelector('.finder-filters');
    const wrap = finder.querySelector('.finder-table-wrap');
    const none = finder.querySelector('.finder-none');
    if (form === null || wrap === null) {
      return;
    }
    // Where the number of matches is announced. It is added here, not in the
    // page: without this script it would be an empty element.
    const count = document.createElement('p');
    count.className = 'finder-count';
    count.setAttribute('role', 'status');
    form.append(count);
    const locale = document.documentElement.lang || 'en';
    const rows = [...wrap.querySelectorAll('tbody tr')].map((element) => ({
      element,
      product: readRow(element),
    }));

    for (const select of form.querySelectorAll('select')) {
      const values =
        select.name === 'size'
          ? rows.flatMap((row) => row.product.sizes)
          : rows.map((row) => row.product.facets[select.dataset.facet] ?? '');
      for (const value of inOrder(values, locale)) {
        select.append(new Option(value, value));
      }
    }

    function apply() {
      const wanted = {
        facets: {},
        size: form.elements.size?.value ?? '',
        query: form.elements.q?.value ?? '',
      };
      for (const select of form.querySelectorAll('select[data-facet]')) {
        wanted.facets[select.dataset.facet] = select.value;
      }
      let shown = 0;
      for (const row of rows) {
        const keep = matches(row.product, wanted);
        row.element.hidden = !keep;
        shown += keep ? 1 : 0;
        // The size asked for stands out among the sizes a product has.
        for (const chip of row.element.querySelectorAll('.chip')) {
          chip.classList.toggle(
            'is-match',
            wanted.size !== '' && chip.textContent.trim() === wanted.size,
          );
        }
      }
      wrap.hidden = shown === 0;
      if (none !== null) {
        none.hidden = shown !== 0;
      }
      count.textContent = (form.dataset.count ?? '')
        .replace('{shown}', String(shown))
        .replace('{total}', String(rows.length));
    }

    form.addEventListener('input', apply);
    // A reset empties the fields after the event, so read them a moment later.
    form.addEventListener('reset', () => setTimeout(apply));
    form.addEventListener('submit', (event) => event.preventDefault());
    form.hidden = false;
    apply();
  }

  if (typeof module === 'object' && module !== null) {
    // Loaded by a test: hand over the parts that hold the logic.
    module.exports = { fold, matches, inOrder };
    return;
  }
  for (const finder of document.querySelectorAll('[data-finder]')) {
    enhance(finder);
  }
})();
