/**
 * A throwaway local shop: a real Worker on a port, with an administrator, the
 * plugins switched on, the sample published and its variants loaded.
 *
 * Two things need one. The end-to-end smoke run brings it up and then checks
 * it; `npm run preview` brings it up and leaves it running for a person to
 * look at. Both come through here, so that what the preview shows is what the
 * smoke run proved, and there is one place that knows the order things have
 * to happen in.
 */

import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

const wrangler = join(process.cwd(), 'node_modules/wrangler/bin/wrangler.js');
const mallok = join(process.cwd(), 'node_modules/.bin/mallok');

/** How long one request to the local Worker may take. */
export const timeout = () => AbortSignal.timeout(15_000);

export function expect(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/** Text as a template prints it. */
export function escaped(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** An OS-assigned free port, so two runs cannot collide. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** Whether something is already listening on a local port. */
export function portInUse(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(true));
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(false));
    });
  });
}

/**
 * Starts `wrangler dev` on `port`, keeping its database, its files and its
 * cache under `state`.
 *
 * `ready` resolves once the Worker answers. `stopped` resolves if it exits on
 * its own. `stop` ends it and everything it started.
 */
export function startWorker({ port, state }) {
  const processGroup = process.platform !== 'win32';
  const base = `http://127.0.0.1:${port}`;

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
      // Lets a script create the administrator without a one-time setup
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

  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });

  async function ready() {
    const deadline = Date.now() + 120_000;
    for (;;) {
      if (launchError !== null) throw launchError;
      if (child.exitCode !== null) {
        throw new Error(
          `wrangler dev exited with ${child.exitCode}\n${output}`,
        );
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

  return { base, ready, stop, stopped: closed, output: () => output };
}

/**
 * Turns a Worker that has just started into a shop with the sample in it.
 *
 * Nothing may request a page before this has finished: no purge reaches the
 * local edge cache, so a page rendered while the site was empty, or while a
 * plugin was off, would stay as it was for an hour.
 *
 * `step` is told what is about to happen, for a caller that shows progress.
 * Returns the administrator's login and the API token.
 */
export async function fillShop({ base, state, tokenName, step = () => {} }) {
  const json = { 'content-type': 'application/json' };

  // 1. The administrator, a token, the plugins.
  step('Creating the administrator');
  const email = 'owner@example.test';
  const password = randomBytes(18).toString('base64url');

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
      name: tokenName,
      // `media:write` because the sample bundles carry images, and publishing
      // a bundle uploads them.
      scopes: ['content:write', 'settings:write', 'media:write'],
    }),
    signal: timeout(),
  });
  expect(minted.ok, `minting a token returned ${minted.status}`);
  const { token } = await minted.json();
  const authorised = { ...json, authorization: `Bearer ${token}` };

  // The shop, and the inquiry form the contact pages ask for with
  // `[[inquiry]]`.
  step('Switching the shop and inquiry plugins on');
  for (const plugin of ['shop', 'inquiry']) {
    const enabled = await fetch(
      `${base}/_mallok/api/plugins/${plugin}/enabled`,
      {
        method: 'POST',
        headers: authorised,
        body: JSON.stringify({ enabled: true }),
        signal: timeout(),
      },
    );
    expect(
      enabled.ok,
      `enabling the ${plugin} plugin returned ${enabled.status}`,
    );
  }

  // 2. The site's settings and the sample content, with the one command the
  //    README gives an operator. `site.json` and `content/` in this directory
  //    are Mallok's export layout, so it applies the first and publishes the
  //    second. The token travels in the environment, as it would for an
  //    operator.
  step('Publishing the sample catalogue and its images');
  await run(mallok, ['publish', '.', '--with-settings', '--url', base], {
    env: { ...process.env, MALLOK_TOKEN: token },
  });

  // 3. The sample variants. The plugin's tables exist by now: Mallok created
  //    them on the first request.
  step('Loading the sample variants');
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

  return { email, password, token };
}

/** Runs a query against the local D1 under `state` and returns its rows. */
export async function query(state, sql) {
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
