/**
 * The shop, end to end, against a real Worker.
 *
 * `npm run smoke` proves the Worker boots. This goes on to do what an operator
 * and then a buyer would do, in a throwaway local environment:
 *
 *   1. create the administrator and apply `site.json`;
 *   2. publish `content/` with the Mallok CLI;
 *   3. load the sample variants from `seed/shop-sample.sql`;
 *   4. request the product, application and collection pages in two languages;
 *   5. add to the cart through the same form POST a product page sends.
 *
 * It exists because the unit tests, thorough as they are, run each piece in
 * isolation. This is the one place the theme, the plugin, the content and the
 * CLI are seen working together the way a deployed shop works.
 *
 * Like `smoke`, it is separate from `test`: it needs a workerd process and a
 * free port.
 */

import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** An OS-assigned free port, so two runs cannot collide. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function expect(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const wrangler = join(process.cwd(), 'node_modules/wrangler/bin/wrangler.js');
const mallok = join(process.cwd(), 'node_modules/.bin/mallok');

const port = await freePort();
// Throwaway state, so a run never sees yesterday's database.
const state = await mkdtemp(join(tmpdir(), 'nundar-smoke-'));
const processGroup = process.platform !== 'win32';

const child = spawn(
  process.execPath,
  [
    wrangler,
    'dev',
    '--local',
    '--port',
    String(port),
    '--persist-to',
    state,
    // Passed on the command line rather than read from `.dev.vars`, so the
    // run does not depend on, or disturb, a developer's own local secrets.
    '--var',
    `MALLOK_SECRET:${randomBytes(32).toString('base64')}`,
    // Lets this script create the administrator without a one-time setup
    // key. A deployed site never has this.
    '--var',
    'MALLOK_DEV_ALLOW_SETUP_WITHOUT_KEY:true',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'], detached: processGroup },
);
let launchError = null;
child.on('error', (error) => {
  launchError = error;
});
const closed = new Promise((resolve) => child.once('close', resolve));

async function stop() {
  if (child.pid === undefined) return;
  if (!processGroup) {
    if (child.exitCode === null) {
      await run('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    }
  } else {
    const signal = (name) => {
      try {
        process.kill(-child.pid, name);
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    };
    // Killing only the launcher leaves inherited pipes open in descendants.
    signal('SIGTERM');
    const force = setTimeout(() => signal('SIGKILL'), 2_000);
    try {
      await closed;
    } finally {
      clearTimeout(force);
    }
  }
  await closed;
}

let output = '';
child.stdout.on('data', (chunk) => {
  output += chunk;
});
child.stderr.on('data', (chunk) => {
  output += chunk;
});

const base = `http://127.0.0.1:${port}`;
const deadline = Date.now() + 120_000;
const timeout = () => AbortSignal.timeout(15_000);
let failure = null;

async function waitForWorker() {
  for (;;) {
    if (launchError !== null) throw launchError;
    if (child.exitCode !== null) {
      throw new Error(`wrangler dev exited with ${child.exitCode}\n${output}`);
    }
    if (Date.now() > deadline) {
      throw new Error(`wrangler dev did not start in time\n${output}`);
    }
    try {
      const probe = await fetch(`${base}/_mallok/api/setup/status`, {
        signal: timeout(),
      });
      if (probe.ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((done) => setTimeout(done, 500));
  }
}

async function page(path) {
  const response = await fetch(`${base}${path}`, { signal: timeout() });
  return { status: response.status, html: await response.text() };
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
async function query(sql) {
  const { stdout } = await run(process.execPath, [
    wrangler,
    'd1',
    'execute',
    'DB',
    '--local',
    '--persist-to',
    state,
    '--json',
    '--command',
    sql,
  ]);
  return JSON.parse(stdout)[0].results;
}

try {
  await waitForWorker();

  // 1. The administrator, a token, the site's settings, the plugin.
  const email = 'owner@example.test';
  const password = randomBytes(18).toString('base64');
  const json = { 'content-type': 'application/json' };

  const bootstrap = await fetch(`${base}/_mallok/api/auth/bootstrap`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ email, password }),
    signal: timeout(),
  });
  expect(bootstrap.ok, `bootstrap returned ${bootstrap.status}`);

  const session = await fetch(`${base}/_mallok/api/auth/login`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ email, password }),
    signal: timeout(),
  });
  expect(session.ok, `login returned ${session.status}`);
  const sessionCookie = (session.headers.get('set-cookie') ?? '').split(';')[0];
  const { csrf } = await session.json();

  const minted = await fetch(`${base}/_mallok/api/tokens`, {
    method: 'POST',
    headers: { ...json, cookie: sessionCookie, 'x-mallok-csrf': csrf },
    body: JSON.stringify({
      name: 'smoke-shop',
      scopes: ['content:write', 'settings:write'],
    }),
    signal: timeout(),
  });
  expect(minted.ok, `minting a token returned ${minted.status}`);
  const { token } = await minted.json();
  const authorised = { ...json, authorization: `Bearer ${token}` };

  // The same script the README gives an operator. The token travels in the
  // environment, as it would for them.
  const operator = { env: { ...process.env, MALLOK_TOKEN: token } };
  await run(
    process.execPath,
    [join(process.cwd(), 'scripts/apply-settings.mjs'), base],
    operator,
  );

  const enabled = await fetch(`${base}/_mallok/api/plugins/shop/enabled`, {
    method: 'POST',
    headers: authorised,
    body: JSON.stringify({ enabled: true }),
    signal: timeout(),
  });
  expect(enabled.ok, `enabling the shop plugin returned ${enabled.status}`);

  // 2. The sample content, through the same CLI an operator uses.
  await run(mallok, ['publish', './content', '--url', base], operator);

  // 3. The sample variants. The plugin's tables exist by now: Mallok created
  //    them on the first request.
  await run(process.execPath, [
    wrangler,
    'd1',
    'execute',
    'DB',
    '--local',
    '--persist-to',
    state,
    '--file',
    'seed/shop-sample.sql',
  ]);

  const variants = await query(
    `SELECT v.sku FROM p_shop_variant AS v
     JOIN content AS c ON c.translation_group = v.product_group
     WHERE c.locale = 'en' ORDER BY v.sku`,
  );
  expect(
    variants.length === 2,
    `the sample variants should attach to the published product; ${variants.length} did`,
  );

  // Every language of one bundle has to land in one translation group, or
  // hreflang cannot connect them. The product pins its group in mallok.json;
  // the other bundles have theirs assigned on import, so check one of those.
  const groups = await query(
    `SELECT COUNT(DISTINCT translation_group) AS n, COUNT(*) AS rows
     FROM content WHERE kind = 'application'`,
  );
  expect(
    groups[0].n === 1 && groups[0].rows === 4,
    `the application note should be four languages in one translation group; found ${JSON.stringify(groups[0])}`,
  );

  // 4. The pages a buyer and a crawler receive.
  const product = await page('/products/stainless-ball-valve-dn50');
  expect(product.status === 200, `the product page returned ${product.status}`);
  expect(
    product.html.includes('Stainless Steel Ball Valve DN50'),
    'the product page does not show the product',
  );
  expect(
    product.html.includes('href="/applications/offshore-seawater-lines"'),
    'the product page does not link to its application note',
  );
  expect(
    product.html.includes('hreflang="x-default"'),
    'the product page carries no hreflang',
  );

  const german = await page('/de/products/edelstahl-kugelhahn-dn50');
  expect(
    german.status === 200,
    `the German product page returned ${german.status}`,
  );
  expect(
    german.html.includes('href="/de/applications/offshore-seewasserleitungen"'),
    'the German product page does not link to the German application note',
  );
  expect(
    german.html.includes('href="/de/kontakt"'),
    'the German page does not link to the German contact page',
  );

  const application = await page('/applications/offshore-seawater-lines');
  expect(
    application.status === 200 &&
      application.html.includes('href="/products/stainless-ball-valve-dn50"'),
    'the application note does not link back to its product',
  );
  expect(
    application.html.includes('/es/applications/lineas-agua-de-mar-offshore'),
    'the application note carries no hreflang to its Spanish version',
  );

  const collection = await page('/collections/corrosion-resistant-valves');
  expect(
    collection.status === 200 &&
      collection.html.includes('href="/products/stainless-ball-valve-dn50"'),
    'the collection page does not list its product',
  );

  const stylesheet = await fetch(`${base}/theme/nundar/0.1.0/style.css`, {
    signal: timeout(),
  });
  expect(
    stylesheet.ok &&
      (stylesheet.headers.get('content-type') ?? '').includes('text/css'),
    `the theme stylesheet returned ${stylesheet.status} — run \`npm run build\` first`,
  );

  // 5. The cart, through the form POST a product page sends.
  const refused = await addToCart({
    variant: 'sample-dn50-npt',
    quantity: '3',
  });
  expect(
    refused.status === 422,
    `a quantity below the MOQ returned ${refused.status}, not 422`,
  );

  const added = await addToCart({
    variant: 'sample-dn50-npt',
    quantity: '10',
    return: '/products/stainless-ball-valve-dn50',
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
    lines.length === 1 && lines[0].quantity === 10,
    `the cart should hold one line of 10; it holds ${JSON.stringify(lines)}`,
  );

  process.stdout.write(
    `smoke:shop: ok (settings, publish, seed, pages in two languages, cart) on ${base}\n`,
  );
} catch (error) {
  failure = error;
} finally {
  try {
    await stop();
  } finally {
    await rm(state, { recursive: true, force: true });
  }
}

if (failure !== null) {
  process.stderr.write(`smoke:shop: FAILED — ${failure.message}\n`);
  process.exitCode = 1;
}
