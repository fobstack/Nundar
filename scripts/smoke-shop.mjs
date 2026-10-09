/**
 * The shop, end to end, against a real Worker.
 *
 * `npm run smoke` proves the Worker boots. This goes on to do what an operator
 * and then a buyer would do, in a throwaway local environment:
 *
 *   1. create the administrator and switch the plugins on;
 *   2. apply `site.json` and publish `content/` with the Mallok CLI;
 *   3. load the sample variants from `seed/shop-sample.sql`;
 *   4. request every kind of page, follow the navigation in every language,
 *      and fetch the theme's own files;
 *   5. add to the cart with the form a product page offers, and read the
 *      cart page it leads to;
 *   6. add a variant the way the admin's form does, and delete it.
 *
 * It exists because the unit tests, thorough as they are, run each piece in
 * isolation. This is the one place the theme, the plugin, the content and the
 * CLI are seen working together the way a deployed shop works.
 *
 * Like `smoke`, it is separate from `test`: it needs a workerd process and a
 * free port.
 */

import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  escaped,
  expect,
  fillShop,
  freePort,
  query as queryState,
  startWorker,
  timeout,
} from './lib/local-shop.mjs';

// Throwaway state, so a run never sees yesterday's database.
const state = await mkdtemp(join(tmpdir(), 'nundar-smoke-'));
const worker = startWorker({ port: await freePort(), state });
const { base } = worker;
let failure = null;

async function page(path) {
  const response = await fetch(`${base}${path}`, { signal: timeout() });
  return {
    status: response.status,
    html: await response.text(),
    tags: (response.headers.get('cache-tag') ?? '').split(','),
  };
}

/**
 * The `<head>` of a page. An address is also in the body wherever something
 * links to it — the language switcher links to every translation — so a
 * check on hreflang looks here and nowhere else.
 */
function headOf(html) {
  return /<head>[\s\S]*?<\/head>/.exec(html)?.[0] ?? '';
}

/** Every file under a directory, as paths relative to it. */
async function filesUnder(directory, prefix = '') {
  const found = [];
  for (const entry of await readdir(join(directory, prefix), {
    withFileTypes: true,
  })) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...(await filesUnder(directory, path)));
    } else {
      found.push(path);
    }
  }
  return found;
}

/**
 * The form a page offers for one SKU, as a browser would submit it: where
 * it posts, and the value of every field it carries.
 */
function offerForm(html, sku) {
  const row = [...html.matchAll(/<li class="offer">([\s\S]*?)<\/li>/g)]
    .map((match) => match[1])
    .find((inside) => inside.includes(`<span class="offer-sku">${sku}</span>`));
  const form = /<form\b[^>]*\baction="([^"]*)"[^>]*>([\s\S]*?)<\/form>/.exec(
    row ?? '',
  );
  if (form === null) {
    return null;
  }
  const fields = {};
  for (const [, tag] of form[2].matchAll(/<input\b([^>]*)>/g)) {
    const name = /\bname="([^"]*)"/.exec(tag)?.[1];
    if (name !== undefined) {
      fields[name] = /\bvalue="([^"]*)"/.exec(tag)?.[1] ?? '';
    }
  }
  return { action: form[1], fields };
}

