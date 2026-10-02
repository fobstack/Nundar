# Contributing to Nundar

Thanks for taking the time to contribute.

## Getting set up

```bash
npm ci
npm run build        # stages the admin and the theme's assets
npm run smoke:shop   # the whole shop on a throwaway local Worker
```

No Cloudflare account is needed for local development: D1 and R2 are simulated
locally. The README has the steps for a local shop you can browse.

**npm, not pnpm or yarn.** Nundar is a Mallok site, and Mallok's CLI installs
and upgrades with npm only; it refuses a project that carries another
manager's lockfile.

**Adding a dependency needs npm 11.** npm 10.9.7, which ships with Node 22,
fails while adding some packages to this tree
(`Cannot read properties of null (reading 'edgesOut')`). Use
`npx npm@11 install <package>`. `npm ci` works with either version.

## Before you open a pull request

```bash
npm run lint
npm run typecheck
npm test             # project checks, then tests inside the real Workers runtime
npm run smoke:shop   # when you touched the plugin, the theme or the content
```

All must pass. New logic needs matching tests, and a test for a fix has to be
seen failing without the fix.

## Where things go

| Change | Place |
|---|---|
| Prices, stock, the cart, anything about buying | The shop plugin, `src/plugins/shop/` |
| How a page looks, interface strings | The commerce theme, `src/theme/` |
| Pages, content, languages, the admin, caching in general | Not here: that is [Mallok](https://github.com/fobstack/mallok) |

If a change needs something Mallok does not offer, the answer is an extension
point in Mallok, not a workaround here.

## Design decisions live in `docs/`

Before changing anything structural, read
`docs/superpowers/specs/2026-09-30-nundar-on-mallok-design.md`. It records not
just what the system does but **why**. The commerce decisions in the original
spec, `2026-09-03-nundar-design.md`, still hold.

If your change contradicts a decision recorded there, update the spec in the
same pull request and explain the new reasoning.

## Conventions worth knowing

| Area | Rule |
|---|---|
| Money | Always integer minor units (`amount_minor`). Never floats. |
| Prices | Never accepted from a client. The cart stores variants and quantities only. |
| MOQ | Enforced by the form and again by the server. A form can be bypassed. |
| Stock | Protected by `CHECK (stock >= 0)`. A decrement that would oversell fails, and rolls back the whole D1 batch it is part of — keep it that way rather than relying on `WHERE stock >= qty`, which matches no row without failing. |
| Manual prices | Never overwritten by an exchange-rate refresh. |
| Language | Decided by the URL alone. Never redirect or switch by IP — crawlers would see one language. |
| References | A `reference` field names the target's slug **in the same language**. `test/content.test.ts` checks the sample content. |
| Multilingual bundles | Every bundle with more than one language carries a `mallok.json`. Without it the Mallok CLI publishes each language as a separate translation group. |
| Database access | Raw SQL through D1, no ORM. Batch reads and writes: a tick of the cron shares one invocation's CPU budget with every other plugin. |
| Migrations | Additive only, idempotent, and a comment has a line to itself — Mallok's migrator drops whole-line comments and then splits on semicolons. |
| Theme | No `<script>`, no inline event handlers. Anything interactive is declared in `theme.json`'s `clientScripts`. |
| Secrets | Never in the repository. `.dev.vars` locally, Worker secrets when deployed. |
| Dependencies | Ask whether the platform or Mallok already provides it. Every dependency is inherited attack surface. |

## Contributor licensing — read this before your first PR

Nundar is dual-licensed `MIT OR Apache-2.0`, and contributions require a signed
[ICLA](CLA.md).

**Why a CLA rather than just a DCO.** A DCO certifies you had the right to
submit your code, but you keep the copyright. That means the project cannot be
relicensed, combined into a larger work, or transferred without contacting every
past contributor individually — which is effectively impossible once a project
has more than a handful. The CLA grants a sublicensable license so those options
stay open.

We are being upfront that this is a real cost: CLAs deter some contributors. It
is a deliberate trade.

**Signing takes one line.** In the same pull request as your first contribution,
add yourself to `CONTRIBUTORS.md`:

```
Full Name <email@example.com> — signed Nundar ICLA, YYYY-MM-DD
```

Contributing on behalf of an employer? Your employer needs a Corporate CLA
first — open an issue titled "CCLA request".

## Security

Never open a public issue for a security problem. See [SECURITY.md](SECURITY.md).

## Commit messages

Conventional Commits, one concern per commit:

```
feat: add bulk price import to the shop plugin
fix: stop the cart from pricing archived variants
docs: explain how references resolve per language
```

## Adding a language

1. Add the locale to `site.json` (`locales`, and a `nav` entry).
2. Add `src/theme/locales/<locale>.json` and list the locale in
   `src/theme/theme.json`.
3. Translate content: add `index.<locale>.md` to each bundle, give it its own
   `slug`, and add the language to the bundle's `mallok.json`.

No schema change is needed: every language version is its own content item.
