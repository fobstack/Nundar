/*
 * The currency switch.
 *
 * Every price on the page is already there, in the currency the page's
 * language goes with, and carries its amount in each other currency the page
 * offers. This puts one of those in its place when a buyer asks, and keeps
 * the choice for the next page. A visitor without the script, and a crawler,
 * see the page's own currency — which is the one its structured data states.
 *
 * The control is in the page already, hidden, with one button for each
 * currency. All this does is show it, and swap the amounts.
 *
 * The choice is kept in the browser's own storage and nowhere else. Not in a
 * cookie: a cookie on a public page would take that visitor's pages out of
 * the shared cache.
 */
(() => {
  const KEY = 'nundar-currency';

  /**
   * The currency to show: the one asked for when this page offers it, and
   * the page's own otherwise. `wanted` is whatever storage held, which may
   * be nothing, or a currency this page has no price in.
   */
  function choose(wanted, offered, own) {
    return typeof wanted === 'string' && offered.includes(wanted)
      ? wanted
      : own;
  }

  /**
   * What the visitor chose before. Storage can be switched off, and then
   * even asking for it throws: no choice was kept, which is an answer.
   */
  function recall(storage) {
    try {
      return storage().getItem(KEY);
    } catch {
      return null;
    }
  }

  /** Keeps a choice, where the browser allows. It holds for this page either way. */
  function remember(storage, code) {
    try {
      storage().setItem(KEY, code);
    } catch {
      // Not kept.
    }
  }

  if (typeof module === 'object' && module !== null) {
    // Loaded by a test: hand over the parts that hold the logic.
    module.exports = { KEY, choose, recall, remember };
    return;
  }

  const controls = [...document.querySelectorAll('[data-currency]')];
  const [first] = controls;
  if (first === undefined) {
    return;
  }
  const own = first.dataset.currency;
  const offered = [...first.querySelectorAll('button')].map(
    (button) => button.value,
  );
  const storage = () => window.localStorage;

  function show(code) {
    for (const price of document.querySelectorAll('[data-price]')) {
      const amount = price.getAttribute(`data-${code}`);
      if (amount !== null) {
        price.textContent = amount;
      }
    }
    for (const button of document.querySelectorAll('[data-currency] button')) {
      button.setAttribute('aria-pressed', String(button.value === code));
    }
  }

  const chosen = choose(recall(storage), offered, own);
  if (chosen !== own) {
    show(chosen);
  }
  for (const control of controls) {
    control.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (button === null || !offered.includes(button.value)) {
        return;
      }
      show(button.value);
      remember(storage, button.value);
    });
    control.hidden = false;
  }
})();
