# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

Nundar is a **shop plugin and a commerce theme for Mallok**, packaged as a Mallok site. It is not a standalone application: Mallok (the `mallok` npm package, pinned to an exact version, currently `0.1.0-rc.11`) provides routing, rendering, content, languages, hreflang, the sitemap, the admin, sign-in, media, email and the edge cache. Nundar adds only commerce.

`docs/superpowers/specs/2026-09-30-nundar-on-mallok-design.md` is the source of truth for the architecture, with the owner's decisions in its §11. The commerce rules in `docs/superpowers/specs/2026-09-03-nundar-design.md` (§4–§7) still hold; its stack and architecture are superseded. The previous standalone Next.js implementation is at the tag `nextjs-final` — read it for reference, never restore it.

Nundar is in development. `mallok@0.1.0-rc.11` carries plugin API 2 — the extension points of design §7 — and several features are not built on them yet (the list is below). **Do not work around a missing Mallok capability** — no writing into Mallok's core tables, no `onRequest` hook to intercept pages, no client-side fetching of prices. A defect or a gap met in Mallok is written up for the owner, who does the Mallok-side work in the Mallok repository; do not edit that repository from a session here.

## Commands

```bash
npm ci
npm run build                 # mallok prepare (stages admin + theme assets) then a deploy dry run
npm run preview               # a filled local shop on a throwaway database; prints an admin login
npm run dev                   # wrangler dev with local D1 and R2 that keep their data; starts empty, needs .dev.vars
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
- `src/theme/` — how pages look and nothing else: `theme.json` (kinds, fields, options), `layouts/`, `partials/`, `locales/<locale>.json`, `assets/` (the stylesheet, four images, the fonts and their licences, and the scripts `theme.json` declares). It has no tables and no routes.
- `content/` and `seed/` — the sample catalogue, a fictional titanium fastener supplier: 31 bundles in four languages, and one variant per SKU. `site.json` — the site's languages, kinds, navigation and theme options, which is where this site's own copy lives.

Mallok decides the contracts on both sides. Its documentation is the reference: `PLUGIN_API.md`, `THEME_FORMAT.md` and `CONTENT_FORMAT.md` in the Mallok repository (`node_modules/mallok/types/worker.d.ts` has the types).

### The shop plugin

- **Tables** are `p_shop_*`, language-independent, keyed by `product_group` — the product content's `translation_group` — so one set of variants serves every language. Timestamps are ISO text, as in Mallok.
- **Data access is raw D1 SQL, no ORM.** Read with one `db.batch`, write with one statement where possible: lists travel as a single JSON parameter through `json_each` (`lib/rates.ts`, `lib/cart-pricing.ts`). D1's Free plan allows 50 queries per invocation, and a tick of Mallok's cron shares its CPU budget across all plugins.
- **`lib/scheduled.ts`** does one small piece of work per minute tick: a repricing chunk in progress, else a rate fetch if due, else clearing expired carts. State between ticks is in `p_shop_state`.
- **Migrations**: additive and idempotent. Mallok's migrator drops whole-line `--` comments, then splits on `;` — a comment must have a line to itself. They run on the Worker's first request, not from a CLI.
- **The cart route** (`routes/cart.ts`, `POST /_mallok/p/shop/cart`) takes a plain form POST and answers 303. The cart cookie is scoped to `/_mallok/p/shop`: Mallok bypasses its edge cache for any public request that carries a cookie.
- **Orders and payment are built but not reachable** (design §14). `lib/orders.ts` places an order and confirms its payment, `lib/order-fulfilment.ts` ships, cancels and refunds, `lib/outbox.ts` records what each change still owes, `lib/stripe-webhook.ts` decides what a Stripe delivery means and which status to answer, `lib/stripe-signature.ts` and `lib/stripe-client.ts` talk to Stripe over `fetch`, `lib/order-email.ts` builds the buyer's emails. No route, page or admin screen calls them, and nothing drains the outbox: those wait for Mallok. Do not add a route that works around that.
- **A change to an order is conditional on the status it was read in** (`ORDER_STILL_IN_STATUS` in `lib/order-guard.ts`), and the statement that changes the status comes last in its batch. That is what makes a racing second call write nothing.
- **A change to an order writes its outbox row in the same batch** (`orderChangedOutbox`). What follows the change — an email, a purge — is owed from that row. Never send from a function's return value: it is lost whenever the Worker stops after the batch. Rows are read back by `seq`, the order they were committed in, never by `created_at`, which is whatever time the caller passed.
- Pure logic (`money`, `pricing`, `ecb`, `order-state`, `currency`, `availability`, `stripe-signature`) takes no database; DB functions take a `D1Database` and, where time matters, a `now`.

### The theme and content

- Templates are restricted Liquid. Output is escaped; only `content.html` and `page.head` are emitted verbatim. `page.head` carries hreflang and structured data from Mallok and must stay in `layouts/base.liquid`.
- Interface strings are in `locales/*.json` (flat maps, the default locale is the fallback). Site-specific copy — the home page's headline and sections, the footer, the links behind the buttons — is a theme option, never a string in a template; per-language option values go under `themeOptions.$locales` in `site.json`, and `test/project.test.ts` fails when a language is left without one.
- **Kinds**: `product`, `collection`, `application` (the sample's industry pages, at `/industries`), `case`, `faq`, `tool`, `article`, `page`. A kind with a `base` needs a `listLayout`: without one Mallok answers its base path with a 500.
- **A product is one page with its sizes on it**, not a page per size. `facets` are the attributes a buyer filters by; `sizes` maps each SKU to what distinguishes it; `specs` is the full table. `partials/spec-table.liquid` (the specification finder, the catalogue, a collection's products, a product's neighbours) takes its columns from the first product that has `facets` and fills every row by attribute name, so every product in a language must use the same names. Below 72rem the same table is laid out as cards, two to a row on a tablet: seven columns need about 1100px in German.
- **References resolve by slug within the same language.** An `application` and a `case` name their `product`; the product page lists them through `content.backrefs.application` and `content.backrefs.case`. A `product` names its `collection`; the collection page lists `content.backrefs.product`. Mallok resolves `reference` only, not `reference[]`.
- **A link in a Markdown body is plain text to Mallok**: it is not rewritten per language and nothing reports a dead one. Write the path of the page in the same language (`/de/products/<german slug>`); `test/content.test.ts` checks every one.
- `[[inquiry]]` on a line of its own becomes the inquiry plugin's form when that plugin is enabled. Its labels exist in English and Chinese only (Mallok), so the other languages show English labels.
- The header puts the site name, the navigation, the language control and one button on a single line from 1280px. The sample's ten links fit in all four languages with little to spare (German is the longest); a longer label in `site.json` overflows that line, and only a look at the page at 1280px shows it.
- **A script only adds to a page that is already whole.** There are two. `assets/finder.js` puts filters above the specification table on the home page and in the catalogue. `assets/calculators.js` runs the three fastener calculators on a `tool` page whose front matter says `calculators: fasteners`, above a text that prints the same formulas, constants and tables — and `test/theme-scripts.test.ts` holds every constant in the script, and every figure it computes, to that page. In both cases the form is in the page `hidden`, with its labels from the language pack and its numbers in `value` attributes, so the script reads no language and the page offers nothing it cannot do. A script asks for a field with `querySelector`, never through `form.elements`: that list answers `length` with a count, whatever a field is called. A script is a plain file — no build step, no imports — declared in `theme.json`'s `clientScripts` with its exact size, and loaded only as `<script src="{{ theme.asset_base }}/<file>" defer></script>`, only by the layout that has what it works on. It hands its pure functions to `module.exports` when a `module` exists, which is how `test/theme-scripts.test.ts` runs them under `node:vm`; what it does to a page is checked in a browser, by hand.
- Fonts are files in `assets/fonts/`, declared in `style.css` and preloaded in `layouts/base.liquid`; nothing is loaded from another host. Changing any asset means bumping `version` in `theme.json`: assets are served from a versioned path and cached for good.
- Each language of a bundle is its own content item with its own `slug` (`index.md`, `index.<locale>.md`); Mallok puts them in one `translation_group`. A bundle carries a `mallok.json` only when something outside the content must name it: each product's fixes the `translation_group` that `seed/shop-sample.sql` attaches its variants to. `test/content.test.ts` checks the reference rule, keeps every identity file in step with its bundle, and holds the seed's variants to the SKUs the product pages list.
- The default language (English) is unprefixed; others are `/<locale>/…`. English pages default to USD, the rest to EUR (`lib/currency.ts`), never by IP.

### What is not built on plugin API 2 yet

`mallok@0.1.0-rc.11` allows each of these; the code here does not use it yet.

- No `renderData` hook, so prices and variants are not on pages.
- No page route and no `pluginLayouts` in the theme, so there is no cart page.
- The variants panel is a read-only table; variants are seeded from `seed/shop-sample.sql`.
- No raw-body route, so no Stripe webhook, and so no checkout.
- The sample's products name one collection each, though `reference[]` is resolved now.

When one is built, take it off this list and prove the behaviour with a test or the smoke run.

### Known limits of mallok 0.1.0-rc.11 that shape the code

- Switching a plugin on or off, or changing a setting, can leave cached pages as they were — and the admin's "Clear cached pages" can report success without clearing anything. So the plugins are switched on before the first publish (`scripts/lib/local-shop.mjs`, the README), and `test/shop/helpers.ts` deletes the cached home page by hand after changing settings. Keep both until a Mallok release says the purge can be trusted.

## Testing

- Tests in `test/shop` and `test/theme` run inside workerd against the site's own Worker. `test/shop/helpers.ts` brings a site up through Mallok's HTTP API (first request → admin → token → settings → plugin enabled); tables are created by Mallok's migrator, never by hand. Create content with `createContent`, not by inserting rows.
- Mallok caches pages in `caches.default`. In a test, create all content before requesting any page.
- A test for a fix must be seen failing without the fix. For new guards, break the guard and confirm the test goes red.
- A race is tested by running the calls with `Promise.all`, and such a test only counts once breaking the guard turns it red: that is the proof the two calls really interleave.
- `countD1Calls` in `test/shop/helpers.ts` counts round trips; use it wherever the number is a design constraint. `interceptBatches` runs a hook around each batch: it is how a test changes the data between a function's reading and its writing, or loses the answer to a write that committed.
- `test/theme/pages.test.ts` renders every layout from content it creates itself, with everything set; `test/theme/bare.test.ts` does the same for a site that has filled in almost nothing, and fails on any empty element or `href=""`. Neither reads `content/`. A template that prints a wrapper has to check that there is something to put in it — and `content.html` is not a string, so capture it before comparing it with `blank`. The sample is checked by `test/content.test.ts` and `test/project.test.ts` (files only, no Worker) and by the smoke run.
- `npm run smoke:shop` is the only place theme, plugin, content and the Mallok CLI run together; run it when touching any of them. It publishes the real sample, requests every kind of page, and follows every header and footer link in all four languages.
- `scripts/lib/local-shop.mjs` is the one place that brings a local shop up — administrator, plugins, settings, content, variants, in that order and before any page is requested. The smoke run and `npm run preview` both use it; do not grow a second copy. Locally nothing purges the page cache (`s-maxage=3600`, persisted under the state directory), so a page requested before the set-up finished stays as it was.

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
