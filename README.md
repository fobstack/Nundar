# Nundar

**Open-source commerce engine for Cloudflare.** Built for cross-border sellers who want to rank for what buyers actually search — not fight for the head term everyone else is bidding on.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/FobStack/Nundar)
[![CI](https://github.com/FobStack/Nundar/actions/workflows/ci.yml/badge.svg)](https://github.com/FobStack/Nundar/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue)](LICENSE)

---

## The problem

If you manufacture something and want to sell it abroad, you have three unsatisfying options:

- **Marketplaces** (Alibaba, Amazon) hand you traffic but keep the customer. You compete on price against people selling the same thing, and the relationship is theirs, not yours.
- **Hosted storefronts** (Shopify and friends) give you your own store — and the same templates, the same page structure and the same SEO surface as everyone else on the platform. You still have to buy traffic.
- **Self-hosted platforms** (Medusa, Saleor, Bagisto) give you ownership, but you inherit servers to run, and their product pages are built for browsing a catalogue rather than for being found.

All three treat a product as **one page**. That is the mistake. A buyer searching *"ball valve for offshore platform seawater lines"* is far closer to purchase than one searching *"ball valve"* — and almost nobody is competing for the first phrase.

## What Nundar does differently

**A product is a content system, not a page.**

Every product carries structured content in four languages:

| Content type | Answers | Example search term it can win |
|---|---|---|
| **Description** | What is it | `316L stainless ball valve DN50` |
| **Features** | What is it like | `high temperature resistant ball valve` |
| **Applications** | Where is it used, and why | `ball valve for offshore platform seawater lines` |

Applications are the engine. Write one with real substance, flip a switch in the admin, and it becomes **its own landing page** — its own URL, title, and structured data, with a **localised slug per language**:

```
/en/products/stainless-ball-valve-dn50/offshore-seawater-lines
/de/products/stainless-ball-valve-dn50/offshore-seewasserleitungen
/fr/products/stainless-ball-valve-dn50/circuits-eau-de-mer-offshore
/es/products/stainless-ball-valve-dn50/lineas-agua-de-mar-offshore
```

Four languages × N applications. One product with three real applications becomes twelve pages that each answer a specific buying question — cross-linked with correct `hreflang`, listed in the sitemap, statically generated at the edge.

**The switch matters as much as the feature.** Applications stay inside the product page until you decide one is substantial enough to stand alone. Thin pages published for the sake of page count drag down the whole domain, so promoting one is a deliberate act rather than a default.

## Why Cloudflare

Everything runs on Workers: D1 for data, R2 for images, KV for sessions and carts, Durable Objects for cache coordination, Cron for exchange rates, Email for order notifications. No servers, no containers, no separate database bill.

**Local development needs no Cloudflare account at all** — D1, R2 and KV are simulated by miniflare, and the tests run inside the real `workerd` runtime rather than a Node mock.

## What is in the box

**Storefront**

- Statically generated product and application pages in four languages, with complete `hreflang`, self-referencing canonicals, and `Product` / `Offer` / `Article` / `BreadcrumbList` structured data
- Per-language sitemap generated from the database; unpublished applications are excluded
- Static pages with live stock and prices patched in on the client, so a page never promises stock it no longer has
- Cart, checkout and order tracking for guests — no forced account creation

**Admin**

- English interface, with Chinese available, kept separate from the storefront's buyer languages
- Product creation, multilingual content, SEO fields with length guidance
- Image upload to R2 with the format verified from file headers, and mandatory alt text
- Order management driven by an explicit state machine
- Customer records, sales dashboard, administrator management
- **Translation workbench** showing exactly which language is missing which field

**Commercial logic that is easy to get wrong, and is tested**

- Money is always integer minor units. Never a float, anywhere.
- Prices are recomputed server-side at checkout. The cart stores quantities only — never a price.
- Stock is decremented **after** payment confirms, with a conditional update that cannot go negative and compensation if it partially fails.
- Stripe webhooks are signature-verified and idempotent, because Stripe redelivers.
- MOQ and lead time are first-class fields, enforced in three places.
- One base price in USD; EUR and GBP derive from ECB rates with a configurable buffer and psychological rounding — and only move when the rate drifts past a threshold, so prices do not wobble daily.

**397 tests**, all running in the real Workers runtime.

## Theming

The storefront ships a theme system modelled on how Astro handles themes. Routes fetch data, emit SEO metadata and supply interface strings; themes decide only what things look like:

```
src/themes/
├── contract.ts        what every view receives — TypeScript enforces completeness
├── registry.ts        theme selection, via the THEME environment variable
├── default/           technical: hairline borders, sharp corners, catalogue-first
│   ├── tokens.css     colour, type, spacing — redefine these and the whole site changes
│   ├── layout/        shell, header, footer
│   └── views/         one component per page type
└── editorial/         serif, warm paper, soft shadows, application-notes-first
```

Two themes ship, and they are deliberately opposites — serif against grotesque, shadows against hairlines, a home page that leads with application notes against one that leads with the catalogue. The second exists to keep the contract honest: a contract with one implementation is only a guess.

**SEO logic never lives in a theme.** `hreflang`, canonicals and structured data stay in the route layer, so a broken theme can make the site ugly but cannot damage its indexing.

**Interface strings never live in a theme either.** Breadcrumbs and commerce vocabulary come from a shared catalogue, so a theme author who speaks no German can still ship a German-correct storefront. A theme owns its voice — hero copy, section headings — and nothing else. The rule: if getting it wrong is a bug, it is shared; if getting it different is a design choice, it belongs to the theme.

To build your own: copy a theme directory, rename its scope class in `tokens.css` and `layout/Shell.tsx` to match the new name, register it, set `THEME=yourtheme`, rebuild.

## Quick start

Requires Node.js 20+ and pnpm. **No Cloudflare account needed.**

```bash
git clone https://github.com/FobStack/Nundar.git
cd Nundar
pnpm install
pnpm setup     # generates migrations, creates the local database, loads sample data
pnpm dev
```

Open http://localhost:3000/en — or `/de`, `/fr`, `/es`.

For the admin:

```bash
pnpm admin:create you@example.com     # password is read from stdin, never an argument
```

Then http://localhost:3000/admin/login

## Deploying

Click the **Deploy to Cloudflare** button above. Cloudflare copies the repository into your own GitHub account, provisions the D1 database, both R2 buckets and the KV namespace, writes the generated IDs back into the config, runs the migrations and deploys.

Three things remain afterwards:

1. **Attach your own domain.** The default `*.workers.dev` address will not do — canonicals and `hreflang` are built from the real domain, so leaving it as-is breaks your SEO. Point `NEXT_PUBLIC_SITE_URL` at the real address.
2. **Enable your sending domain** so order emails are trusted: `npx wrangler email sending enable yourdomain.com` (the domain's DNS must be on Cloudflare).
3. **Create an admin account**: `pnpm admin:create you@example.com --remote`

### Deploying by hand

```bash
npx wrangler login

npx wrangler d1 create nundar
npx wrangler r2 bucket create nundar-media
npx wrangler r2 bucket create nundar-inc-cache
npx wrangler kv namespace create SESSIONS
```

Put the returned IDs into `wrangler.jsonc`, replacing `local-placeholder-replace-before-deploy`. The database may have any name — migration scripts reference the **binding** `DB`, not the database name.

```bash
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put MAIL_FROM_ADDRESS

pnpm deploy
pnpm db:seed:remote                            # optional sample catalogue
pnpm admin:create you@example.com --remote
```

Finally, point a Stripe webhook at `https://yourdomain.com/api/webhooks/stripe` subscribed to `payment_intent.succeeded`. **Order status depends on it** — without the webhook, paid orders never leave `pending`.

## Commands

| Command | What it does |
|---|---|
| `pnpm setup` | Prepare everything for local development |
| `pnpm dev` | Development server |
| `pnpm test` | Test suite, inside the real Workers runtime |
| `pnpm typecheck` / `pnpm lint` | Type and lint checks |
| `pnpm db:generate` | Generate migration SQL from the schema |
| `pnpm db:migrate:local` / `:remote` | Apply migrations |
| `pnpm db:seed:local` / `:remote` | Load sample data (idempotent) |
| `pnpm admin:create <email>` | Create an admin; add `--remote` for production |
| `pnpm cf-typegen` | Regenerate binding types after changing `wrangler.jsonc` |
| `pnpm deploy` | Build, migrate and deploy |

## Markets it ships with

| Locale | Markets | Default currency |
|---|---|---|
| `en` (default, carries `x-default`) | US, UK, Canada, Australia | USD |
| `de` | Germany, Austria, Switzerland | EUR |
| `fr` | France, Belgium, French Canada | EUR |
| `es` | Spain, Latin America | EUR |

Currencies: USD (base), EUR, GBP. Adding a language means adding a config entry and translating content — no schema change, because translations live in their own tables rather than in `name_en` / `name_de` columns.

## Scope

Nundar is a **single-tenant storefront**: one deployment, one shop, your own Cloudflare account, your own Stripe account. Multi-tenant SaaS, marketplace and B2B quotation flows are deliberately out of scope — the design document explains why.

## Design decisions

Architecture, data model, and the reasoning behind each trade-off:

- [`docs/superpowers/specs/`](docs/superpowers/specs/) — the design specification
- [`docs/superpowers/plans/`](docs/superpowers/plans/) — phase plans, and what implementation actually uncovered

Read the spec before changing anything structural. If your change contradicts a decision recorded there, update the spec in the same pull request and explain the new reasoning.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Contributions require a signed [ICLA](CLA.md) — one line, with the reasoning explained rather than assumed.

## Security

Please do not open a public issue for a security problem. [SECURITY.md](SECURITY.md) documents the trust boundaries, the design decisions that are security controls rather than style choices, and the residual risks we already know about.

## License

Dual-licensed under **MIT OR Apache-2.0**, at your option.

This mirrors Cloudflare's own tooling (`wrangler` is `MIT OR Apache-2.0`; `workerd` is Apache-2.0). MIT alone says nothing about patents; Apache-2.0 adds an explicit patent grant and retaliation terms, which matters to commercial adopters.

## Translations

This README is the authoritative version. Community translations are kept for convenience and may lag behind it:

- [简体中文](README.zh-CN.md)

Corrections belong in the English version first.
