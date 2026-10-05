# Nundar on Mallok: design

> Status: accepted; the owner's decisions are recorded in §11 (2026-10-01)
> Date: 2026-09-30
> Supersedes the stack and architecture of `2026-09-03-nundar-design.md` (§2, §3). Its commerce decisions (§4 to §7 there) carry over unchanged unless this document says otherwise.

## 1. The decision

Nundar is a **shop plugin and a commerce theme for Mallok**, plus a starter that puts them together. It is not a second application beside Mallok. A shop is a Mallok site with the shop plugin enabled and a commerce theme selected, in the same way Astro sites gain commerce through integrations and themes rather than through a second framework.

This is the owner's stated intent (2026-09-30) and matches Mallok's own product contract: "Nundar is a Mallok starter, theme and plugin set. A commerce site built *on* Mallok, not a second engine beside it" (`mallok: docs/PRODUCT_CONTRACT.md §2`).

The current Nundar repository is a standalone Next.js 16 application on OpenNext with no Mallok code or shared history. This document describes how to get from there to the plugin-and-theme shape, what Mallok has to gain first, and in what order.

Paths prefixed `mallok:` are relative to the Mallok repository at commit `0af520b` (0.1.0-rc.7).

## 2. What carries over and what does not

**Carries over unchanged**: the commerce decisions that are the reason Nundar exists, each already tested in the current code:

- Money is integer minor units, never floats (2026-09-03 §4.3).
- Prices are recomputed server-side at checkout. The cart stores quantities only (§6.1).
- Stock is decremented only after payment confirms, conditionally, and never goes negative. A failed decrement marks the order `oversold` (§6.3).
- The Stripe webhook is the only source of paid status, signature-verified and idempotent (§6.3).
- Order lines are snapshots (§4.3). Status changes only through the state machine (§6.4).
- MOQ is enforced on the product page, at add-to-cart and at checkout (§4.5.1).
- Pricing uses a USD base, derived EUR and GBP at the ECB rate plus a buffer, psychological rounding, a drift threshold, and manual overrides that are never overwritten (§4.4).
- Use cases can be promoted to landing pages with localised slugs (§1.1, §4.2.1).
- hreflang omits a missing language rather than substituting another's slug (§4.2.1).
- Language is decided by the URL only, never by IP (§5.4).

**Replaced by Mallok**:

- Next.js, OpenNext and the ISR Durable Objects
- React storefront themes and the React admin
- Drizzle
- KV carts, sessions and rate-limit counters
- The `send_email` binding
- Nundar's own authentication, media handling, Markdown renderer, sitemap and hreflang

What replaces each is set out in §3 and §8.

## 3. Division of responsibility

| Concern | Mallok core | Shop plugin (`shop`) | Commerce theme | Starter |
|---|---|---|---|---|
| Product text, SEO fields, images, per-language slugs, hreflang, sitemap | ✓ (content kinds, `translation_group`) | | Declares the `product` and `application` kinds | Sample products |
| Variants, SKUs, prices per currency, stock, MOQ, lead time | | ✓ (`p_shop_*` tables) | Renders them | Sample variants |
| Cart, checkout, order status pages | Renders them through the theme (§7 API-3) | ✓ (routes, data) | Layouts for them | |
| Stripe Checkout and webhook | | ✓ | | |
| Orders, stock adjustments, order email | Email delivery (Resend, `job` table) | ✓ | Email templates | |
| Exchange rates and repricing | The single cron | ✓ (`scheduled` hook) | | |
| Admin: content editing, translations, media, auth | ✓ | Panels and forms for its data (§7 API-6) | | |
| Edge cache and purge | ✓ (Cache API, tag purge) | Declares tags for its data (§7 API-2) | | |

## 4. Content model

### 4.1 Content (Mallok's content table)

**`product`**
- One row per language, joined by `translation_group`, which replaces Nundar's `products.id` plus `product_translations`.
- Per-language slugs are allowed: content is unique on `(kind, locale, slug)` (`mallok: src/db/migrations/0001_init.sql:47-49`).
- The commerce theme is a new theme (§11 decision 4) and declares its own `product` kind.
- It borrows the catalogue fields of Atelier's `product` kind where they fit: `grade`, `standard`, `form`, `specs`, `category`, `gallery`, `datasheet` (`mallok: src/themes/atelier/theme.json`).
- MOQ and lead time are not content fields: they live on variants (§4.2) and reach the page through the plugin.
- **Changed with the sample theme (§15).** The fields are now `facets`, `sizes`, `specs`, `collection`, `gallery` and `datasheet`. `facets` are the attributes a buyer filters the catalogue by, and the columns of the specification finder; `sizes` maps each SKU to what distinguishes it, so that a product is one page with its sizes on it and not a page per size. `material` and `standard` became ordinary rows of `specs`.

**`application`**
- A Nundar use case that has been promoted to its own landing page.
- Fields:
  - `product` (`reference` to `product`)
  - `spec_highlights` (`keyvalue`)
- Each language is its own row with its own slug, joined by `translation_group`, which replaces Nundar's `group_key`.
- Publishing an `application` is what gives it a page, which replaces `has_own_page`.
- The sample catalogue writes one per industry and serves the kind at `/industries` (§15). The kind and its fields are as above; only its address in `site.json` and the words the interface uses for it differ.

**Features, and use cases not promoted to a page**
- These are sections of the product's Markdown body (§11 decision 3).
- Features stay on the product page on purpose. They strengthen the product page itself for attribute queries, while per-product feature pages would multiply near-identical pages across products, which Google's spam policies treat as doorway abuse.

**`collection` (attribute collection page)**
- One page per attribute that buyers search for, such as "high-temperature ball valves", listing every product that has it, with its key parameters for comparison.
- A product names its collection in a `collection` field (`reference` to `collection`), and the collection page lists the products that name it through `content.backrefs.product`.
- This is how attribute queries are won: a browseable hierarchy across products rather than a page per product.
- **Corrected during phase 1A.** The first draft had the collection list its products in a `reference[]` field and said this needed no Mallok change. Mallok resolves `reference` only (`mallok: src/worker/render.ts:386,406`), so a `reference[]` reaches a template as bare slugs. With a single reference a product belongs to one collection; a product in several collections needs Mallok to resolve `reference[]` (§7).

