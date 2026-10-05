# Nundar

**A shop plugin and a commerce theme for [Mallok](https://github.com/fobstack/mallok).** Built for cross-border sellers who want to rank for what buyers actually search — not fight for the head term everyone else is bidding on.

[![CI](https://github.com/fobstack/Nundar/actions/workflows/ci.yml/badge.svg)](https://github.com/fobstack/Nundar/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue)](LICENSE)

> **Status: in development.** Nundar is being rebuilt on Mallok. The catalogue side works today. Prices on pages, the cart page and checkout are not there yet — see [What works today](#what-works-today). It is not ready to run a real shop.

---

## The problem

If you manufacture something and want to sell it abroad, a product is usually treated as **one page**. That is the mistake. A buyer searching *"ball valve for offshore platform seawater lines"* is far closer to purchase than one searching *"ball valve"* — and almost nobody is competing for the first phrase.

## What Nundar does about it

**A product is a content system, not a page.**

| Content | Answers | Example search it can win |
|---|---|---|
| **Product** | What is it | `316L stainless ball valve DN50` |
| **Application note** | Where is it used, and why | `ball valve for offshore platform seawater lines` |
| **Collection** | Which products share this property | `corrosion-resistant valves` |

An application note is its own landing page, with its own URL, title and structured data, and **its own slug in each language**:

```
/applications/offshore-seawater-lines
/de/applications/offshore-seewasserleitungen
/fr/applications/circuits-eau-de-mer-offshore
/es/applications/lineas-agua-de-mar-offshore
```

Each links to the product it discusses, the product lists the notes written about it, and every language version points at the others with correct `hreflang`.

**Writing one is a deliberate act.** A product's features, and the applications that do not deserve a page of their own, stay inside the product page. A page per feature would only multiply near-identical pages across products, which drags a whole domain down. Attribute searches are served by collections instead: one page that gathers the products sharing a property, so a buyer can compare them.

## How it is built

Nundar is not a second application beside Mallok. A shop is a Mallok site with two things added:

| Part | Where | What it owns |
|---|---|---|
| **Shop plugin** | `src/plugins/shop/` | Variants, prices per currency, stock, minimum order quantities, the cart, exchange-rate repricing |
| **Commerce theme** | `src/theme/` | How product, application, collection and list pages look, in four languages |
| **Sample content** | `content/`, `seed/` | A product, its application note, a collection and a contact page |

Mallok provides everything else: content and its editor, languages and `hreflang`, the sitemap, the admin and sign-in, media, the edge cache, email. That boundary is deliberate — commerce logic lives only in the plugin, and nothing about pages is reimplemented here.

Everything runs on Cloudflare Workers with D1 and R2. Local development needs no Cloudflare account.

## What works today

Nundar builds on `mallok@0.1.0-rc.9`. Some of the shop needs extension points Mallok does not have yet; those parts wait for them rather than being worked around.

| | Works today | Waits for Mallok's next plugin API |
|---|---|---|
| **Pages** | Home, product, application, collection, list and contact pages in English, German, French and Spanish; `hreflang`, canonicals, sitemap; no client JavaScript | Prices, variants and availability on the page; `Offer` structured data |
| **Catalogue data** | Variants, prices as integer minor units, stock, MOQ, lead time, a made-to-order policy | Editing them in the admin (read-only for now; the sample data is loaded from SQL) |
| **Pricing** | USD base price; EUR and GBP derived from ECB rates with a buffer, rounding to a price point and a drift threshold; manual prices never overwritten | |
| **Cart** | Add, set and remove through a plain form POST, with MOQ and stock enforced server-side | The cart page; submitting a cart as one inquiry |
| **Orders and payment** | The logic, tested and not yet reachable: orders with line snapshots, a payment that takes stock exactly once however often Stripe reports it, oversold orders, refunds that return stock, Stripe signature checks, order emails in four languages | The checkout and order pages, the webhook route, and order handling in the admin |

The reasoning and the plan are in [`docs/superpowers/specs/2026-09-30-nundar-on-mallok-design.md`](docs/superpowers/specs/2026-09-30-nundar-on-mallok-design.md).

### Commerce rules that are easy to get wrong, and are tested

- Money is always integer minor units. Never a float, anywhere.
- The cart stores variants and quantities only — never a price.
- MOQ is enforced by the form *and* by the server, because a form can be bypassed.
- Stock carries a database constraint, so a payment's decrement cannot go negative: a test proves the whole D1 batch rolls back.
- Stock comes off when a payment is confirmed, never before, and once: tests deliver the same payment twice at the same moment.
- A payment is believed only with Stripe's signature on the exact bytes received, and only for five minutes.
- A manually set price is never overwritten by an exchange-rate refresh.
- Language is decided by the URL alone, never by the visitor's IP.

## Quick start

Requires Node.js 22 and npm. **No Cloudflare account needed.**

```bash
git clone https://github.com/fobstack/Nundar.git
cd Nundar
npm ci
npm run build        # stages the admin and the theme's assets
npm run smoke:shop   # the whole shop, end to end, on a throwaway local Worker
```

`smoke:shop` is the fastest way to see everything working together: it creates an administrator, applies `site.json`, publishes `content/` with the Mallok CLI, loads the sample variants, requests the pages in two languages and adds to the cart.

### A local shop you can browse

```bash
# First time only: local secrets. Never commit .dev.vars.
(umask 077; set -C; printf 'MALLOK_SECRET=%s\nMALLOK_SETUP_KEY=%s\n' \
  "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > .dev.vars)

npm run dev
```

1. Open the URL Wrangler prints, at `/_mallok/setup`, and enter the `MALLOK_SETUP_KEY` from `.dev.vars` to create the administrator.
2. In the admin, switch the **Shop** plugin on, and create an API token with the `content:write` and `settings:write` scopes.
3. With that token in your environment, apply `site.json`, publish the content and load the sample variants:

```bash
export MALLOK_TOKEN=<the token>
npx mallok publish . --with-settings --url http://localhost:8787
npm run seed:local
```

The site is at `/` (English), `/de/`, `/fr/` and `/es/`.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Local development server, with local D1 and R2 |
| `npm run build` | Stage assets, then a production build (a deploy dry run) |
| `npm test` | Project checks, then the plugin and theme tests inside the real Workers runtime |
| `npm run lint` / `npm run typecheck` | Lint and type checks |
| `npm run smoke` | A real request to a real local Worker |
| `npm run smoke:shop` | The whole shop on a real local Worker |
| `npm run seed:local` | Load the sample variants into the local database |

## Deploying

Not yet. A deployed shop today would show a catalogue with no prices and no cart page. When Nundar is ready, deployment is Mallok's own: `npx mallok create . --slug <slug>`, which creates the Worker, the D1 database and the R2 bucket on your own Cloudflare account. That path has not been run for this repository.

## Languages and currencies

| Language | URL | Default currency |
|---|---|---|
| English (default, carries `x-default`) | `/…` | USD |
| German | `/de/…` | EUR |
| French | `/fr/…` | EUR |
| Spanish | `/es/…` | EUR |

Currencies: USD (the base, priced by hand), EUR and GBP. Adding a language means adding it to `site.json` and to the theme's `locales/`, then translating content — no schema change, because every language version is its own content item.

## Design decisions

- [`docs/superpowers/specs/2026-09-30-nundar-on-mallok-design.md`](docs/superpowers/specs/2026-09-30-nundar-on-mallok-design.md) — how Nundar is built on Mallok, and why
- [`docs/superpowers/specs/2026-09-03-nundar-design.md`](docs/superpowers/specs/2026-09-03-nundar-design.md) — the original design; its commerce decisions still hold, its architecture is superseded
- [`docs/superpowers/plans/`](docs/superpowers/plans/) — phase plans, and what implementation uncovered

Read the specs before changing anything structural. If a change contradicts a recorded decision, update the spec in the same pull request and explain the new reasoning.

The previous implementation, a standalone Next.js application, is kept at the tag `nextjs-final`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Contributions require a signed [ICLA](CLA.md) — one line, with the reasoning explained rather than assumed.

## Security

Please do not open a public issue for a security problem. See [SECURITY.md](SECURITY.md).

## License

Dual-licensed under **MIT OR Apache-2.0**, at your option. Mallok, which Nundar depends on, is Apache-2.0.

## Translations

English is the authoritative version. Translations are provided for convenience and may lag behind it:

- [简体中文](README.zh-CN.md)

Corrections belong in the English version first.
