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
 *   5. add to the cart through the same form POST a product page sends.
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
  return { status: response.status, html: await response.text() };
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

function addToCart(fields, cookie) {
  return fetch(`${base}/_mallok/p/shop/cart`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(cookie === undefined ? {} : { cookie }),
    },
    body: new URLSearchParams(fields).toString(),
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
  await fillShop({ base, state, tokenName: 'smoke-shop' });

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
    product.html.includes('<td>TI-SHC-M5-20</td>'),
    'the product page does not list the SKU of a size it offers',
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
  for (const path of ['/contact', '/fr/contact']) {
    const contact = await page(path);
    expect(
      contact.status === 200 &&
        contact.html.includes('<form class="mallok-inquiry"') &&
        !contact.html.includes('[[inquiry]]'),
      `${path} does not carry the inquiry form`,
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

  // 5. The cart, through the form POST a product page sends. The 20 mm
  //    screw is sold in hundreds.
  const refused = await addToCart({
    variant: 'sample-ti-shc-m5-20',
    quantity: '3',
  });
  expect(
    refused.status === 422,
    `a quantity below the MOQ returned ${refused.status}, not 422`,
  );

  const added = await addToCart({
    variant: 'sample-ti-shc-m5-20',
    quantity: '100',
    return: capScrew,
  });
  expect(added.status === 303, `add to cart returned ${added.status}`);
  expect(
    (added.headers.get('set-cookie') ?? '').includes('Path=/_mallok/p/shop'),
    'the cart cookie is not scoped to the plugin path',
  );

  const lines = await query(
    'SELECT variant_id, quantity FROM p_shop_cart_line',
  );
  expect(
    lines.length === 1 && lines[0].quantity === 100,
    `the cart should hold one line of 100; it holds ${JSON.stringify(lines)}`,
  );

  process.stdout.write(
    `smoke:shop: ok (settings, publish, seed, every kind of page, ${followed} navigation links in ${site.locales.length} languages, ${shipped.length} theme files, cart) on ${base}\n`,
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