### 4.2 Shop plugin tables

All shop tables are language-independent and keyed by the product's `translation_group`. Migrations use raw SQL, because Mallok uses no ORM (`mallok: docs/TECH_STACK.md §7`).

```sql
p_shop_variant(id, product_group, sku UNIQUE, option_values JSON, moq, lead_time_min, lead_time_max,
               stock INTEGER NOT NULL CHECK (stock >= 0),
               stock_policy,  -- track | made_to_order
               weight_grams, status, sort_order, created_at, updated_at)
p_shop_price(variant_id, currency, amount_minor, source,  -- base | auto | manual
             rate_used, updated_at, PRIMARY KEY (variant_id, currency))
p_shop_rate(base_currency, quote_currency, rate, reference_date, fetched_at, source,
            PRIMARY KEY (base_currency, quote_currency))
p_shop_cart(id, currency, locale, created_at, updated_at, expires_at)
p_shop_cart_line(cart_id, variant_id, quantity, PRIMARY KEY (cart_id, variant_id))
p_shop_state(key PRIMARY KEY, value, updated_at)  -- cron state: last rate attempt, repricing cursor
p_shop_order(id, order_no UNIQUE, status, currency, subtotal_minor, shipping_minor, tax_minor, total_minor,
             stripe_session_id, stripe_payment_intent_id UNIQUE, shipping_address JSON, email, locale,
             tracking_no, created_at, updated_at)
p_shop_order_line(id, order_id, variant_id, sku_snapshot, name_snapshot, unit_price_minor, quantity)
p_shop_stripe_event(event_id PRIMARY KEY, type, processed_at)
p_shop_stock_adjustment(id, variant_id, delta, reason, ref_id, created_at)
```

**The `CHECK (stock >= 0)` constraint is new.** It lets a single D1 batch carry the stock decrement:

- D1 batches are SQL transactions. "If a statement in the sequence fails … it aborts or rolls back the entire sequence" (Cloudflare D1 docs, `batch()`, checked 2026-09-30).
- A decrement that would go negative violates the constraint and rolls back the whole payment write.
- This replaces Nundar's manual compensation loop (`src/lib/orders/orders.ts`).
- The docs do not say whether a zero-row `UPDATE` counts as a failure. That is why the design relies on the constraint rather than on `WHERE stock >= qty`.
- **Proven in phase 1A.** `test/shop/schema.test.ts` shows, inside workerd, that a decrement which would go negative rolls back the whole batch, including a decrement made earlier in it, and that a conditional `UPDATE` matching no row does not.

**`stock_policy` was added in phase 1A.** The owner's decision to show availability as a state (§11 decision 6) needs the data to say which state applies: a `track` variant is limited by its stock, and a `made_to_order` variant is always orderable and shows its lead time instead.

**The order tables exist since 2026-10-05** (`migrations/0002_orders.sql`), created with the payment core (§14). They differ from the sketch above in seven places, each for a reason:

- **A fifth table, `p_shop_outbox`.** What still has to happen because an order changed — the buyer's email, the purge of a product's pages, a person told about a payment to refund — is a row written in the same batch as the change. Sending the email after the batch would lose it whenever the Worker stopped in between, with nothing to say it was owed. Rows are handed out by the table's own sequence, the order they were committed in, so that "shipped" is carried out before "delivered"; a timestamp is whatever the change was made with and cannot say that.
- **`p_shop_stripe_event` also holds the order, the payment intent and the outcome** (`paid`, `oversold`, `refused`), and is unique on the event's type with the payment intent. Stripe can send two events about one object; one payment is acted on once.
- **Money columns check their own storage type** (`typeof(x) = 'integer'`). SQLite keeps 99.5 in an `INTEGER` column as a real number rather than refuse it.
- `p_shop_order.total_minor` carries `CHECK (total_minor = subtotal_minor + shipping_minor + tax_minor)`. An order cannot hold a total that is not the sum of its parts.
- `p_shop_order.status` has no `CHECK`. The state machine in `lib/order-state.ts` decides which statuses exist; a `CHECK` could only be changed later by rebuilding the table, and migrations here are additive.
- `p_shop_order_line.id` is `<order id>:<variant id>`, and the pair is also `UNIQUE`. The payment write reads a line's quantity by that pair and relies on finding exactly one.
- `p_shop_stock_adjustment.id` is `<reason>:<order id>:<variant id>` for a movement an order causes. The same movement cannot be written twice: a second attempt fails and takes its batch with it.

Timestamps are ISO text, as everywhere in the plugin.

## 5. Request flows

### 5.1 Product and application pages (cached)

**Rendering**
- Mallok renders the content through the theme as it does today.
- The shop plugin supplies the variants, display-ready prices in every supported currency, and the availability through a render-data hook (§7 API-1).
- The theme renders them, and the plugin's data also produces the `Offer` JSON-LD. Mallok's core Product JSON-LD has no Offer today (`mallok: src/core/view.ts:300-308`).
- Mallok's rule is never to emit a price or stock level the page does not show (`mallok: docs/SEO_PERFORMANCE.md:94-95`), so the Offer uses exactly the rendered values.

**Budget**
- The plugin adds one D1 query per page.
- Mallok allows at most 4 D1 round trips on a cold render and measures 2 today (`mallok: CLAUDE.md`, `AC-INV-05`), so this fits.
- List pages fetch "price from" for their fixed 20 items in one `IN (…)` query.

**Currency** (§11 decision 2)
- The server renders the locale's default currency: USD for `en`, EUR for `de`, `fr` and `es`. Crawlers and the `Offer` JSON-LD see that currency.
- The page also carries the prices in every supported currency, from the render-data hook, as data attributes.
- A currency switch button swaps the displayed prices with a small script the commerce theme declares in `clientScripts` (`mallok: docs/THEME_FORMAT.md §9`). The choice is kept in `localStorage`, not a cookie.
- Why not server-side switching:
  - Mallok's cache key ignores query strings (`mallok: src/worker/cache.ts:17-22`), so a currency parameter would not vary the cache.
  - Any cookie bypasses the shared cache (`mallok: src/runtime/cloudflare/index.ts:82-100`), so a currency cookie would disable caching for that visitor.
