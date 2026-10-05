# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

Nundar is a **shop plugin and a commerce theme for Mallok**, packaged as a Mallok site. It is not a standalone application: Mallok (the `mallok` npm package, pinned to an exact version, currently `0.1.0-rc.9`) provides routing, rendering, content, languages, hreflang, the sitemap, the admin, sign-in, media, email and the edge cache. Nundar adds only commerce.

`docs/superpowers/specs/2026-09-30-nundar-on-mallok-design.md` is the source of truth for the architecture, with the owner's decisions in its §11. The commerce rules in `docs/superpowers/specs/2026-09-03-nundar-design.md` (§4–§7) still hold; its stack and architecture are superseded. The previous standalone Next.js implementation is at the tag `nextjs-final` — read it for reference, never restore it.

Nundar is in development. Several features wait for extension points Mallok does not have yet (design §7). **Do not work around a missing Mallok capability** — no writing into Mallok's core tables, no `onRequest` hook to intercept pages, no client-side fetching of prices. The Mallok-side work is done by the owner in the Mallok repository; do not edit that repository from a session here.

## Commands

```bash
npm ci
npm run build                 # mallok prepare (stages admin + theme assets) then a deploy dry run
npm run dev                   # wrangler dev with local D1 and R2; needs .dev.vars
npm run lint                  # biome check .   (npm run lint:fix to apply)
npm run typecheck
npm test                      # test:project, then test:shop
npm run test:project          # node --test: site config and sample content (test/*.test.ts)
npm run test:shop             # vitest inside workerd: plugin and theme (test/shop, test/theme)
npx vitest run test/shop/rates.test.ts                    # one file
npx vitest run test/shop/cart-route.test.ts -t "MOQ"      # tests matching a name
npm run smoke                 # a real request to a real local Worker
npm run smoke:shop            # the whole shop end to end on a throwaway local Worker
```

CI (`.github/workflows/ci.yml`) runs `npm ci` → lint → typecheck → test → build → smoke → smoke:shop.

- **npm only.** Mallok's CLI refuses a project with a pnpm or yarn lockfile. Adding a dependency needs npm 11 (`npx npm@11 install …`): npm 10.9.7 crashes while adding some packages to this tree. `npm ci` works with either.
- **Upgrading Mallok** is `npx mallok upgrade --to <version>`, never a hand edit of `package.json`.
- vitest, `wrangler dev`, the smoke scripts and npm itself need to listen on local ports or write outside the project; in a sandbox that forbids that they fail with `listen EPERM` / `EPERM`.

## Architecture

### The split

- `src/worker/index.ts` is the whole site: `createMallok({ theme: nundarTheme, plugins: [inquiry, shop] })`. Theme and plugins are build-time choices.
- `src/plugins/shop/` — commerce logic and nothing about pages. `plugin.json` is the manifest (validated strictly by `definePlugin`: unknown fields are rejected, every declared hook and route needs an implementation and vice versa). `migrations/` holds SQL, `lib/` the logic, `routes/` the HTTP handlers, `index.ts` wires them.
- `src/theme/` — how pages look and nothing else: `theme.json` (kinds, fields, options), `layouts/`, `partials/`, `locales/<locale>.json`, `assets/`. It has no tables, no routes and no JavaScript.
- `content/` and `seed/` — the sample catalogue. `site.json` — the site's languages, kinds, navigation and theme options.

Mallok decides the contracts on both sides. Its documentation is the reference: `PLUGIN_API.md`, `THEME_FORMAT.md` and `CONTENT_FORMAT.md` in the Mallok repository (`node_modules/mallok/types/worker.d.ts` has the types).

### The shop plugin

- **Tables** are `p_shop_*`, language-independent, keyed by `product_group` — the product content's `translation_group` — so one set of variants serves every language. Timestamps are ISO text, as in Mallok.
- **Data access is raw D1 SQL, no ORM.** Read with one `db.batch`, write with one statement where possible: lists travel as a single JSON parameter through `json_each` (`lib/rates.ts`, `lib/cart-pricing.ts`). D1's Free plan allows 50 queries per invocation, and a tick of Mallok's cron shares its CPU budget across all plugins.
- **`lib/scheduled.ts`** does one small piece of work per minute tick: a repricing chunk in progress, else a rate fetch if due, else clearing expired carts. State between ticks is in `p_shop_state`.
- **Migrations**: additive and idempotent. Mallok's migrator drops whole-line `--` comments, then splits on `;` — a comment must have a line to itself. They run on the Worker's first request, not from a CLI.
- **The cart route** (`routes/cart.ts`, `POST /_mallok/p/shop/cart`) takes a plain form POST and answers 303. The cart cookie is scoped to `/_mallok/p/shop`: Mallok bypasses its edge cache for any public request that carries a cookie.
- **Orders and payment are built but not reachable** (design §14). `lib/orders.ts` places an order and confirms its payment, `lib/order-fulfilment.ts` ships, cancels and refunds, `lib/outbox.ts` records what each change still owes, `lib/stripe-webhook.ts` decides what a Stripe delivery means and which status to answer, `lib/stripe-signature.ts` and `lib/stripe-client.ts` talk to Stripe over `fetch`, `lib/order-email.ts` builds the buyer's emails. No route, page or admin screen calls them, and nothing drains the outbox: those wait for Mallok. Do not add a route that works around that.
- **A change to an order is conditional on the status it was read in** (`ORDER_STILL_IN_STATUS` in `lib/order-guard.ts`), and the statement that changes the status comes last in its batch. That is what makes a racing second call write nothing.
- **A change to an order writes its outbox row in the same batch** (`orderChangedOutbox`). What follows the change — an email, a purge — is owed from that row. Never send from a function's return value: it is lost whenever the Worker stops after the batch.
- Pure logic (`money`, `pricing`, `ecb`, `order-state`, `currency`, `availability`, `stripe-signature`) takes no database; DB functions take a `D1Database` and, where time matters, a `now`.

