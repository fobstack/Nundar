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
- **What a page shows of the shop** is `plugins.shop`, built by `lib/storefront.ts` from rows alone and read by the `renderData` hook in `lib/render-data.ts`. That file's header is the contract a theme is written against. Mallok gives the hook one database call, a read: one batch of two statements serves a product page and a list alike, and a cold product page is three round trips in all (`test/theme/prices.test.ts` counts them). Every value arrives ready to print — a plugin cannot give a template a filter. The stock is read to decide a state and goes no further.
- **A page says which products it depends on**: the hook returns each product's translation group as a cache tag, which the page carries as `p:shop:<group>` — a product page its own, a list or the home page every product's it shows, a product with no variants too, so that its first one reaches the page.
- **Variants are edited in the admin**, in a `records` panel under the editor of every product (`attachTo` in `plugin.json`; the handlers are `lib/variant-records.ts`). Mallok checks each value against the field the manifest declares and never writes the table itself: `saveVariant` judges what only the shop can — a SKU that is taken, a lead time that ends before it starts — and writes the variant, its prices and the stock ledger in one batch after one read. `price` is the base price; `other_prices` are entered by hand and stored `manual`, and need a base price; any other currency is derived from the base price at the stored rate. Whether a derived price is out of date is asked inside the write, of the table as the batch runs — a decision taken from the earlier reading goes wrong when two saves cross. The stock field comes to the form empty and writes only when a figure is typed. A deleted product takes its variants with it (`onContentDelete`, once its last language has gone); one kept because an order names it gives its SKU back.
- **Whoever changes what a page shows purges that product's tag**: a save or a delete in the admin, and a repricing chunk for the products whose prices moved, one call for the chunk. A handler does not wait for its purge — Mallok gathers two seconds of purges into one call, and a save that waited would take those two seconds — it hands the promise to `ctx.waitUntil`. A purge that does not happen leaves the pages to expire and is not a failed save. Mallok's `purgeTags` resolves, rather than rejects, when a purge was not attempted or was turned down, so its answer is read (`purgeOutcome`), never assumed.
- **`lib/scheduled.ts`** does one small piece of work per minute tick: a repricing chunk in progress, else a rate fetch if due, else clearing expired carts. State between ticks is in `p_shop_state`.
- **Migrations**: additive and idempotent. Mallok's migrator drops whole-line `--` comments, then splits on `;` — a comment must have a line to itself. They run on the Worker's first request, not from a CLI.
- **The cart is two routes** (`routes/cart.ts`). `GET /_mallok/p/shop/cart` is the cart page: the plugin returns a view — `lib/cart-view.ts`, whose header is the contract — and the theme's `shop/cart` layout draws it. `POST /_mallok/p/shop/cart/update` is where every form that changes the cart posts: add, set, remove, choose a currency. It never renders: every answer is a 303 to the cart page, and a change that is refused goes there with the reason and the variant in the address (`?refused=below_moq&variant=…`). The cart page reads the figures from the database and says them — nothing else from the address reaches the page. Do not go back to rendering the refusal from the POST: Mallok lists a page under the route that rendered it, so its language switcher and canonical would point at an address that only takes a POST. Mallok keys a handler by its path, so the page and the form cannot share one. The language is the segment after the plugin's id (`/_mallok/p/shop/de/cart`), and `lib/paths.ts` builds every such address. The cart cookie is scoped to `/_mallok/p/shop`, which every language shares: Mallok bypasses its edge cache for any public request that carries a cookie. A cookie that names no live cart — expired, or an id somebody chose — is never taken up: the id is all that protects a cart, so only the shop issues one.
- **A product can be bought when a visitor can see it**: `status = 'published' AND published_at <= now`, Mallok's own test — a page published for later is not out yet. Its name and its address are read from the core's `content` table (`title`, `path`), in the buyer's language, else the default one, else any it is out in.
- **One rule says which currency a page or a cart is in** (`settleCurrency` in `lib/currency.ts`): the one asked for when everything has a price in it, else the base currency, else whatever is shared. A page and the cart it leads to must not disagree, so neither has a rule of its own.
- **`readCartFacts` (`lib/cart-pricing.ts`) is the one reading of a cart**: every line judged against the database, in one round trip. `priceCart` turns it into an order's lines or its list of problems; the cart page shows it line by line. Do not grow a second calculation beside it.
- **A public page is the same for every visitor.** What is in a cart is never in one: the header's link to the cart, and the form a product page offers for a size, are rendered into the cached page and identical for all. The hook tells every page where the cart is (`cart_path`, `cart_action`) and costs no query for it.
- **Orders and payment are built but not reachable** (design §14). `lib/orders.ts` places an order and confirms its payment, `lib/order-fulfilment.ts` ships, cancels and refunds, `lib/outbox.ts` records what each change still owes, `lib/stripe-webhook.ts` decides what a Stripe delivery means and which status to answer, `lib/stripe-signature.ts` and `lib/stripe-client.ts` talk to Stripe over `fetch`, `lib/order-email.ts` builds the buyer's emails. No route, page or admin screen calls them, and nothing drains the outbox: those wait for Mallok. Do not add a route that works around that.
- **A change to an order is conditional on the status it was read in** (`ORDER_STILL_IN_STATUS` in `lib/order-guard.ts`), and the statement that changes the status comes last in its batch. That is what makes a racing second call write nothing.
- **A change to an order writes its outbox row in the same batch** (`orderChangedOutbox`). What follows the change — an email, a purge — is owed from that row. Never send from a function's return value: it is lost whenever the Worker stops after the batch. Rows are read back by `seq`, the order they were committed in, never by `created_at`, which is whatever time the caller passed.
- Pure logic (`money`, `pricing`, `ecb`, `order-state`, `currency`, `availability`, `storefront`, `stripe-signature`) takes no database; DB functions take a `D1Database` and, where time matters, a `now`.