- Without JavaScript the button is absent and the default currency shows. The chosen currency travels with add-to-cart as a form field and can be changed again on the cart page.

**Freshness**
- Pages carry a plugin tag per product (§7 API-2).
- They show availability as a state, "in stock" or "made to order, 15–20 business days", rather than an exact count.
- A paid order purges a product's pages only when its state changes, not on every decrement. This keeps purges inside the Free plan's tag-purge limit of 5 requests per minute with a bucket of 25 and 100 tags per request (Cloudflare purge docs, checked 2026-09-30).
- This replaces Nundar's client-side stock patch (`src/components/LiveStock.tsx`).

### 5.2 Add to cart, with no client JavaScript

**The form**
- The product page holds a plain HTML form per variant.
- It POSTs to `/_mallok/p/shop/cart` with `variant` and `quantity`. The quantity is `<input type="number" min="{moq}" step="{moq}">`, so the browser enforces MOQ, and the server enforces it again.
- The server answers 303 to the cart page.
- Mallok's visitor pages carry no client JavaScript by default (`mallok: docs/PRODUCT_CONTRACT.md §5`), and this flow needs no exception to that rule.

**The cart cookie**
- It is scoped to `Path=/_mallok/p/shop`, so it never reaches public pages and never disables their caching.
- The cart, checkout and order pages therefore live under that path, rendered through the theme (§7 API-3).
- `/_mallok/` is already disallowed in `robots.txt` (`mallok: src/core/seo.ts:151`), which is right for these pages.

**The cart table**
- The cart lives in D1, not KV.
- On the Free plan, KV allows 1,000 writes a day and D1 100,000 rows written a day (Cloudflare docs, checked 2026-09-30).
- The current Nundar writes KV on every product view through its inventory rate limiter, so the Free KV allowance runs out at roughly 1,000 product views a day.

### 5.3 Checkout

1. The checkout page (theme layout, plugin route) collects the address. The POST is validated with the same schema as today.
2. The server reprices the cart. This is `priceCart`, ported. It rechecks availability, MOQ and stock, but reserves nothing (2026-09-03 §6.3).
3. One D1 batch writes the order and its line snapshots, with status `pending`.
4. The server creates a Stripe Checkout session over `fetch` with the secret key held in Mallok's encrypted plugin secrets (`mallok: src/worker/secrets.ts`), and answers 303 to Stripe.

### 5.4 Stripe webhook

The route is `POST /_mallok/p/shop/stripe/webhook`. It needs the raw request body (§7 API-5). The decision it makes is built and tested already (`lib/stripe-webhook.ts`, §14); the route that calls it waits for API-5.

1. **Verify** the signature over the raw body, with a five-minute tolerance on its timestamp (`lib/stripe-signature.ts`). A failure answers 400 and does nothing.
2. **Sort.** Any event type other than `payment_intent.succeeded` answers 200 and does nothing. So does a payment that carries no order id: the same Stripe account may take payments that did not come through this shop. A payment event that carries no payment answers 400: waving it through would swallow a real payment in silence.
3. **Read**, in one batch: is this payment on record — the same event, or another event of the same type about the same payment intent; what status is the order in; is the stock its tracked lines need there.
4. **Act**, in one batch, every statement of which is conditional on the order still being in the status that was read:
   - *The order may be paid and the stock is there.* Record the event; decrement the stock of the order's stock-tracked lines; write their stock adjustments; put `order.paid` in the outbox; move the order `pending → paid`. A made-to-order line has no stock to take and is left out of the decrement.
   - *The order may be paid and the stock is not there.* Record the event; put `order.oversold` in the outbox; mark the order `oversold`, keeping the payment intent on it. Every statement is also conditional on the stock still being short.
   - *The order may not be paid* — it was cancelled, or another payment has settled it. Record the event as `refused` and put `payment.refused`, naming the payment intent, in the outbox. The order and the stock are not touched.
5. **If the batch failed, or found the order moved**, read again and act on what is true, rather than on the text of an error. That is how a decrement that trips the stock constraint becomes `oversold`, and how losing a race becomes "already on record". A write that threw is tried once more if the next reading still calls for it — stock can go and come back in between — and the same write throwing twice running is a real failure. Four passes at most.
6. **Answer by one question: could delivering this again change the result?** A database failure answers 5xx, and Stripe redelivers (2026-09-03 §8). Nothing else does. A payment naming an order this database does not have answers 200: another shop on the same Stripe account sees every payment of the account, and three days of retries would not make the order appear.
7. **What follows a payment is owed from the outbox**, not from this request's result: the confirmation email in `orders.locale` through `ctx.sendEmail`, and the purge of the product tags whose availability state changed. A route drains the order's outbox after any outcome that names an order.

### 5.5 Exchange rates

- Mallok runs one cron every minute, and plugins share one invocation's 10 ms CPU budget (`mallok: docs/PLUGIN_API.md §5.5`).
- The plugin's `scheduled` hook gates itself to once a day using `p_shop_rate.fetched_at`.
- It fetches the ECB feed, then reprices `auto` rows past the threshold in chunks, with a cursor across ticks rather than all at once.
- It purges the affected product tags in batches of up to 100 tags per request.
- `manual` rows are never touched.

### 5.6 Admin

- Product text, SEO, images and translations are edited in Mallok's editor.
- Variants, prices and stock are edited in shop-plugin forms. Order handling uses plugin panels whose actions take parameters, such as a tracking number.

Both need §7 API-6: today a plugin panel is a read-only table whose actions receive row ids only (`mallok: src/worker/admin-plugins.ts:297-402`).

## 6. Free-plan budget (verified against Cloudflare docs, 2026-09-30)