### The theme and content

- Templates are restricted Liquid. Output is escaped; only `content.html` and `page.head` are emitted verbatim. `page.head` carries hreflang and structured data from Mallok and must stay in `layouts/base.liquid`.
- Interface strings are in `locales/*.json` (flat maps, the default locale is the fallback). Site-specific copy is a theme option; per-language option values go under `themeOptions.$locales` in `site.json`.
- **References resolve by slug within the same language.** An `application` names its `product`; the product page lists them through `content.backrefs.application`. A `product` names its `collection`; the collection page lists `content.backrefs.product`. Mallok resolves `reference` only, not `reference[]`.
- Each language of a bundle is its own content item with its own `slug` (`index.md`, `index.<locale>.md`); Mallok puts them in one `translation_group`. A bundle carries a `mallok.json` only when something outside the content must name it: the product's fixes the `translation_group` that `seed/shop-sample.sql` attaches variants to. `test/content.test.ts` checks the reference rule and keeps any identity file in step with its bundle.
- The default language (English) is unprefixed; others are `/<locale>/…`. English pages default to USD, the rest to EUR (`lib/currency.ts`), never by IP.

### Known limits of mallok 0.1.0-rc.9 that shape the code

- No render-time hook with database access, so prices and variants are not on pages yet.
- Plugin routes cannot render through the theme, so there is no cart page yet.
- Plugin admin panels are read-only tables; variants are seeded from `seed/shop-sample.sql`.
- Plugin routes receive a parsed body, so a Stripe signature cannot be checked in one: there is no webhook route, and so no checkout.
- `reference[]` fields are not resolved, so a product names one collection.

Each is a task in Mallok's plan for plugin API 2. When Mallok ships one, upgrade, remove the corresponding limitation here, and prove the new behaviour with a test or the smoke run.

## Testing

- Tests in `test/shop` and `test/theme` run inside workerd against the site's own Worker. `test/shop/helpers.ts` brings a site up through Mallok's HTTP API (first request → admin → token → settings → plugin enabled); tables are created by Mallok's migrator, never by hand. Create content with `createContent`, not by inserting rows.
- Mallok caches pages in `caches.default`. In a test, create all content before requesting any page.
- A test for a fix must be seen failing without the fix. For new guards, break the guard and confirm the test goes red.
- A race is tested by running the calls with `Promise.all`, and such a test only counts once breaking the guard turns it red: that is the proof the two calls really interleave.
- `countD1Calls` in `test/shop/helpers.ts` counts round trips; use it wherever the number is a design constraint. `interceptBatches` runs a hook around each batch: it is how a test changes the data between a function's reading and its writing, or loses the answer to a write that committed.
- `npm run smoke:shop` is the only place theme, plugin, content and the Mallok CLI run together; run it when touching any of them.

## Commerce invariants (do not "simplify" them away)

- Money is integer minor units (`lib/money.ts`), never a float.
- A cart line is a variant and a quantity, never a price; `priceCart` recomputes from the database and reports every problem at once.
- MOQ and stock are enforced server-side in `quantityIssue`, shared by add-to-cart and cart pricing.
- `stock` carries `CHECK (stock >= 0)`. `test/shop/schema.test.ts` proves a failing decrement rolls back its whole D1 batch, and that `WHERE stock >= qty` does not — the payment write relies on the constraint.
- Stock comes off when a payment is confirmed, never when an order is placed, and only for stock-tracked variants. `markOrderPaid` is one batch — event, stock, ledger, outbox, status — and must stay one: splitting it brings back the state where stock is taken for an unpaid order, or an order is paid and its email never owed.
- One payment takes stock once, however it is reported: the same event again, a different event for the same payment intent, or two deliveries at the same moment. The parallel tests in `test/shop/orders.test.ts` hold this; do not weaken them into sequential ones.
- What to do with a payment is read from the data — is it on record, what status is the order in, is the stock there — and read again after a write that failed. Never from the text of an error.
- A payment the order cannot take (cancelled, or settled by another payment) is recorded as `refused` with an outbox row naming the payment to refund. The order and the stock are not touched, and the money is never left without a trace.
- A webhook body is trusted only after `verifyStripeSignature` has passed on the bytes as received. Answer 5xx only for what delivering again could change — a database failure; Stripe redelivers anything that is not a 2xx for three days.
- Money columns check `typeof(x) = 'integer'`: SQLite stores 99.5 in an `INTEGER` column rather than refuse it.
- A Stripe failure is described by Stripe's identifiers and the status, never its free-text message: nothing rules out that text repeating a buyer's email address.
- An order line is a snapshot of SKU, name and unit price. Nothing that later happens to the product may change a past order.
- A `manual` price is never overwritten; the base price is never rewritten; an `auto` price moves only past the drift threshold.
- Order status changes only through `lib/order-state.ts`.
- Every external input passes Zod; every SQL value is bound; redirects go only to same-site paths; logs carry no personal data.

## Conventions

- Everything in the repository is English: code, comments, docs, commit messages. `README.md` is authoritative; `README.zh-CN.md` is a derived translation.
- Comments explain *why*, often naming the defect or the platform limit behind the code. Match that density.
- Biome formats and lints (single quotes, semicolons, 80 columns). Named exports; `import type`; no `any`.
- Conventional Commits, one concern per commit.
