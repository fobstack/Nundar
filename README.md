# Nundar

**A shop plugin and a commerce theme for [Mallok](https://github.com/fobstack/mallok).** Built for cross-border sellers who want to rank for what buyers actually search — not fight for the head term everyone else is bidding on.

[![CI](https://github.com/fobstack/Nundar/actions/workflows/ci.yml/badge.svg)](https://github.com/fobstack/Nundar/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue)](LICENSE)

> **Status: in development.** Nundar is being rebuilt on Mallok. The catalogue side works today. Prices and a cart are on the pages; checkout is not there yet — see [What works today](#what-works-today). It is not ready to run a real shop.

---

## The problem

If you manufacture something and want to sell it abroad, a product is usually treated as **one page**. That is the mistake. A buyer searching *"titanium screws for semiconductor vacuum chambers"* is far closer to purchase than one searching *"titanium screw"* — and almost nobody is competing for the first phrase.

## What Nundar does about it

**A product is a content system, not a page.**

| Content | Answers | Example search it can win |
|---|---|---|
| **Product** | What is it | `M5 titanium socket head cap screw` |
| **Application page** | Where is it used, and why | `titanium screws for semiconductor vacuum chambers` |
| **Collection** | Which products share this property | `titanium countersunk screws` |

An application page is its own landing page, with its own URL, title and structured data, and **its own slug in each language**. The sample catalogue writes one per industry:

```
/industries/semiconductor-vacuum
/de/industries/halbleiter-und-ultrahochvakuum
/fr/industries/semi-conducteurs-et-ultravide
/es/industries/semiconductores-y-ultra-alto-vacio
```

Each links to the product it discusses, the product lists the pages written about it, and every language version points at the others with correct `hreflang`. A case study does the same for a piece of work that was delivered.

**Writing one is a deliberate act.** A product's features, and the applications that do not deserve a page of their own, stay inside the product page. A page per feature would only multiply near-identical pages across products, which drags a whole domain down. Attribute searches are served by collections instead: one page that gathers the products sharing a property, so a buyer can compare them. For the same reason a product is one page with its sizes listed on it, not a page per size.

## How it is built

Nundar is not a second application beside Mallok. A shop is a Mallok site with two things added:

| Part | Where | What it owns |
|---|---|---|
| **Shop plugin** | `src/plugins/shop/` | Variants, prices per currency, stock, minimum order quantities, the cart, exchange-rate repricing |
| **Commerce theme** | `src/theme/` | How the home page, the specification finder and the product, application, collection, case study, question and reference pages look, in four languages |
| **Sample content** | `content/`, `seed/`, `site.json` | A titanium fastener catalogue in four languages: six products in five collections, five industry pages, four case studies, questions and answers, reference pages, and the site's own copy |

Mallok provides everything else: content and its editor, languages and `hreflang`, the sitemap, the admin and sign-in, media, the edge cache, email. That boundary is deliberate — commerce logic lives only in the plugin, and nothing about pages is reimplemented here.

Everything runs on Cloudflare Workers with D1 and R2. Local development needs no Cloudflare account.

## What works today

Nundar builds on `mallok@0.1.0-rc.11`, the first release with the plugin API the rest of the shop needs. The right-hand column is what has not been built on it yet.

| | Works today | Not built yet |
|---|---|---|
| **Pages** | A home page with a specification finder; product pages with their sizes and SKUs, and for each size its price, minimum order, availability and lead time, read from the shop while the page is rendered and cached with it; the same offers in the page's `Product` structured data; a starting price under each product in the finder and the catalogue; collection, industry, case study, question, engineering reference and contact pages — all in English, German, French and Spanish, with `hreflang`, canonicals, sitemap and FAQ structured data; self-hosted fonts; prices in US dollars on English pages and in euros on the others, with a switch to any currency the shop prices in; no client JavaScript except three small scripts, each added to a page that is complete without it: filters for the finder, the currency switch, and calculators on the engineering reference page | Prices beside the products a collection page lists (Mallok does not yet tell a plugin which products a content page shows) |
| **Catalogue data** | Variants, prices as integer minor units, stock, MOQ, lead time, a made-to-order policy — edited in the admin, in a form under each product's editor; every change of stock goes into a ledger; a deleted product takes its variants with it | |
| **Pricing** | USD base price; EUR and GBP derived from ECB rates with a buffer, rounding to a price point and a drift threshold; manual prices never overwritten; the pages of a product are purged from the cache when one of its prices moves | |
| **Cart** | A form beside each size on a product page, and a cart page in the site's own design and language: set a quantity, remove a line, choose a currency. No script anywhere in it. MOQ and stock are enforced by the server, which says what it refused on the cart page | Submitting a cart as one inquiry; checkout |
| **Orders and payment** | The logic, tested and not yet reachable: orders with line snapshots, a payment that takes stock exactly once however often Stripe reports it, oversold orders, refunds that return stock, Stripe signature checks, order emails in four languages | The checkout and order pages, the webhook route, and order handling in the admin |

The reasoning and the plan are in [`docs/superpowers/specs/2026-09-30-nundar-on-mallok-design.md`](docs/superpowers/specs/2026-09-30-nundar-on-mallok-design.md).

### Commerce rules that are easy to get wrong, and are tested

- Money is always integer minor units. Never a float, anywhere.
- A page says whether a size can be had, never how many are left: a count would be wrong after the next sale, a state rarely is.
- The structured data offers exactly the prices the page prints. A test compares the two digit for digit.
- The cart stores variants and quantities only — never a price.
- MOQ is enforced by the form *and* by the server, because a form can be bypassed.
- A public page is the same for every visitor and stays in the cache: nothing about a cart is in it, and the cart's cookie is sent only to the shop's own routes.
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
npm run preview
```

In about a minute `preview` prints the address of a local shop with the sample catalogue in four languages, the address of its admin, and a login for it. Everything is set up for you: an administrator, the two plugins, the settings, the content with its images, the variants.

It is a throwaway. The database lives in a temporary directory and goes when you stop the command with Ctrl+C; the next run starts clean, with a new login. Use `npm run preview -- --port 8800` if port 8799 is taken.

To see the same shop checked rather than shown — every kind of page, every navigation link in every language, the cart — run `npm run smoke:shop`.

### A local site that keeps its data

`npm run dev` starts an empty site whose database stays in `.wrangler/` between runs. Filling it takes the steps `preview` does for you, and their order matters:

```bash
# First time only: local secrets. Never commit .dev.vars.
(umask 077; set -C; printf 'MALLOK_SECRET=%s\nMALLOK_SETUP_KEY=%s\n' \
  "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > .dev.vars)

npm run dev
```

1. Open the URL Wrangler prints **at `/_mallok/setup`**, not at `/`, and enter the `MALLOK_SETUP_KEY` from `.dev.vars` to create the administrator. If the page says the site has no setup key, `.dev.vars` is missing that line.
2. In the admin, at `/_mallok/app`, switch the **Shop** and **Inquiry** plugins on, and create an API token with the `content:write`, `settings:write` and `media:write` scopes. `media:write` is for the images the sample bundles carry.
3. With that token in your environment, apply `site.json`, publish the content and load the sample variants:

```bash
read -s "MALLOK_TOKEN?Paste the token: " && export MALLOK_TOKEN   # zsh; in bash: read -s -p "Paste the token: " MALLOK_TOKEN && export MALLOK_TOKEN
npx mallok publish . --with-settings --url http://localhost:8787
npm run seed:local
```

The site is at `/` (English), `/de/`, `/fr/` and `/es/`.

**Only now open the site.** Locally nothing clears the page cache: a page opened while the site was empty, or while a plugin was off, is served as it was for an hour, and restarting does not change that. If it happens, stop the server, delete `.wrangler/state/v3/cache`, and start it again; the database and the uploaded files are in the directories beside it and are not touched.

### The sample catalogue

The sample is a supplier of titanium fasteners that does not exist. Its products, figures, certifications and case studies are illustrative, and its footer says so. It is there to show what the theme does with real-looking content, and to be replaced:

- **Content** is in `content/`, one directory per page, with a Markdown file per language. Replace it with your own and publish.
- **The site's own copy** — the name, the navigation, the home page's headline and sections, the footer — is in `site.json`. Each language has its own values there; none of it is fixed in the theme.
- **Variants and prices** are in `seed/shop-sample.sql`, one variant for each SKU a product page lists, each with a US dollar base price and a euro and a sterling price entered by hand. Leave a currency out and the shop derives its price from the base price and the day's exchange rate.
- **Fonts** are served from the site itself (`src/theme/assets/fonts/`), under the SIL Open Font License; the licence texts and the source of each file are beside them. The theme loads nothing from a third party.

## Commands

| Command | What it does |
|---|---|
| `npm run preview` | A local shop with the sample catalogue and an admin login, on a throwaway database |
| `npm run dev` | Local development server, with local D1 and R2 that keep their data; starts empty |
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
