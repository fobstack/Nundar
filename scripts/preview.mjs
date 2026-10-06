/**
 * A local shop to look at, in one command.
 *
 * `npm run dev` starts an empty site: before a page shows anything, someone
 * has to create local secrets, an administrator and an API token, switch two
 * plugins on, publish the content and load the variants — in that order, and
 * before opening the site, or the pages opened early stay cached as they
 * were. That is right for a site that is going to be kept. It is a long way
 * round for someone who wants to see what Nundar is.
 *
 * This does all of it against a throwaway database and then stays up: the
 * sample catalogue in four languages, the admin, and a login for it printed
 * below. Nothing is kept. Stopping it removes the database, and the next run
 * starts clean.
 *
 *   npm run preview                    on port 8799
 *   npm run preview -- --port 8800     on another port
 *   npm run preview -- --check         bring it up, check it, take it down
 *
 * It brings the shop up through the same code as `npm run smoke:shop`, which
 * is what checks that shop page by page. `--check` is for CI: it proves this
 * command itself still ends with a site and a login that work.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  expect,
  fillShop,
  freePort,
  portInUse,
  startWorker,
  timeout,
} from './lib/local-shop.mjs';

const { values } = parseArgs({
  options: {
    port: { type: 'string' },
    check: { type: 'boolean', default: false },
  },
});
// A person wants an address they can come back to; a check wants whatever
// port is free, so that it can run beside a preview someone has open.
const port =
  values.port === undefined
    ? values.check
      ? await freePort()
      : 8799
    : Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  process.stderr.write(`preview: "${values.port}" is not a port number.\n`);
  process.exit(1);
}
if (await portInUse(port)) {
  process.stderr.write(
    `preview: port ${port} is in use. If a preview is already running, that is it: open http://127.0.0.1:${port}\n` +
      `         Otherwise pick another port: npm run preview -- --port ${port + 1}\n`,
  );
  process.exit(1);
}

const say = (line) => process.stdout.write(`${line}\n`);
const state = await mkdtemp(join(tmpdir(), 'nundar-preview-'));
const worker = startWorker({ port, state });
const { base } = worker;

let stopping = false;
async function shutDown() {
  if (stopping) return;
  stopping = true;
  try {
    await worker.stop();
  } finally {
    await rm(state, { recursive: true, force: true });
  }
}

// Ctrl+C, or the terminal closing: take the Worker and the database with us.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    shutDown().finally(() => process.exit(0));
  });
}

/** Text as a template prints it. */
function escaped(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** What `--check` asks of the shop before calling this command sound. */
async function check(login) {
  const site = JSON.parse(await readFile('site.json', 'utf8'));
  const page = async (path) => {
    const response = await fetch(`${base}${path}`, { signal: timeout() });
    return { status: response.status, html: await response.text() };
  };

  const home = await page('/');
  expect(home.status === 200, `the home page returned ${home.status}`);
  // The settings were applied and the page is not one cached before they
  // were: it carries this site's name and headline, not the theme's defaults.
  expect(
    home.html.includes(`>${escaped(site.name)}</a>`),
    'the home page does not carry the name in site.json',
  );
  expect(
    home.html.includes(escaped(site.themeOptions.hero_title)),
    'the home page does not carry the headline in site.json',
  );
  expect(
    (home.html.match(/<tr role="row">/g) ?? []).length > 1,
    'the home page lists no products',
  );
  for (const locale of site.locales) {
    if (locale === site.defaultLocale) continue;
    const translated = await page(`/${locale}/`);
    expect(
      translated.status === 200 &&
        translated.html.includes(
          escaped(site.themeOptions.$locales[locale].hero_title),
        ),
      `/${locale}/ does not carry that language's headline`,
    );
  }

  const admin = await page('/_mallok/app/');
  expect(admin.status === 200, `the admin returned ${admin.status}`);
  const session = await fetch(`${base}/_mallok/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: login.email, password: login.password }),
    signal: timeout(),
  });
  expect(
    session.ok,
    `the login this command prints was refused with ${session.status}`,
  );
}

try {
  say(`Starting a throwaway shop on ${base} (about a minute)…`);
  await worker.ready();
  const login = await fillShop({
    base,
    state,
    tokenName: 'preview',
    step: (what) => say(`  ${what}…`),
  });

  if (values.check) {
    await check(login);
    await shutDown();
    say(`preview: ok (a filled shop and a working admin login) on ${base}`);
    process.exit(0);
  }

  say(`
The preview is ready.

  Shop      ${base}
            ${base}/de/   ${base}/fr/   ${base}/es/
  Admin     ${base}/_mallok/app
  Email     ${login.email}
  Password  ${login.password}

Nothing here is kept: the database is in a temporary directory and goes when
this stops. The login above is for this run only. Press Ctrl+C to stop.
`);

  // Stay up until stopped — or until the Worker goes down on its own, which
  // is worth saying out loud rather than leaving a dead address behind.
  await worker.stopped;
  if (!stopping) {
    process.stderr.write(
      `preview: the Worker stopped unexpectedly.\n${worker.output().slice(-2000)}\n`,
    );
    await shutDown();
    process.exit(1);
  }
} catch (error) {
  const details = stopping ? '' : `\n${worker.output().slice(-2000)}`;
  await shutDown();
  process.stderr.write(`preview: FAILED — ${error.message}${details}\n`);
  process.exit(1);
}