| Limit | Free plan | What the design does about it |
|---|---|---|
| Workers CPU | 10 ms per request; sustained overruns end in error 1102 | Product render adds one query. Checkout, webhook and repricing are measured on a real account before each phase ships (§9) |
| D1 | 5 M rows read and 100 k rows written per day, and queries fail until 00:00 UTC once exceeded; 50 queries per invocation | Carts and orders in D1 are well inside this. No per-view writes |
| KV | 1,000 writes per day | Not used |
| Tag purge | 5 requests/min, bucket 25, 100 tags per request | Purge on availability-state change only, batched |
| Cron | One per Worker (Mallok's rule) | Self-gated daily job inside the minute tick |

## 7. What Mallok has to gain first

Mallok's roadmap says a storefront needs "exactly the six plugin capabilities 0.1 built for the inquiry plugin. The core needs no new concept" (`mallok: docs/PRODUCT_VISION.md §9`). **The code does not bear that out.** The flows above need the following. Each is additive to the plugin contract, and each must keep Mallok's constraints:

- 10 ms CPU;
- at most 4 D1 round trips on a cold render;
- deterministic rendering for a given database state;
- no KV, Queues or Durable Objects;
- no vendor SDKs;
- one cron.

| Id | Change | Why today's contract is not enough | Needed by |
|---|---|---|---|
| API-1 | A render-data hook with read-only DB access, whose result reaches the theme as `plugins.<id>` in `PageView` and counts toward the round-trip budget | `afterRender` has no DB (`mallok: src/plugins/types.ts`, `PluginRenderContext`). `PageView` has no plugin slot (`mallok: src/core/page.ts:160-170`) | 5.1 |
| API-2 | Plugin-declared cache tags on pages (`p:shop:<group>`) | The page tag set is fixed (`mallok: src/worker/cache.ts:61-76`) | 5.1, 5.4, 5.5 |
| API-3 | Plugin pages rendered through the theme, with layouts the theme provides (`shop/cart`, `shop/checkout`, `shop/order`), locale-aware | Plugin routes return raw responses. `ctx.locale` is always the site default (`mallok: src/worker/plugin-runtime.ts:514`) | 5.2, 5.3 |
| API-4 | Multi-segment plugin route paths, non-string JSON values kept | Paths are one segment. Non-string JSON is dropped (`mallok: src/core/plugin.ts:25-35`, `src/worker/plugin-runtime.ts:452-457`) | 5.2–5.4 |
| API-5 | An opt-in raw-body route (no pre-parsing) | The body is parsed before the handler runs (`mallok: src/worker/plugin-runtime.ts:368-394`). Stripe's signature cannot be checked | 5.4 |
| API-6 | Editable plugin records: create and edit forms, repeatable rows, actions with parameters, detail views, and a scope check on panel reads | Panels are read-only. Actions get ids only. "A plugin ships no frontend code" (`mallok: docs/PLUGIN_API.md:366`) | 5.6 |
| API-7 | Call `onContentSave`, and add a content-delete hook | `runOnContentSave` exists but has no call site (`mallok: src/worker/plugin-runtime.ts:123`) | Keeping variants in step with products |
| API-8 | Per-plugin error isolation in `scheduled`, and a plugin job/enqueue API over the `job` table. An enqueue the plugin can put in its own `batch` would let the job commit with the change that causes it; without that, the shop keeps the outbox of §4.2 (found 2026-10-05) | One `try/catch` wraps all plugins (`mallok: src/worker/scheduled.ts:56-71`). There is no enqueue (`mallok: docs/PLUGIN_API.md §7.4`) | 5.5, email retries |
| API-9 | **Shipped in 0.1.0-rc.9.** Export the helpers official plugins already use (`escapeHtml`, the restricted Liquid text/email renderer) from `mallok/worker` | The inquiry plugin imports them from internals | Order email |
| API-10 | Third-party starter registration in `createMallok` | Starters are a compiled-in list (`mallok: src/starters/index.ts`) | Starter |
| API-11 | ~~An "always prefix" locale mode~~ — **not needed**: the unprefixed default language is accepted (§11 decision 1) | | |
| API-12 | ~~A translation-completeness view and admin roles~~ — **deferred**: one administrator is accepted for now (§11 decision 7) | | |
| — | A way for `renderData` to add to the page's structured data: the plugin's `offers` merged into the core's own Product node in `page.head` | The core builds the Product JSON-LD itself and emits it inside `page.head` (`mallok: src/core/view.ts`, `contentJsonLd`, `buildHeadTags`). A theme cannot emit a JSON-LD block of its own: the script check rejects any `<script` in a theme's templates, data blocks included (`mallok: src/core/theme-package.ts`, `SCRIPT_TAG`). So API-1 alone puts the price on the page but leaves it out of the structured data. Found 2026-10-05 | 5.1 |
| — | Close the theme script-validation gap: once a theme declares any `clientScripts`, `assertNoUndeclaredScripts` stops scanning its templates, so undeclared `<script>` and `on*=` pass (`mallok: src/core/theme-package.ts:262-264`) | The commerce theme declares the currency-switch script and would otherwise bypass every script check | 5.1 |
| — | Resolve `reference[]` fields in `content.refs` and `content.backrefs` | Only `reference` is resolved (`mallok: src/worker/render.ts:386,406`); a `reference[]` reaches a template as bare slugs | A product in more than one collection (§4.1) |
| — | **Shipped in 0.1.0-rc.9.** Supply `recent.<kind>` on the home page for every kind, as `THEME_FORMAT.md §7.4` documents | The Worker's home page loads articles only (`mallok: src/worker/pages/home.page.ts`); the static build supplies every kind, so the two paths disagree | Products and application notes on the home page |
| — | **Shipped in 0.1.0-rc.9.** Publish every language of one bundle into one translation group | The CLI posts each language without a group when the bundle has no `mallok.json`, and the server assigns a new group each time (`mallok: src/cli/publish.ts`) — against `CONTENT_FORMAT.md §2` rule 1 | Hand-written multilingual content. The `mallok.json` files added as a workaround were removed again after the upgrade |
| — | **Shipped in 0.1.0-rc.9.** Site template gaps: no type declarations for text-module imports; no `MALLOK_SETUP_KEY` in `.dev.vars.example`; `mallok publish . --with-settings` scans `node_modules` and resolves kinds before applying the settings | Found while building this site from the template | Developer experience |

Client JavaScript: add-to-cart, cart and checkout need none (§5.2). The only script is the currency switch (§5.1), which the theme declares through the existing `clientScripts` mechanism. A third-party theme may declare scripts as long as the admin shows them (`mallok: docs/THEME_FORMAT.md §9`), so Mallok's contract needs no new exception, only the validation fix in the last row.

The owner carries out this Mallok work in the Mallok project from a separate task list (M0 to M11), which maps one-to-one onto the rows above.

These changes raise the plugin contract version (`pluginApi`), and Mallok's own docs need two corrections:
- The "no new concept" line in `PRODUCT_VISION.md §9`.
- The "not a Mallok starter" wording about Nundar in `RELEASE_GATE.md §15.1` and `ARCHITECTURE.md §15`, which contradicts the product contract.

## 8. What happens to the current code

| Current module | Fate |
|---|---|
| `src/lib/money.ts`, `src/lib/orders/state.ts`, `src/lib/stripe/webhook.ts`, `src/lib/stripe/client.ts` | Port unchanged; they are pure and already use `fetch`, not an SDK. **Done** (phase 1A and §14); what review changed on the way is listed in §14 |
| `src/lib/pricing*`, `src/lib/cart/pricing.ts`, `src/lib/orders/orders.ts`, `src/lib/orders/admin.ts` | Port the logic; rewrite data access from Drizzle to raw SQL; move payment writes to one batch (§5.4). **Done** (phase 1A and §14) |
| `src/lib/cart/cart.ts`, `cookie.ts` | Rewrite for D1 and the path-scoped cookie. **Done** (phase 1A) |
| `src/lib/email/templates.ts` | Rewrite as plugin email content. **Done** (§14), as code with Mallok's `escapeHtml`, which is how Mallok's own inquiry plugin builds its emails. Operator-editable Liquid overrides come with the settings that would hold them |
| `src/lib/seo/jsonld.ts` | The Offer part moves into the render-data hook; Product and BreadcrumbList come from Mallok |
| `src/lib/storefront/i18n.ts` | Becomes the commerce theme's `locales/*.json` |
| `src/lib/seo*`, sitemap, robots, locales config, `src/lib/markdown.ts`, `src/lib/media/*`, `src/lib/auth/*`, `src/lib/admin/*`, `src/lib/settings/*` | Dropped: Mallok core provides them. The security contact becomes a Mallok core proposal |
| `src/themes/*` (React) | Rewritten as a new Liquid commerce theme (§11 decision 4) |
| `src/app/*`, `src/components/*`, `src/worker.ts`, `open-next.config.ts`, the Durable Objects, KV | Dropped |
| Tests for the ported logic | Ported first. They are the safety net for the invariants in §2 |

The Next.js application stays in maintenance mode, with security and correctness fixes only, until phase 2 reaches parity.

## 9. Phases

The phases follow Mallok's own roadmap (`mallok: docs/PRODUCT_VISION.md §9`: 0.2 inquiry cart, 0.3 payment, 1.0 storefront). Nundar was started on the published `mallok@0.1.0-rc.7`, is on `0.1.0-rc.9` now (§12), and moves to the Mallok release that carries the P0 extension points once the owner publishes it (§11 decision 8).

**Phase 0: decisions, no code**
- §11 is answered (2026-10-01).
- Reconcile the organisation's planning documents that still describe a separate page-runtime package and a standalone Nundar stack.
- The Mallok wording corrections in §7 are part of the Mallok task list.

**Phase 1: catalogue with variants, and an RFQ cart (Mallok 0.2)**
- Mallok: API-1, 2, 3, 4, 6 (forms and repeatable rows), 7 and 9.
- Shop plugin:
  - variants, USD base plus derived prices, MOQ and lead time;
  - the cart;
  - submitting the cart as one inquiry, which is Mallok 0.2's "inquiry cart".
- The commerce theme.
- *Exit criteria*:
  - add-to-cart works with JavaScript disabled;
  - MOQ is enforced server-side, with a test that bypasses the form;
  - Offer JSON-LD equals the rendered price;
  - a price change purges exactly the affected pages;
  - cold product render p50/p95 CPU and D1 round trips are measured on a real Free account.

**Phase 2: payment (Mallok 0.3)**
- *Built ahead, 2026-10-05 (§14):* everything below that needs no Mallok extension point — the order tables, placing an order, the payment batch, refunds, the webhook's decision, the Stripe calls and the order emails. Not built: every route, page and admin screen.
- Mallok: API-5, 6 (actions with parameters) and 8.
- Shop plugin:
  - Stripe Checkout and the webhook;
  - orders and stock;
  - order email;
  - ECB repricing across EUR and GBP.
- *Exit criteria*:
  - the webhook tests for signature, replay, race and oversold are ported and pass red/green;
  - the `CHECK`-in-batch rollback is proven in workerd;
  - a Stripe test-mode purchase runs end to end on a real account;
  - Free-plan quotas are checked against a day of synthetic traffic.

**Phase 3: full storefront (Mallok 1.0)**
- Mallok: API-10.
- Nundar:
  - customer view and sales dashboard as panels;
  - a second theme;
  - the starter;
  - a migration from the Next.js schema if any real shop data exists, with 301 redirects from the old `/en/*` URLs to the unprefixed ones (§11 decision 1);
  - retiring the Next.js code.
- *Exit criteria*: parity with the feature list in the current README, item by item.

## 10. Risks

- **Mallok's maturity.**
  - 0.1.0-rc.6 is on npm and rc.7 is packed locally.
  - Real-platform gates are `NOT_RUN` or `STALE` (`mallok: docs/RELEASE_STATUS.md`).
  - It has one maintainer.
  - Commerce inherits all of this.
- **Contract growth.** API-1 to API-10 widen a public plugin contract before it has third-party users. Each needs its own tests and a version bump.
- **CPU.**
  - Mallok already measures 60–726 ms for rendering on save and p95 35 ms on cache misses, against a 10 ms Free budget (`mallok: docs/ARCHITECTURE.md §18`, `docs/RELEASE_STATUS.md`).
  - Commerce adds a query to every product page.
  - Measure before claiming Free-plan fitness.
- **Purge limits.** Frequent availability changes on many products at once can hit the 5 requests per minute cap. The mitigation is state-only purging and batching; the fallback is purging the kind tag.
- **Rebuild cost.** Everything outside the ported logic is rewritten, and features can regress in the transition. The phase exit criteria exist to catch that.

## 11. The owner's decisions (2026-10-01)

1. **URLs.**
   - Decision: accept Mallok's unprefixed default language, and make English the default.
   - English lives at `/products/x`; other languages carry a prefix (`/de/products/x`); `x-default` points at the English page.
   - Any existing deployment of the Next.js version serves `/en/…`, so moving it needs 301 redirects from `/en/*` to `/*` (phase 3).
2. **Currency.**
   - Decision: English pages default to USD; German, French and Spanish pages default to EUR.
   - Every page has a currency switch button (§5.1).
3. **Features and non-promoted use cases.**
   - Decision: features and non-promoted use cases are sections in the product body, and only use cases are promoted to their own pages (`application`).
   - Attribute queries are served by `collection` pages when needed (§4.1).
4. **Theme.**
   - Decision: a new commerce theme, not an extension of Atelier.
5. **Distribution.**
   - Decision: source copied into a site's `src/plugins/shop/` and `src/theme/`, which is Mallok's layout today.
   - This is the Astro pattern of starting from a template repository with local integrations. Astro's standard for integrations is an npm package, but local integrations are supported.
   - The trade-off: upgrading the plugin or theme means copying new source, not bumping a version.
   - The Nundar repository therefore becomes a Mallok site that carries the shop plugin, the commerce theme and sample content.
6. **Stock display.**
   - Decision: availability states only (§5.1).
7. **Roles.**
   - Decision: one administrator for now; roles and sub-administrators are deferred.
8. **Timing.**
   - Decision: Mallok is published (`0.1.0-rc.7` on npm, `latest`).
   - The owner implements the Mallok extension points in the Mallok project from a separate task list; Nundar work starts now against that plan.

## 12. What phase 1A changed or found

Recorded here rather than edited away, so a later reader can see what the design said, what the build found, and why they differ.

**Phase 1 is split in two.** Phase 1A is everything that can be built on `mallok@0.1.0-rc.7`: the site skeleton, the plugin's data layer and logic, the add-to-cart route, the theme, the sample content, the tests and the documentation. Phase 1B is what needs Mallok's extension points: prices on pages, the cart page, editing variants in the admin, the inquiry cart. Nothing in 1A works around a missing extension point.

**npm, not pnpm.** Mallok's CLI installs and upgrades with npm only and refuses a project carrying another lockfile (`mallok: docs/CLI.md §3.1`).

**The currency switch moved to phase 1B.** Its script swaps prices that are already in the page, and no prices are in the page until the render-data hook exists. Written now, it would have nothing to act on and could not be tested.

**System fonts.** The theme fetches nothing to draw text. The previous storefront's typeface would mean bundling font files, which is a separate decision. *That decision was taken on 2026-10-05: the fonts are bundled (§15).*

**Repricing was restructured, not just ported.** The previous loop read and wrote every price in its own query. On a real catalogue that passes D1's limit of 50 queries per invocation on the Free plan, and it does not fit a cron tick whose CPU budget every plugin shares. It now reads one batch and writes one statement per chunk, and resumes from a cursor across ticks. A test counts the round trips.

**Three Mallok behaviours differ from its documentation**, each listed in §7: `reference[]` is not resolved, the home page receives articles only, and the CLI splits a bundle's languages across translation groups.

**After the upgrade to `mallok@0.1.0-rc.9`** (2026-10-05). Mallok fixed the home page, the translation groups and the site template, and exported the plugin helpers. Each workaround here was removed and the fix proven in this repository rather than assumed:

- The local text-module declarations are gone, and the type check passes on the package's own.
- `scripts/apply-settings.mjs` is gone. The end-to-end smoke run applies `site.json` and publishes with `mallok publish . --with-settings`, from the repository root.
- The identity files added to the application, collection and contact bundles are gone. The smoke run still asserts that the application note's four languages share one translation group.
- The home page tests assert that products, application notes and collections appear, in each language's own home page.

Still open in Mallok, and so still shaping this code: the render-data hook, plugin pages through the theme, editable admin panels, the content save and delete hooks, raw-body routes, and `reference[]`.

## 13. How this design was checked

- **Mallok claims** were read from source and docs at `0af520b`. Four limits were confirmed in code:
  - body pre-parsing;
  - no DB in `afterRender`;
  - the uncalled `onContentSave`;
  - the no-frontend-code rule.
- **Cloudflare quotas and D1 batch semantics** were read from Cloudflare's documentation on 2026-09-30:
  - Workers limits;
  - D1 `batch()`, limits and pricing;
  - KV limits;
  - cache purge availability.
- **Claims about the previous implementation** were read from the Next.js code, now at the tag `nextjs-final`.
- **D1 batch behaviour** was tested in workerd during phase 1A: a `CHECK` failure rolls the batch back, and a conditional `UPDATE` matching no row does not fail it.
- **Not verified:**
  - Mallok's CPU figures, which are its own single measurements;
  - the behaviour of any Mallok change proposed in §7, none of which exists yet.


## 14. What the payment core changed or found (2026-10-05)

Phase 1B waits for Mallok. In the meantime the part of phase 2 that needs nothing from Mallok was built: `migrations/0002_orders.sql` and, in `lib/`, `orders.ts`, `order-fulfilment.ts`, `outbox.ts`, `order-guard.ts`, `availability.ts`, `stripe-signature.ts`, `stripe-client.ts`, `stripe-webhook.ts` and `order-email.ts`. **Nothing in the deployed Worker calls any of it yet**: there is no checkout route, no webhook route and no admin screen. It is logic and tests, waiting for its routes.

**What review changed while porting.** The previous code was the starting point, not the result.

- *The payment is one batch.* The previous `markOrderPaid` decremented line by line, put stock back by hand when a later line failed, and wrote the order and the event in separate statements. A crash between two of them left stock taken for an order that was not paid. Now the writes commit together or not at all, and the cost is two round trips whatever the number of lines.
- *Oversold is decided from the data, not from the error.* When the batch fails, the code does not read a reason out of the error message; it reads the payment, the order and the stock again and acts on what is true. The message's wording is not a contract.
- *Every write is conditional on the order's status.* Two deliveries racing each other both read "pending"; the second one's batch then finds the order already paid and writes nothing. The previous code had no such guard, and two near-simultaneous deliveries could both decrement. Tests deliver in parallel and prove one decrement.
- *One payment is one payment, whatever the event id.* Stripe documents that two events can be sent for one object, to be told apart by the object's id and the event's type. A second event for a payment already on record is answered and not acted on; the previous code refused it as an illegal transition and answered 5xx, for three days.
- *Made-to-order lines take no stock.* `stock_policy` did not exist before. Without the distinction, a made-to-order variant's zero stock would fail the constraint and every such order would be marked oversold.
- *Order numbers are longer.* Six hexadecimal characters are 24 bits: at a thousand orders a day, two would collide about once a month, and a collision is a failed checkout. Eight characters of Crockford's base 32 are 40 bits, and the alphabet has no I, L, O or U.
- *The signature header is parsed strictly.* The timestamp is digits and nothing else; `123=x`, `1e9` and `0x10` were all read as numbers. Reading only `v1` signatures, as Stripe's documentation asks, is unchanged, and a test now holds it.
- *A lead time is stated only when every line has one*, and is the slowest of them. The previous template could print one, but nothing supplied it.
- *A Stripe answer that is not JSON* — an outage page from a proxy — is reported as a failure with its status, instead of surfacing as a parse error.
- *`createPaymentIntent` was not ported.* The shop uses Stripe's hosted Checkout (2026-09-03 §13), and nothing called it.

**What an independent review then found.** The code was given to a second reviewer with the properties it must hold and no account of how it holds them. The transaction logic stood. Five defects did not, and each was fixed with a test that fails without the fix:

1. *The webhook answered 5xx for things no retry could fix.* A payment naming an order this database does not have — the ordinary case for a second shop, a staging copy or a local listener on the same Stripe account — and a payment for a cancelled order both failed for three days, and the second left no trace in the database of money that had been taken. Now the first answers 200, and the second is recorded as `refused` with an outbox row naming the payment to refund.
2. *What follows a payment could be lost for good.* The confirmation email was to be sent after the payment's batch, on the strength of its return value. A Worker stopped between the two, or a batch whose answer never came back, left an order paid and its email never sent — and every later delivery of the event saw "already processed". The outbox (§4.2) closes this: the duty is written with the payment.
3. *An order with a total of zero could never be paid.* Stripe creates no payment intent for a free Checkout session, so the event the shop waits for never arrives. `createCheckoutSession` now refuses a total that is not a positive whole amount; an order that costs nothing has to be confirmed without Stripe, which is left to the checkout route (below).
4. *Oversold was written on a stale reading.* Stock returned by another order's refund between the reading and the write still left the order marked oversold. The write is now conditional on the stock still being short, and the next reading pays the order.
5. *A fractional unit price could be stored.* 99.5 × 10 is a whole number, and only the product was checked. Each line is now checked on its own, and the money columns check their storage type. The same check went into the first migration — price, stock, minimum order and cart quantity — by editing it in place: nothing had been deployed from it, and a `CHECK` cannot be added to an existing table afterwards.

A second pass over the reworked code found nothing against those properties, and three smaller things. *A payment whose write lost the stock for a moment was given up on*: stock taken just before the batch and returned just after left the next reading calling for the same write, which the code refused to repeat; it is now tried once more. *The outbox handed rows out by timestamp*, and a timestamp is supplied by whoever makes the change: three changes carrying the same one came back as delivered, paid, shipped. Rows now carry a sequence. *A payment on record under one order and reported again naming another* is answered as a duplicate, and the answer names the order in the event rather than the one the payment was recorded under; the checkout cannot produce this, since one order has one payment intent, and it is left as it is.

The first review also pointed out that Stripe's failure message is free text, that nothing rules out its repeating a value that was sent, and that one value sent is the buyer's email address. Whether it does could not be confirmed from Stripe's documentation, so errors are now built from Stripe's identifiers (type, code, parameter name) and the status, never from its free text.

**What was checked against current documentation** (2026-10-05): Stripe's manual signature verification, its retry schedule, its guidance on duplicate events, the Checkout Session and Refund parameters used here, how idempotency keys behave, no-cost orders, and the shape of its error object; Cloudflare D1's limits. D1's documentation gives 50 queries per invocation on the Free plan and does not say how the statements inside a `batch()` are counted, so nothing here assumes a batch is free: confirming a payment is ten statements in two round trips however many lines the order has, and placing an order is two statements in one.

**How it was verified.** 150 new tests inside workerd, against the site's own Worker and Mallok's migrator. Then 100 guards were broken one at a time — the signature check, the tolerance, each status condition, the made-to-order filter, each outbox row, each escape in the emails, each constraint in the migration — and every one turned a test red, including those that can only be seen when two calls run at the same moment. Two further type checks, on an order's subtotal and its shipping, cannot be told apart by any test — the total has to equal their sum, so either one catches what the other would — and are tested as a pair.

**Left open, for when the routes are built.** None of these is decided here.

1. *Nothing reads the outbox yet.* The rows are written; carrying them out — sending the email, purging, telling a person about a refund that is due — belongs with the routes and the cron step that will drain it, and with the choice of who is told. A row does not say which products' availability changed, so a consumer working from the row alone purges every product on the order.
2. *A payment for a cancelled order* is recorded for a refund. Better that it could not happen: cancelling an order should expire its Checkout session.
3. *Orders that are never paid stay `pending`.* Stripe sends `checkout.session.expired`; acting on it would cancel them.
4. *Orders that cost nothing.* The checkout route must confirm them without Stripe. There is no function for that yet.
5. *Stripe's Adaptive Pricing* shows a buyer their local currency at Stripe's own rate. The shop prices each currency itself (§5.5), so the two overlap; whether to switch it off per session is a decision.
6. *The amount is not cross-checked.* The event's amount and currency are not compared with the order's. With Adaptive Pricing they can legitimately differ, which is why this waits for item 5.
7. *The cart is not emptied after payment.* An order does not record which cart it came from.
8. *Refunds.* The action must refund at Stripe first and record it second. Stripe keeps an idempotency key, with the answer it gave — a 5xx included — for at least 24 hours; after that a retry is refused as already refunded, which the action has to treat as done. The same holds for opening a Checkout session, whose key is the order: an order whose first attempt Stripe failed cannot open a session for a day, and the buyer has to place a new one. And a refund returns the stock the payment took even when the order has shipped: right if the goods come back, wrong if they do not.
9. *`oversold → cancelled`* is a legal move, and it leaves a payment that was taken with no order to refund it from.
10. *The Stripe API version is not pinned.* The two calls run on whatever version the account defaults to.
11. *Email settings.* In `mallok@0.1.0-rc.9`, `ctx.sendEmail` uses the calling plugin's own Resend key and sender address. Mallok is adding site-level email settings, which are not in a release yet; with them the shop plugin declares neither, and until then it would need its own.
12. *The order-number prefix* is `ND-`. A shop may want its own.
13. *A payment naming an order this database does not have leaves no record*, only the outcome a route will log. That is right for a second shop on the same Stripe account, and wrong for a database restored from an old backup: real payments would be answered 200 and forgotten. Recording them all would fill the table with another shop's payments; whether to is undecided.
14. *A variant deleted outright* is skipped by the payment write: the order is paid, and nothing is decremented or written to the ledger for that line. Nothing deletes variants today — they are archived — and whatever first does has to deal with this.

## 15. What the sample theme changed or found (2026-10-06)

Phase 1A's theme proved the contracts with one product, one application note and one collection. The owner then supplied a complete design for a titanium fastener supplier, as a React single-page application, to become the theme and the sample catalogue. This section records what that changed in this design. The work itself, and how it was verified, is in `docs/superpowers/plans/2026-10-06-sample-theme-titanium-fasteners.md`. The shop plugin is untouched.

**What was decided, by the owner, before the work (2026-10-05).** The new design replaces the theme and the sample rather than sitting beside them as a second theme. The template's images are copied into the repository rather than linked. The fonts are files in the theme rather than a request to a font service. Interactive pieces are HTML first, with any script a small, declared addition to a page that works without it, built last and separately so that it can be left out.

**A product is one page with its sizes on it.** The template listed nine SKUs as nine products; four of them were one screw in four lengths. Nine pages differing by a number are the near-identical pages §4.1 exists to avoid, so there are six products, and a product's `sizes` field lists its SKUs. The shop plugin already keys variants by the product's translation group, so one variant per SKU attaches to the right page with no change to it; `test/content.test.ts` holds the seed to the SKUs the pages list.

**The model grew by three kinds and two fields.**
- `case` — a case study: a sector, a `reference` to the product used, and the measured results as `keyvalue`. The product page lists the case studies that name it, exactly as it lists application pages.
- `faq` — questions and answers. Mallok normalises the pairs and publishes them as `FAQPage` data; the layout prints every pair, and the list page gathers every topic's pairs.
- `tool` — an engineering reference page. A kind of its own so that such pages have their own address and list, and so that an interactive version of one has a layout to attach to.
- `facets` and `sizes` on `product`, described in §4.1.

Nothing here is commerce logic, and none of it needs a Mallok change: all of it is `theme.json`, which is where §11 decision 4 put the theme's kinds.

**The site's words left the theme.** Every reader-facing sentence that belongs to this supplier rather than to any shop — the headline, the selling points, the panels, the footer — is a theme option, with a value per language under `themeOptions.$locales` in `site.json` (`mallok: docs/THEME_FORMAT.md §7.7.1`). The theme's language packs hold only its own vocabulary. `test/project.test.ts` fails when a language is left without a value.

**The fonts are bundled, which supersedes §12's "system fonts".** Inter, Space Grotesk and JetBrains Mono, each as two `woff2` subsets (Latin, Latin Extended), 218 kB in all, of which the two files preloaded on every page are 71 kB. They are the files the template asked a font service for, fetched once and served by the site, under the SIL Open Font License 1.1; `src/theme/assets/fonts/` carries the licence texts and each file's source and SHA-256. The theme still asks no other host for anything.

**No script yet.** The template's finder filters and its three calculators are interactive. As built here, the finder is the complete table and the calculators are a reference page of formulas, constants and tables, so every page is whole without JavaScript, as §5.2 requires of the cart. The two scripts the owner approved are a separate change on top of this one. The template's quote list is the cart, and waits with the cart page for §7.

**What it found in Mallok.** Five behaviours, none blocking, each in the task list handed to Mallok and each handled meanwhile inside the documented contracts:

| Found | Meanwhile |
|---|---|
| The inquiry form has labels in English and Chinese only | German, French and Spanish contact pages show English labels |
| The site tagline, and so the home page's description, is one string for all languages | Two theme options, `tagline` and `home_description`, with values per language |
| A kind with an address and no list layout answers that address with 500 | Every kind with an address has a list layout |
| A template cannot link to its kind's list page | Breadcrumbs go from the home page to the page; the link from the home page's finder to the full catalogue is a theme option |
| Locally, toggling a plugin or changing settings leaves cached pages as they were | The plugins are switched on before the first publish; the README says so |

**What review found.** An independent review of the finished theme confirmed twenty-three defects, none of them in what a crawler indexes, most of them in what happens off the path the sample walks: a language whose words are longer, a width between a phone and a laptop, an option left empty, a field left out. The plan lists them. Two rules came out of it that now have tests behind them: a template prints a wrapper only when it has something to put in it, and a layout is not finished until it has been measured in the longest language at every width.

**Left open.** The sample's own contradictions, inherited from the template and listed in the plan; whether the images may be published under this repository's licences; a browser test for what only a browser shows; a pass with a screen reader; measurements on a deployed site.