### The theme and content

- Templates are restricted Liquid. Output is escaped; only `content.html` and `page.head` are emitted verbatim. `page.head` carries hreflang and structured data from Mallok and must stay in `layouts/base.liquid`.
- Interface strings are in `locales/*.json` (flat maps, the default locale is the fallback). Site-specific copy — the home page's headline and sections, the footer, the links behind the buttons — is a theme option, never a string in a template; per-language option values go under `themeOptions.$locales` in `site.json`, and `test/project.test.ts` fails when a language is left without one. The tagline is not an option: it is Mallok's own setting, a map of language to text in `site.json`. It follows the site's name in the home page's title, and describes that page unless the `home_description` option gives the language a fuller text.
- **Kinds**: `product`, `collection`, `application` (the sample's industry pages, at `/industries`), `case`, `faq`, `tool`, `article`, `page`. Every kind with a `base` has a `listLayout` here, because each list is a page worth having; a kind without one has no list page — its base path answers 404 — and no entry in `site.kinds`. A template links to a kind's list only through `site.kinds.<kind>`, inside `{% if %}`: the breadcrumb (`partials/crumbs.liquid`) and the home page's link to the catalogue do, and `test/theme/unlisted.test.ts` holds both on a site that serves products without a list.
- **The cart page is the layout `layouts/shop-cart.liquid`**, declared under `pluginLayouts` in `theme.json` as `shop/cart`. It reads `plugin_page`, not `content`; `plugins` is empty on it. Every control is a plain form posting to `plugin_page.action`, a quantity field carries the minimum order in `min` and `step`, and the page has no script. The plugin has no words: a refusal or a line's problem arrives as a kind (`below_moq`, `insufficient_stock`, `unavailable`, `no_price`, `quantity_too_large`, `cart_full`), the pack has a `problem_<kind>` for each, and the number it is about is printed after the words. The layout titles itself through `{% block title %}` in `layouts/base.liquid`, since Mallok titles a plugin's page with the site's name.
- **`plugins.shop` is optional everywhere.** It is absent when the plugin is off, when its read failed, in `mallok build` and in the admin's preview, and a product may have no variants. A template wraps what it prints from it in `{% if %}`, and the page is whole without it: the sizes with their SKUs, and no prices. A variant is found by walking `plugins.shop.variants`, never by `variants[sku]`: Liquid answers `size`, `first` and `last` on any collection itself. The words around a value — "Unit price", "In stock", "business days" — are the theme's, in its packs; `avail_<state>` names the three states.
- **A product is one page with its sizes on it**, not a page per size. `facets` are the attributes a buyer filters by; `sizes` maps each SKU to what distinguishes it; `specs` is the full table. `partials/spec-table.liquid` (the specification finder, the catalogue, a collection's products, a product's neighbours) takes its columns from the first product that has `facets` and fills every row by attribute name, so every product in a language must use the same names. Below 72rem the same table is laid out as cards, two to a row on a tablet: seven columns need about 1100px in German.
- **References resolve by slug within the same language.** An `application` and a `case` name their `product`; the product page lists them through `content.backrefs.application` and `content.backrefs.case`. A `product` names its `collection`; the collection page lists `content.backrefs.product`. Mallok resolves `reference` only, not `reference[]`.
- **A link in a Markdown body is plain text to Mallok**: it is not rewritten per language and nothing reports a dead one. Write the path of the page in the same language (`/de/products/<german slug>`); `test/content.test.ts` checks every one.
- `[[inquiry]]` on a line of its own becomes the inquiry plugin's form when that plugin is enabled. The plugin has its own labels in English and Chinese and reads any other language's from the theme's pack: the six `inquiry_*` keys in `locales/de.json`, `fr.json` and `es.json`. They are deliberately not in `en.json` — a pack falls back to the default one, so English keys would replace the plugin's own text in every language this theme has no pack for.
- The header puts the site name, the navigation, the language control, the cart and one button on a single line from 1280px. The sample's ten links fit in all four languages with little to spare: at 1280px Spanish, the longest by its button, has about a dozen pixels left. A longer label in `site.json` or a longer `quote_short` in a pack runs past the page's right edge there, and only a look at the page at 1280px shows it — measure the last item against the content edge, not whether the page scrolls: the bar's own padding hides the first thirty pixels of an overrun.
- **A script only adds to a page that is already whole.** There are three. `assets/finder.js` puts filters above the specification table on the home page and in the catalogue. `assets/currency.js` is the currency switch: every price is rendered in the page's own currency and carries its amount in each other currency the page offers as `data-<code>` attributes beside a `data-price` marker; the script puts one in its place when a button of `partials/currency.liquid` is pressed, and keeps the choice in `localStorage` — never a cookie, which would take that visitor's pages out of the shared cache. The switch and the attributes are printed only when the page has more than one currency to show, and the structured data stays in the page's own. `assets/calculators.js` runs the three fastener calculators on a `tool` page whose front matter says `calculators: fasteners`, above a text that prints the same formulas, constants and tables — and `test/theme-scripts.test.ts` holds every constant in the script, and every figure it computes, to that page. For the finder and the calculators the form is in the page `hidden`, with its labels from the language pack and its numbers in `value` attributes, so the script reads no language and the page offers nothing it cannot do. A script asks for a field with `querySelector`, never through `form.elements`: that list answers `length` with a count, whatever a field is called. A script is a plain file — no build step, no imports — declared in `theme.json`'s `clientScripts` with its exact size, and loaded only as `<script src="{{ theme.asset_base }}/<file>" defer></script>`, only by the layout that has what it works on. It hands its pure functions to `module.exports` when a `module` exists, which is how `test/theme-scripts.test.ts` runs them under `node:vm`; what it does to a page is checked in a browser, by hand.
- Fonts are files in `assets/fonts/`, declared in `style.css` and preloaded in `layouts/base.liquid`; nothing is loaded from another host. Changing any asset means bumping `version` in `theme.json`: assets are served from a versioned path and cached for good.
- Each language of a bundle is its own content item with its own `slug` (`index.md`, `index.<locale>.md`); Mallok puts them in one `translation_group`. A bundle carries a `mallok.json` only when something outside the content must name it: each product's fixes the `translation_group` that `seed/shop-sample.sql` attaches its variants to. `test/content.test.ts` checks the reference rule, keeps every identity file in step with its bundle, and holds the seed's variants to the SKUs the product pages list.
- The default language (English) is unprefixed; others are `/<locale>/…`. English pages default to USD, the rest to EUR (`lib/currency.ts`), never by IP.

### What is not built on plugin API 2 yet

`mallok@0.1.0-rc.11` allows each of these; the code here does not use it yet.

- A cart leads nowhere yet: it cannot be sent as one inquiry, and there is no checkout. The cart page ends on a link to the quote page.
- No raw-body route, so no Stripe webhook, and so no checkout.
- The sample's products name one collection each, though `reference[]` is resolved now.

When one is built, take it off this list and prove the behaviour with a test or the smoke run.

### Known limits of mallok 0.1.0-rc.11 that shape the code

- `renderData` is told the items a list or the home page shows, and nothing of what a content page lists through a reference. So the products on a collection's page, and a product's neighbours, have no prices; `test/theme/prices.test.ts` holds that, and fails the day Mallok passes them.
- A `remove` handler of a records panel can only throw, which the admin shows as a failure with no reason; so deleting a variant that is on an order archives it instead of refusing. A panel's own order is always descending, so the variants list opens on the last one changed, not in the order a page shows them.
- `renderData` does not run for a not-found page, so the header there has no link to the cart.
- Nothing tells a plugin of a deletion it missed, and nothing here sweeps up afterwards: a variant with no product may as well be one that was loaded before its product was published, and a sweep cannot tell the two apart.
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
- A page never prints how many are left: availability is a state (`lib/availability.ts`). A count would have to be purged from the edge cache on every sale.
- A page is in one currency. A currency is offered only when every priced variant on the page has a price in it (`currenciesFor`). Where there is none the page prints no price, and its structured data offers none.
- The structured data offers what the page prints and nothing else: the same variants, the same amounts, the same states (`offersFor`; the test compares the two digit for digit).
- A cart line is a variant and a quantity, never a price; `priceCart` recomputes from the database and reports every problem at once.
- MOQ and stock are enforced server-side in `quantityIssue`, shared by add-to-cart and cart pricing. The quantity field on a page starts at the minimum order and steps by it; that is a convenience, and the server is the check.
- A refused change writes nothing and creates no cart; a sum is stated only for a cart every line of which can be ordered as it stands.
- A redirect is judged by the path the browser will read, not the text that was sent: `/.//host` is one slash as typed and another site once resolved.
- `stock` carries `CHECK (stock >= 0)`. `test/shop/schema.test.ts` proves a failing decrement rolls back its whole D1 batch, and that `WHERE stock >= qty` does not — the payment write relies on the constraint.
- Stock comes off when a payment is confirmed, never when an order is placed, and only for stock-tracked variants. `markOrderPaid` is one batch — event, stock, ledger, outbox, status — and must stay one: splitting it brings back the state where stock is taken for an unpaid order, or an order is paid and its email never owed.
- One payment takes stock once, however it is reported: the same event again, a different event for the same payment intent, or two deliveries at the same moment. The parallel tests in `test/shop/orders.test.ts` hold this; do not weaken them into sequential ones.
- What to do with a payment is read from the data — is it on record, what status is the order in, is the stock there — and read again after a write that failed. Never from the text of an error.
- A payment the order cannot take (cancelled, or settled by another payment) is recorded as `refused` with an outbox row naming the payment to refund. The order and the stock are not touched, and the money is never left without a trace.
- A webhook body is trusted only after `verifyStripeSignature` has passed on the bytes as received. Answer 5xx only for what delivering again could change — a database failure; Stripe redelivers anything that is not a 2xx for three days.
- Money columns check `typeof(x) = 'integer'`: SQLite stores 99.5 in an `INTEGER` column rather than refuse it.
- A Stripe failure is described by Stripe's identifiers and the status, never its free-text message: nothing rules out that text repeating a buyer's email address.
- An order line is a snapshot of SKU, name and unit price. Nothing that later happens to the product may change a past order.
- A `manual` price is never overwritten; the base price is never rewritten; an `auto` price moves only past the drift threshold — or when the base price it is derived from is changed in the admin. Saving a variant for any other reason leaves its derived prices as they are.
- Stock set in the admin is a figure, and the ledger records the difference from the stock as it is when the write lands, in the same batch — not from what the form was opened with. A save that names no figure writes no stock at all.
- A variant that has ever been ordered is never deleted, by the admin or with its product: an order's lines and the ledger name it. It is archived.
- Order status changes only through `lib/order-state.ts`.
- Every external input passes Zod; every SQL value is bound; redirects go only to same-site paths; logs carry no personal data.

## Conventions

- Everything in the repository is English: code, comments, docs, commit messages. `README.md` is authoritative; `README.zh-CN.md` is a derived translation.
- Comments explain *why*, often naming the defect or the platform limit behind the code. Match that density.
- Biome formats and lints (single quotes, semicolons, 80 columns). Named exports; `import type`; no `any`.
- Conventional Commits, one concern per commit.
