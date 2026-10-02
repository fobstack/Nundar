/**
 * Applies `site.json` to a running site.
 *
 *   MALLOK_TOKEN=<token> node scripts/apply-settings.mjs http://localhost:8787
 *
 * It sets the site's name, languages, content kinds, navigation and theme
 * options, which is what has to be in place before `mallok publish ./content`
 * can file the shop's kinds anywhere.
 *
 * Mallok's own `mallok publish . --with-settings` is not usable in this
 * repository: it scans every file under the directory it is given, so from
 * the repository root it picks up the sample page inside
 * `node_modules/mallok/template`, and it decides which kinds exist before the
 * settings it was asked to apply have taken effect.
 *
 * The token is read from the environment and never from an argument: command
 * line arguments show up in `ps` and in shell history.
 */

import { readFile } from 'node:fs/promises';

const origin = process.argv[2];
const token = process.env.MALLOK_TOKEN;

if (origin === undefined || !/^https?:\/\//.test(origin)) {
  process.stderr.write(
    'Usage: MALLOK_TOKEN=<token> node scripts/apply-settings.mjs <site-origin>\n',
  );
  process.exit(2);
}
if (token === undefined || token === '') {
  process.stderr.write(
    'MALLOK_TOKEN is not set. Create a token with the settings:write scope in the admin.\n',
  );
  process.exit(2);
}

const site = JSON.parse(await readFile('site.json', 'utf8'));

const response = await fetch(
  `${origin.replace(/\/+$/, '')}/_mallok/api/settings`,
  {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: site.name,
      tagline: site.tagline,
      locales: site.locales,
      kinds: site.kinds,
      nav: site.nav,
      themeOptions: site.themeOptions,
    }),
    signal: AbortSignal.timeout(30_000),
  },
);

if (!response.ok) {
  process.stderr.write(
    `The site refused the settings (${response.status}): ${await response.text()}\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `Applied site.json: ${site.locales.length} languages, ${Object.keys(site.kinds).length} kinds.\n`,
);