/** Submits a form the way a browser on this site does, without following. */
function submit(form, change = {}, cookie) {
  return fetch(`${base}${form.action}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin: base,
      'sec-fetch-site': 'same-origin',
      ...(cookie === undefined ? {} : { cookie }),
    },
    body: new URLSearchParams({ ...form.fields, ...change }).toString(),
    redirect: 'manual',
    signal: timeout(),
  });
}

/** Runs a query against the throwaway local D1 and returns its rows. */
const query = (sql) => queryState(state, sql);

try {
  await worker.ready();

  // 1 to 3. The administrator, the plugins, the settings, the content and
  // the variants: the same set-up `npm run preview` leaves running.
  const { token } = await fillShop({ base, state, tokenName: 'smoke-shop' });

  const variants = await query(
    `SELECT v.sku FROM p_shop_variant AS v
     JOIN content AS c ON c.translation_group = v.product_group
     WHERE c.locale = 'en' ORDER BY v.sku`,
  );
  expect(
    variants.length === 9,
    `the nine sample variants should attach to the published products; ${variants.length} did`,
  );

  // Every language of one bundle has to land in one translation group, or
  // hreflang cannot connect them. The products pin their group in
  // mallok.json; the other bundles have theirs assigned on import, so check
  // those: five industry pages, each in four languages.
  const groups = await query(
    `SELECT COUNT(DISTINCT translation_group) AS n, COUNT(*) AS rows
     FROM content WHERE kind = 'application'`,
  );
  expect(
    groups[0].n === 5 && groups[0].rows === 20,
    `the industry pages should be five translation groups of four languages; found ${JSON.stringify(groups[0])}`,
  );

  // 4. The pages a buyer and a crawler receive.
  const capScrew = '/products/titanium-socket-head-cap-screw-m5';
  const product = await page(capScrew);
  expect(product.status === 200, `the product page returned ${product.status}`);
  expect(
    product.html.includes('M5 × 0.8 Titanium Socket Head Cap Screw'),
    'the product page does not show the product',
  );
  expect(
    product.html.includes(
      '<span class="offer-sku">TI-SHC-M5-20</span><span class="offer-size">20 mm</span>',
    ),
    'the product page does not list the SKU of a size it offers',
  );
  // What the shop plugin read for the page while Mallok rendered it: the
  // seeded variant's price, its minimum order and its state, in the row of
  // the size that carries its SKU.
  const offered =
    /<li class="offer">(?:(?!<\/li>)[\s\S])*TI-SHC-M5-20[\s\S]*?<\/li>/.exec(
      product.html,
    )?.[0] ?? '';
  expect(
    offered.includes('>$2.20</span>') &&
      offered.includes('<dd>100</dd>') &&
      offered.includes('<span class="avail avail-in_stock">In stock</span>') &&
      offered.includes('<dd>5–10 business days</dd>'),
    'the product page does not show the price, minimum order, availability and lead time of a size',
  );
  // The row's price also holds its amount in the sample's other currencies,
  // and the page has the switch that shows them — hidden, with its script.
  expect(
    offered.includes(
      '<span class="price" data-price data-usd="$2.20" data-eur="€2.10" data-gbp="£1.80">$2.20</span>',
    ) &&
      /<div class="currency"[^>]* data-currency="usd" hidden>/.test(
        product.html,
      ) &&
      /<script src="\/theme\/[^"]+\/currency\.js" defer><\/script>/.test(
        product.html,
      ),
    'the product page does not carry its prices in the other currencies, or the switch that shows them',
  );
  // The same prices, and no others, in the page's structured data.
  const structured = JSON.parse(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(
      product.html,
    )?.[1] ?? '{}',
  );
  expect(
    structured['@type'] === 'Product' &&
      structured.offers?.['@type'] === 'AggregateOffer' &&
      structured.offers.priceCurrency === 'USD' &&
      structured.offers.lowPrice === '1.85' &&
      structured.offers.highPrice === '2.45' &&
      structured.offers.offerCount === 4,
    `the product page's structured data does not offer its four sizes: ${JSON.stringify(structured.offers)}`,
  );
  // And the page says what it depends on, for a price change to purge.
  expect(
    product.tags.includes('p:shop:50b0633f-18e5-5dd3-8079-19659453e7c6'),
    'the product page does not carry its product\u2019s cache tag',
  );

  // A part that is made when it is ordered says so, with how long it takes.
  const shoulder = await page('/products/titanium-shoulder-screw-m6');
  expect(
    shoulder.status === 200 &&
      shoulder.html.includes(
        '<span class="avail avail-made_to_order">Made to order</span>',
      ) &&
      shoulder.html.includes('<dd>20–30 business days</dd>') &&
      shoulder.html.includes('>$12.50</span>'),
    'the made-to-order part does not say it is made to order, at what price and how soon',
  );
  // The cards under the text are built from the references other pages
  // declare. The same addresses are also written in this page's body, so
  // each check names the card, not just the address.
  expect(
    product.html.includes(
      '<a class="card" href="/industries/aerospace-defense">',
    ),
    'the product page does not list an industry page written about it',
  );
  expect(
    product.html.includes(
      '<a class="card" href="/case-studies/orbital-stage-separation-fasteners">',
    ),
    'the product page does not list the case study that used it',
  );
  expect(
    headOf(product.html).includes('hreflang="x-default"'),
    'the product page carries no hreflang',
  );

  // The gallery is the bundle's own images, uploaded by `publish`.
  const picture = /<figure class="gallery"[^>]*>\s*<img src="([^"]+)"/.exec(
    product.html,
  )?.[1];
  expect(picture !== undefined, 'the product page shows no gallery image');
  const image = await fetch(new URL(picture, base), { signal: timeout() });
  expect(
    image.ok && (image.headers.get('content-type') ?? '').startsWith('image/'),
    `the product's first image returned ${image.status}`,
  );

  const german = await page(
    '/de/products/titan-zylinderschraube-innensechskant-m5',
  );
  expect(
    german.status === 200,
    `the German product page returned ${german.status}`,
  );
  expect(
    german.html.includes('<dt>Stückpreis</dt>') &&
      german.html.includes(
        '<span class="avail avail-in_stock">Auf Lager</span>',
      ) &&
      german.html.includes('5–10 Werktage'),
    'the German product page does not show its sizes’ terms in German',
  );
  // A German page is in euros, on the page and in what it tells a crawler.
  const germanData = JSON.parse(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(
      german.html,
    )?.[1] ?? '{}',
  );
  expect(
    />2,10\s€<\/span>/.test(german.html) &&
      germanData.offers?.priceCurrency === 'EUR' &&
      germanData.offers.lowPrice === '1.75' &&
      germanData.offers.highPrice === '2.30',
    `the German product page is not priced in euros: ${JSON.stringify(germanData.offers)}`,
  );
  expect(
    german.html.includes(
      '<a class="card" href="/de/industries/luft-raumfahrt-und-verteidigung">',
    ),
    'the German product page does not list the German industry page',
  );
  // The header's button and the footer's link take their addresses from the
  // German values of two theme options, not from the navigation.
  expect(
    german.html.includes(
      '<a class="btn btn-solid" href="/de/sonderanfertigung">',
    ) && german.html.includes('<a class="footer-cta" href="/de/kontakt">'),
    'the German page does not send its buttons to the German quote and contact pages',
  );

  const industry = await page('/industries/aerospace-defense');
  expect(
    industry.status === 200 &&
      industry.html.includes(
        `<p class="spec-card-title"><a href="${capScrew}">`,
      ),
    'the industry page does not name the product it discusses',
  );
  expect(
    headOf(industry.html).includes(
      `hreflang="es" href="${base}/es/industries/aeroespacial-y-defensa"`,
    ),
    'the industry page carries no hreflang to its Spanish version',
  );

  const collection = await page('/collections/socket-head-cap-screws');
  expect(
    collection.status === 200 &&
      /<tbody[\s\S]*<\/tbody>/
        .exec(collection.html)?.[0]
        .includes(`href="${capScrew}"`),
    'the collection page does not list its product',
  );

  const study = await page('/case-studies/orbital-stage-separation-fasteners');
  expect(
    study.status === 200 &&
      study.html.includes('class="results"') &&
      study.html.includes(`<p class="spec-card-title"><a href="${capScrew}">`),
    'the case study does not show its results and the part it used',
  );

  const home = await page('/');
  const finder = /id="specification-finder"[\s\S]*?<\/section>/.exec(
    home.html,
  )?.[0];
  expect(
    home.status === 200 &&
      (finder?.match(/<tr role="row">/g) ?? []).length === 7,
    'the home page’s specification finder should hold a header and six products',
  );
  // Under each product's name, what it starts at and whether it can be had.
  expect(
    (finder?.match(/<p class="finder-offer">/g) ?? []).length === 6 &&
      finder.includes('>$1.85</span></span>') &&
      finder.includes('>$12.50</span></span>') &&
      finder.includes('<span class="price">from <span data-price '),
    'the home page’s finder does not show what each product starts at',
  );

  const questions = await page('/faq');
  expect(
    questions.status === 200 &&
      (questions.html.match(/<details class="faq-item"/g) ?? []).length === 6,
    'the questions page should gather the six sample questions',
  );
  const topic = await page('/faq/titanium-grades-and-corrosion');
  expect(
    topic.status === 200 && topic.html.includes('"FAQPage"'),
    'a questions topic carries no FAQ structured data',
  );

  // The reference page asks for the calculators in its front matter, in every
  // language: the forms are in the page, hidden, above tables that are there
  // with or without them.
  for (const path of [
    '/tools/fastener-calculators',
    '/de/tools/schraubenrechner',
    '/fr/tools/calculateurs-de-fixations',
    '/es/tools/calculadoras-de-fijaciones',
  ]) {
    const tool = await page(path);
    expect(
      tool.status === 200 && tool.html.includes('<table>'),
      `${path} does not show its reference tables`,
    );
    expect(
      tool.html.includes('<section class="calcs" data-calculators hidden ') &&
        /<script src="\/theme\/[^"]+\/calculators\.js" defer><\/script>/.test(
          tool.html,
        ),
      `${path} does not carry the calculators it asks for`,
    );
  }

  // The form is the inquiry plugin's, put where the page wrote `[[inquiry]]`.
  // Its English is the plugin's own; the French comes from the theme's pack.
  const french = JSON.parse(
    await readFile('src/theme/locales/fr.json', 'utf8'),
  );
  for (const [path, submit] of [
    ['/contact', 'Send inquiry'],
    ['/fr/contact', french.inquiry_submit],
  ]) {
    const contact = await page(path);
    expect(
      contact.status === 200 &&
        contact.html.includes('<form class="mallok-inquiry"') &&
        !contact.html.includes('[[inquiry]]'),
      `${path} does not carry the inquiry form`,
    );
    expect(
      contact.html.includes(`<button type="submit">${submit}</button>`),
      `${path} does not label the inquiry form in its language`,
    );
  }

  // The navigation and the footer are written in `site.json`, the pages they
  // name are in `content/`: nothing but a request shows they still agree.
  const site = JSON.parse(await readFile('site.json', 'utf8'));
  let followed = 0;
  for (const locale of site.locales) {
    const start = locale === site.defaultLocale ? '/' : `/${locale}/`;
    const front = await page(start);
    expect(front.status === 200, `${start} returned ${front.status}`);
    // The tagline is one of Mallok's own settings and has a value per
    // language in `site.json`; `publish --with-settings` applied them all.
    expect(
      front.html.includes(
        `<title>${escaped(site.name)} — ${escaped(site.tagline[locale])}</title>`,
      ),
      `${start} is not titled with the ${locale} tagline in site.json`,
    );
    // Under the finder, the way into the whole catalogue. Its address is
    // Mallok's, from the base `site.json` gives products; no option names it.
    const catalogue = `${start}${site.kinds.product.base}`;
    expect(
      front.html.includes(
        `<p class="finder-more"><a class="text-link" href="${catalogue}">`,
      ),
      `${start} does not link to the catalogue at ${catalogue}`,
    );
    const listed = await page(catalogue);
    expect(listed.status === 200, `${catalogue} returned ${listed.status}`);
    const chrome = [
      /<header class="topbar">[\s\S]*?<\/header>/.exec(front.html)?.[0] ?? '',
      /<footer class="footer">[\s\S]*?<\/footer>/.exec(front.html)?.[0] ?? '',
    ].join('');
    const links = new Set(
      [...chrome.matchAll(/href="(\/[^"#]*)"/g)].map((match) => match[1]),
    );
    expect(links.size >= 10, `${start} has only ${links.size} links around it`);
    for (const href of links) {
      const target = await page(href);
      expect(
        target.status === 200,
        `${href}, linked from the header or footer of ${start}, returned ${target.status}`,
      );
      followed += 1;
    }
  }

  // The theme's own files, every one of them, at the address its version
  // gives them.
  const theme = JSON.parse(await readFile('src/theme/theme.json', 'utf8'));
  const assets = `${base}/theme/${theme.id}/${theme.version}`;
  const types = {
    css: 'text/css',
    js: 'text/javascript',
    woff2: 'font/woff2',
    webp: 'image/webp',
    txt: 'text/plain',
  };
  const shipped = await filesUnder('src/theme/assets');
  expect(shipped.length >= 10, `only ${shipped.length} theme files were found`);
  for (const file of shipped) {
    const type = types[file.split('.').pop()];
    expect(
      type !== undefined,
      `the theme ships ${file}, a kind of file this run does not know`,
    );
    const asset = await fetch(`${assets}/${file}`, { signal: timeout() });
    expect(
      asset.ok && (asset.headers.get('content-type') ?? '').includes(type),
      `the theme's ${file} returned ${asset.status} — run \`npm run build\` first`,
    );
  }
  expect(
    home.html.includes(`href="/theme/${theme.id}/${theme.version}/style.css"`),
    'the home page does not load the stylesheet of the theme version built',
  );

  // 5. The cart, the way a browser reaches it: the form the product page
  //    offers for a size, posted as it stands, and the page the answer
  //    sends the buyer to. The 20 mm screw is sold in hundreds.
  const form = offerForm(product.html, 'TI-SHC-M5-20');
  expect(
    form !== null &&
      form.action === '/_mallok/p/shop/cart/update' &&
      form.fields.variant === 'sample-ti-shc-m5-20' &&
      form.fields.quantity === '100' &&
      form.fields.currency === 'USD',
    `the product page offers no usable form for its 20 mm size: ${JSON.stringify(form)}`,
  );
  expect(
    /<input type="number" name="quantity" min="100" step="100" max="500" value="100"/.test(
      product.html,
    ),
    'the quantity field does not start at the minimum order, step by it and stop at the most a line may hold',
  );

  // A request can skip the field: the server says no itself. It sends the
  // buyer to the cart page, which says why, and nothing is put in a cart.
  const refused = await submit(form, { quantity: '3' });
  const refusedTo = refused.headers.get('location') ?? '';
  expect(
    refused.status === 303 &&
      refusedTo ===
        '/_mallok/p/shop/cart?refused=below_moq&variant=sample-ti-shc-m5-20',
    `a quantity below the minimum order returned ${refused.status} to ${refusedTo}`,
  );
  expect(
    refused.headers.get('set-cookie') === null,
    'a refused request was given a cart',
  );
  const refusedPage = await page(refusedTo);
  expect(
    refusedPage.status === 200 &&
      refusedPage.html.includes('data-problem="below_moq"') &&
      refusedPage.html.includes('The minimum order is 100') &&
      refusedPage.html.includes('<p class="empty">Your cart is empty.</p>'),
    'the cart page does not say why a quantity below the minimum order was refused',
  );

  const added = await submit(form);
  expect(
    added.status === 303 &&
      added.headers.get('location') === '/_mallok/p/shop/cart',
    `adding to the cart returned ${added.status} to ${added.headers.get('location')}`,
  );
  const cookieHeader = added.headers.get('set-cookie') ?? '';
  expect(
    cookieHeader.includes('Path=/_mallok/p/shop'),
    'the cart cookie is not scoped to the plugin path',
  );
  const cartCookie = cookieHeader.split(';')[0];

  // The cart page: the site's own page, with the line priced now.
  const cartPage = await fetch(`${base}/_mallok/p/shop/cart`, {
    headers: { cookie: cartCookie },
    signal: timeout(),
  });
  const cart = await cartPage.text();
  expect(
    cartPage.status === 200 &&
      cart.includes('<h1 class="detail-title">Your cart</h1>') &&
      cart.includes('<header class="topbar">') &&
      cart.includes('<p class="offer-sku">TI-SHC-M5-20</p>') &&
      cart.includes(
        `<p class="cart-name"><a href="${capScrew}">M5 × 0.8 Titanium Socket Head Cap Screw</a></p>`,
      ),
    `the cart page does not show the part that was added (${cartPage.status})`,
  );
  expect(
    />\$2\.20<\/span>/.test(cart) &&
      /<p class="cart-subtotal">[\s\S]*?>\$220\.00<\/span>/.test(cart),
    'the cart page does not price the line and state the sum',
  );
  expect(
    cartPage.headers.get('cache-control') === 'private, no-store' &&
      cartPage.headers.get('x-robots-tag') === 'noindex' &&
      !/<script\b/.test(cart),
    'the cart page is cached, indexable or carries a script',
  );

  // The same cart in German, in euros once the buyer chooses them.
  const chosen = await fetch(`${base}/_mallok/p/shop/de/cart/update`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin: base,
      cookie: cartCookie,
    },
    body: 'action=currency&currency=EUR',
    redirect: 'manual',
    signal: timeout(),
  });
  expect(
    chosen.status === 303 &&
      chosen.headers.get('location') === '/_mallok/p/shop/de/cart',
    `choosing a currency returned ${chosen.status}`,
  );
  const germanCart = await (
    await fetch(`${base}/_mallok/p/shop/de/cart`, {
      headers: { cookie: cartCookie },
      signal: timeout(),
    })
  ).text();
  expect(
    germanCart.includes('<h1 class="detail-title">Ihr Warenkorb</h1>') &&
      germanCart.includes(
        '<p class="cart-name"><a href="/de/products/titan-zylinderschraube-innensechskant-m5">Titan-Zylinderschraube mit Innensechskant M5 × 0,8</a></p>',
      ) &&
      />210,00\s€<\/span>/.test(germanCart),
    'the German cart page does not show the same cart in German and in euros',
  );

  // The header's way to the cart is on a public page, the same for everyone.
  expect(
    /<a class="cart-link" href="\/_mallok\/p\/shop\/cart">/.test(home.html),
    'the home page has no link to the cart',
  );

  // 6. The admin's side: a variant added to a product the way the form
  //    under its editor adds one, through Mallok's API, and taken away again.
  const records = `${base}/_mallok/api/plugins/shop/panels/variants/records`;
  const authorised = {
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
  };
  const created = await fetch(records, {
    method: 'POST',
    headers: authorised,
    body: JSON.stringify({
      // The cap screw's translation group, fixed in its `mallok.json`.
      attachedTo: '50b0633f-18e5-5dd3-8079-19659453e7c6',
      values: {
        sku: 'TI-SHC-M5-30',
        options: { length: '30 mm' },
        moq: 100,
        stock: 250,
        price: { amount: 265, currency: 'USD' },
        other_prices: [{ price: { amount: 250, currency: 'EUR' } }],
      },
    }),
    signal: timeout(),
  });
  const { id: variantId } = await created.json();
  expect(
    created.status === 201 && typeof variantId === 'string',
    `adding a variant through the admin's API returned ${created.status}`,
  );
  const stored = await query(
    `SELECT v.product_group, v.stock, p.currency, p.amount_minor, p.source
     FROM p_shop_variant AS v JOIN p_shop_price AS p ON p.variant_id = v.id
     WHERE v.sku = 'TI-SHC-M5-30' ORDER BY p.currency`,
  );
  expect(
    stored.length === 2 &&
      stored[0].currency === 'EUR' &&
      stored[0].source === 'manual' &&
      stored[1].currency === 'USD' &&
      stored[1].amount_minor === 265 &&
      stored[1].stock === 250,
    `the variant added through the admin's API was stored as ${JSON.stringify(stored)}`,
  );
  const taken = await fetch(records, {
    method: 'POST',
    headers: authorised,
    body: JSON.stringify({
      attachedTo: '50b0633f-18e5-5dd3-8079-19659453e7c6',
      values: { sku: 'TI-SHC-M5-30', moq: 1 },
    }),
    signal: timeout(),
  });
  expect(
    taken.status === 422 &&
      Object.keys((await taken.json()).errors ?? {}).join() === 'sku',
    `a second variant with the same SKU returned ${taken.status}`,
  );
  const removed = await fetch(`${records}/${variantId}`, {
    method: 'DELETE',
    headers: authorised,
    signal: timeout(),
  });
  const left = await query(
    "SELECT COUNT(*) AS n FROM p_shop_variant WHERE sku = 'TI-SHC-M5-30'",
  );
  expect(
    removed.ok && left[0].n === 0,
    `deleting the variant returned ${removed.status} and left ${left[0].n} behind`,
  );

  const lines = await query(
    'SELECT variant_id, quantity FROM p_shop_cart_line',
  );
  expect(
    lines.length === 1 && lines[0].quantity === 100,
    `the cart should hold one line of 100; it holds ${JSON.stringify(lines)}`,
  );

  // 7. The cart, sent as a request for a quote: through the form the cart
  //    page itself offers, in German, and read back the way the admin reads
  //    it. The cart was last shown in euros.
  const quoteForm =
    /<form class="quote-form" method="post" action="([^"]*)"/.exec(germanCart);
  expect(
    quoteForm !== null &&
      quoteForm[1] === '/_mallok/p/shop/de/cart/inquiry' &&
      germanCart.includes(
        '<h2 class="quote-form-title" id="quote-form-title">Diesen Warenkorb als Angebotsanfrage senden</h2>',
      ),
    'the German cart page offers no form to send the cart as a request for a quote',
  );
  const buyer = {
    name: 'Smoke Buyer',
    email: 'buyer@smoke.example',
    company: 'Smoke GmbH',
    phone: '',
    message: 'Bitte mit Lieferzeit.',
    website: '',
  };
  const sendInquiry = () =>
    submit({ action: quoteForm[1], fields: buyer }, {}, cartCookie);
  const sent = await sendInquiry();
  const sentTo = sent.headers.get('location') ?? '';
  const inquiries = await query(
    `SELECT i.id, i.inquiry_no, i.name, i.locale, i.currency, i.subtotal,
            l.sku, l.name AS product, l.quantity, l.unit_price
     FROM p_shop_inquiry AS i
     JOIN p_shop_inquiry_line AS l ON l.inquiry_id = i.id`,
  );
  expect(
    inquiries.length === 1 &&
      inquiries[0].name === 'Smoke Buyer' &&
      inquiries[0].locale === 'de' &&
      inquiries[0].currency === 'EUR' &&
      inquiries[0].sku === 'TI-SHC-M5-20' &&
      inquiries[0].product ===
        'Titan-Zylinderschraube mit Innensechskant M5 × 0,8' &&
      inquiries[0].quantity === 100 &&
      /^2,10\s€$/.test(inquiries[0].unit_price) &&
      /^210,00\s€$/.test(inquiries[0].subtotal),
    `the cart was stored as ${JSON.stringify(inquiries)}`,
  );
  const inquiry = inquiries[0];
  expect(
    sent.status === 303 &&
      sentTo === `/_mallok/p/shop/de/cart?sent=${inquiry.inquiry_no}`,
    `sending the cart returned ${sent.status} to ${sentTo}`,
  );
  const confirmation = await (
    await fetch(`${base}${sentTo}`, {
      headers: { cookie: cartCookie },
      signal: timeout(),
    })
  ).text();
  expect(
    confirmation.includes('<div class="cart-sent" role="status">') &&
      confirmation.includes(inquiry.inquiry_no) &&
      confirmation.includes('Ihre Anfrage wurde gesendet.') &&
      confirmation.includes('<p class="empty">Ihr Warenkorb ist leer.</p>') &&
      !confirmation.includes('Smoke Buyer'),
    'the cart page does not confirm the inquiry it was sent as, on an empty cart',
  );
  // Somebody else, following the same link, is told nothing: neither a
  // browser with no cart, nor one with a cart of its own.
  const strangers = await page(sentTo);
  const othersCart = (
    (await submit(form)).headers.get('set-cookie') ?? ''
  ).split(';')[0];
  const others = await (
    await fetch(`${base}${sentTo}`, {
      headers: { cookie: othersCart },
      signal: timeout(),
    })
  ).text();
  expect(
    strangers.status === 200 &&
      !strangers.html.includes('cart-sent') &&
      othersCart !== '' &&
      othersCart !== cartCookie &&
      !others.includes('cart-sent'),
    'the cart page confirms an inquiry to a browser that did not send it',
  );
  // The same form again — a button pressed twice — is the same inquiry.
  const again = await sendInquiry();
  const stillOne = await query('SELECT COUNT(*) AS n FROM p_shop_inquiry');
  expect(
    again.headers.get('location') === sentTo && stillOne[0].n === 1,
    `sending the same cart again returned ${again.headers.get('location')} and left ${stillOne[0].n} inquiries`,
  );
  const emptied = await query(
    `SELECT COUNT(*) AS n FROM p_shop_cart_line
     WHERE cart_id = '${cartCookie.split('=')[1]}'`,
  );
  expect(emptied[0].n === 0, 'the cart was not emptied into its inquiry');

  // The admin's side of it: the panel's list, and the lines of the row.
  const panel = `${base}/_mallok/api/plugins/shop/panels/inquiries`;
  const listed = await (
    await fetch(panel, { headers: authorised, signal: timeout() })
  ).json();
  const linesOf = await (
    await fetch(`${panel}/related/lines?parent=${inquiry.id}`, {
      headers: authorised,
      signal: timeout(),
    })
  ).json();
  expect(
    listed.rows?.length === 1 &&
      listed.rows[0].inquiry_no === inquiry.inquiry_no &&
      listed.rows[0].email === 'buyer@smoke.example' &&
      listed.rows[0].status === 'new' &&
      linesOf.rows?.length === 1 &&
      linesOf.rows[0].sku === 'TI-SHC-M5-20' &&
      linesOf.rows[0].quantity === 100,
    `the admin lists the inquiry as ${JSON.stringify(listed)} with ${JSON.stringify(linesOf)}`,
  );
  const exported = await fetch(`${panel}/actions/inquiry_export_csv`, {
    method: 'POST',
    headers: authorised,
    body: JSON.stringify({ ids: [] }),
    signal: timeout(),
  });
  const csv = await exported.text();
  expect(
    exported.ok &&
      (exported.headers.get('content-type') ?? '').startsWith('text/csv') &&
      csv.includes(`${inquiry.inquiry_no},`) &&
      csv.includes(',TI-SHC-M5-20,') &&
      csv.includes(',100,2.10,210.00,'),
    `exporting the inquiries returned ${exported.status}: ${csv.slice(0, 300)}`,
  );

  // 8. The site's export, which is what `mallok export` writes to disk:
  //    the shop's files are in it beside the content, and no plugin failed —
  //    Mallok refuses to call an export a backup otherwise. Both plugins
  //    export inquiries, each under a name of its own.
  const siteExport = await (
    await fetch(`${base}/_mallok/api/export`, {
      headers: authorised,
      signal: timeout(),
    })
  ).json();
  const exportedFile = (path) =>
    (siteExport.files ?? []).find((file) => file.path === path);
  const exportedRows = (path) => JSON.parse(exportedFile(path)?.text ?? 'null');
  expect(
    Array.isArray(siteExport.pluginExportFailures) &&
      siteExport.pluginExportFailures.length === 0,
    `the export reports a plugin that failed: ${JSON.stringify(siteExport.pluginExportFailures)}`,
  );
  expect(
    exportedFile('inquiries.csv') !== undefined &&
      exportedRows('shop/manifest.json')?.format === 1 &&
      exportedRows('shop/variants.json')?.length === 9 &&
      exportedRows('shop/variants.json').every(
        (variant) =>
          typeof variant.product_slug === 'string' &&
          variant.product_slug !== '',
      ) &&
      exportedRows('shop/prices.json')?.length === 27 &&
      exportedRows('shop/inquiries.json')?.length === 1 &&
      exportedRows('shop/inquiries.json')[0].inquiry_no ===
        inquiry.inquiry_no &&
      exportedRows('shop/inquiries.json')[0].cart_id === undefined &&
      exportedRows('shop/inquiry-lines.json')?.length === 1,
    `the export does not carry the shop as it is: ${JSON.stringify(exportedRows('shop/manifest.json'))}`,
  );

  process.stdout.write(
    `smoke:shop: ok (settings, publish, seed, every kind of page, ${followed} navigation links in ${site.locales.length} languages, ${shipped.length} theme files, cart, variants in the admin, a cart sent as an inquiry, the shop in the site's export) on ${base}\n`,
  );
} catch (error) {
  failure = error;
} finally {
  try {
    await worker.stop();
  } finally {
    await rm(state, { recursive: true, force: true });
  }
}

if (failure !== null) {
  process.stderr.write(`smoke:shop: FAILED — ${failure.message}\n`);
  process.exitCode = 1;
}
