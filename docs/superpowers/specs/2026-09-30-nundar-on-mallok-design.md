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

**`application`**
- A Nundar use case that has been promoted to its own landing page.
- Fields:
  - `product` (`reference` to `product`)
  - `spec_highlights` (`keyvalue`)
- Each language is its own row with its own slug, joined by `translation_group`, which replaces Nundar's `group_key`.
- Publishing an `application` is what gives it a page, which replaces `has_own_page`.

**Features, and use cases not promoted to a page**
- These are sections of the product's Markdown body (§11 decision 3).
- Features stay on the product page on purpose. They strengthen the product page itself for attribute queries, while per-product feature pages would multiply near-identical pages across products, which Google's spam policies treat as doorway abuse.

**`collection` (attribute collection page)**
- One page per attribute that buyers search for, such as "high-temperature ball valves", listing every product that has it, with its key parameters for comparison.
- Fields: `products` (`reference[]` to `product`), `summary`.
- This is how attribute queries are won: a browseable hierarchy across products rather than a page per product. It needs no Mallok change.

### 4.2 Shop plugin tables

All shop tables are language-independent and keyed by the product's `translation_group`. Migrations use raw SQL, because Mallok uses no ORM (`mallok: docs/TECH_STACK.md §7`).

```sql
p_shop_variant(id, product_group, sku UNIQUE, option_values JSON, moq, lead_time_min, lead_time_max,
               stock INTEGER NOT NULL CHECK (stock >= 0), weight_grams, status)
p_shop_price(variant_id, currency, amount_minor, source,  -- base | auto | manual
             rate_used, updated_at, PRIMARY KEY (variant_id, currency))
p_shop_rate(base, quote, rate, fetched_at, source, PRIMARY KEY (base, quote))
p_shop_cart(id, currency, locale, created_at, updated_at, expires_at)
p_shop_cart_line(cart_id, variant_id, quantity, PRIMARY KEY (cart_id, variant_id))
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
- **Must be proven by a workerd test before it is relied on.**

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

The route is `POST /_mallok/p/shop/stripe/webhook`. It needs the raw request body (§7 API-5).

1. Verify the signature over the raw body. This is `src/lib/stripe/webhook.ts`, ported unchanged.
2. If `p_shop_stripe_event` already has the event, answer 200 without acting.
3. Run one batch:
   - insert the event;
   - decrement each line's stock;
   - write the stock adjustments;
   - move the order `pending → paid`.
4. The batch can fail in two ways:
   - **On a `CHECK` failure**, a second batch inserts the event and marks the order `oversold`, and the response is 200 so Stripe stops.
   - **On a primary-key conflict on the event**, a concurrent delivery won the race; answer 200.
5. After success, queue the confirmation email in `orders.locale` through `ctx.sendEmail`, and purge affected product tags only when their availability state changed.

A genuine failure answers non-2xx so Stripe redelivers (2026-09-03 §8).

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
| API-8 | Per-plugin error isolation in `scheduled`, and a plugin job/enqueue API over the `job` table | One `try/catch` wraps all plugins (`mallok: src/worker/scheduled.ts:56-71`). There is no enqueue (`mallok: docs/PLUGIN_API.md §7.4`) | 5.5, email retries |
| API-9 | Export the helpers official plugins already use (`escapeHtml`, the restricted Liquid text/email renderer) from `mallok/worker` | The inquiry plugin imports them from internals | Order email |
| API-10 | Third-party starter registration in `createMallok` | Starters are a compiled-in list (`mallok: src/starters/index.ts`) | Starter |
| API-11 | ~~An "always prefix" locale mode~~ — **not needed**: the unprefixed default language is accepted (§11 decision 1) | | |
| API-12 | ~~A translation-completeness view and admin roles~~ — **deferred**: one administrator is accepted for now (§11 decision 7) | | |
| — | Close the theme script-validation gap: once a theme declares any `clientScripts`, `assertNoUndeclaredScripts` stops scanning its templates, so undeclared `<script>` and `on*=` pass (`mallok: src/core/theme-package.ts:262-264`) | The commerce theme declares the currency-switch script and would otherwise bypass every script check | 5.1 |

Client JavaScript: add-to-cart, cart and checkout need none (§5.2). The only script is the currency switch (§5.1), which the theme declares through the existing `clientScripts` mechanism. A third-party theme may declare scripts as long as the admin shows them (`mallok: docs/THEME_FORMAT.md §9`), so Mallok's contract needs no new exception, only the validation fix in the last row.

The owner carries out this Mallok work in the Mallok project from a separate task list (M0 to M11), which maps one-to-one onto the rows above.

These changes raise the plugin contract version (`pluginApi`), and Mallok's own docs need two corrections:
- The "no new concept" line in `PRODUCT_VISION.md §9`.
- The "not a Mallok starter" wording about Nundar in `RELEASE_GATE.md §15.1` and `ARCHITECTURE.md §15`, which contradicts the product contract.

## 8. What happens to the current code

| Current module | Fate |
|---|---|
| `src/lib/money.ts`, `src/lib/orders/state.ts`, `src/lib/stripe/webhook.ts`, `src/lib/stripe/client.ts` | Port unchanged; they are pure and already use `fetch`, not an SDK |
| `src/lib/pricing*`, `src/lib/cart/pricing.ts`, `src/lib/orders/orders.ts`, `src/lib/orders/admin.ts` | Port the logic; rewrite data access from Drizzle to raw SQL; move payment writes to one batch (§5.4) |
| `src/lib/cart/cart.ts`, `cookie.ts` | Rewrite for D1 and the path-scoped cookie |
| `src/lib/email/templates.ts` | Rewrite as plugin email templates (Liquid) |
| `src/lib/seo/jsonld.ts` | The Offer part moves into the render-data hook; Product and BreadcrumbList come from Mallok |
| `src/lib/storefront/i18n.ts` | Becomes the commerce theme's `locales/*.json` |
| `src/lib/seo*`, sitemap, robots, locales config, `src/lib/markdown.ts`, `src/lib/media/*`, `src/lib/auth/*`, `src/lib/admin/*`, `src/lib/settings/*` | Dropped: Mallok core provides them. The security contact becomes a Mallok core proposal |
| `src/themes/*` (React) | Rewritten as a new Liquid commerce theme (§11 decision 4) |
| `src/app/*`, `src/components/*`, `src/worker.ts`, `open-next.config.ts`, the Durable Objects, KV | Dropped |
| Tests for the ported logic | Ported first. They are the safety net for the invariants in §2 |

The Next.js application stays in maintenance mode, with security and correctness fixes only, until phase 2 reaches parity.

## 9. Phases

The phases follow Mallok's own roadmap (`mallok: docs/PRODUCT_VISION.md §9`: 0.2 inquiry cart, 0.3 payment, 1.0 storefront). Nundar builds on the published `mallok@0.1.0-rc.7` and moves to the Mallok release that carries the P0 extension points once the owner publishes it (§11 decision 8).

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

## 12. How this design was checked

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
- **Nundar claims** were read from the current `main`.
- **Not verified:**
  - Mallok's CPU figures, which are its own single measurements;
  - whether a zero-row `UPDATE` fails a D1 batch, which is why §4.2 uses a `CHECK` constraint instead;
  - the behaviour of any Mallok change proposed in §7, none of which exists yet.
