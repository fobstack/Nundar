# Nundar design specification

> An open-source commerce engine for cross-border trade, built on Cloudflare
> Status: design settled, ready for implementation planning
> Date: 2026-09-03

## 1. What this is

A **single-tenant, self-deployable** storefront for cross-border trade, running on the Cloudflare platform. The first instance is the author's own store; the project is published as an open-source template, so anyone can fork it, supply their own D1 / R2 / Stripe credentials, and run an independent copy. One codebase, one shop.

**Explicitly out of scope** — the boundary exists to stop the scope from creeping:

- No multi-tenant SaaS: no tenant_id isolation, no subscription billing, no platform-level admin
- No marketplace: no merchant onboarding, no settlement or revenue splitting
- No B2B quotation flow: the first version takes payment immediately, with no quotes and no payment terms

### 1.1 What makes it different

Against general-purpose open-source commerce platforms (Medusa, Saleor, Bagisto), this system's first-order goal is **acquiring traffic through long-tail search**, not completeness of transactional features:

1. Every product is a complete static page carrying its own multilingual SEO fields
2. Two kinds of structured long-tail content hang off each product — **features** and **use cases** — answering two different search intents
3. A use case can be *promoted* to a landing page of its own, so one product naturally yields N long-tail pages
4. Multiple languages are a first-class concern from day one, including translation-completeness management

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js (App Router) + TypeScript | SSR/ISR suit SEO; mature ecosystem |
| Deployment | `@opennextjs/cloudflare` → Cloudflare Workers | Cloudflare-native by requirement; edge distribution helps multi-country access |
| Styling | Tailwind CSS | No additional runtime cost |
| Primary database | Cloudflare D1 (SQLite) | Relational queries and transactions suit commerce logic |
| ORM | Drizzle | Good D1 support, type safe, migrations under version control |
| Object storage | Cloudflare R2 | Free egress; a free tier (10GB storage/month) |
| Cache / sessions | Cloudflare KV | Guest carts, admin sessions, rate-limit counters |
| Scheduled work | Cloudflare Cron Triggers | Daily rate fetch, triggering price recalculation |
| Payments | Stripe | The international default; cards, Apple Pay, Google Pay |
| Email | Cloudflare Email Routing / Email Service | Keeps external dependencies down and the stack Cloudflare-native |
| Validation | Zod | One validation path for every external input: forms, APIs, webhooks |
| Testing | Vitest + `@cloudflare/vitest-pool-workers` + Playwright | Tests run in the real Workers runtime, not a Node mock |

**Images**: the first version uses R2 alone, pre-generating the size variants it needs at upload time. Cloudflare Images, a separate paid product, is not used. If image volume grows or more flexible dynamic variants become necessary, migrating means changing one layer, because every access already goes through the same image URL service layer.

> To verify: how to resize images inside the Workers runtime (a WASM image library versus `fetch`'s `cf.image` options, and which plan each requires) must be checked against current Cloudflare documentation during implementation, not asserted from memory.

## 3. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ Next.js (App Router) on Cloudflare Workers (via OpenNext)     │
│  ├─ Storefront: /[locale]/...  static generation + ISR        │
│  └─ Admin:      /admin/...     dynamic SSR, session auth      │
├──────────────────────────────────────────────────────────────┤
│ D1   products / translations / features / use cases / SKUs /  │
│      prices per currency / orders / customers                 │
│ R2   product originals + pre-generated size variants          │
│ KV   guest carts / admin sessions / rate-limit counters       │
├──────────────────────────────────────────────────────────────┤
│ Cron    daily ECB rate fetch → threshold-gated price recalc   │
│         and static page regeneration                          │
├──────────────────────────────────────────────────────────────┤
│ Stripe  PaymentIntent + webhook-driven order state            │
│ Email   order confirmation / shipping notice / password reset │
└──────────────────────────────────────────────────────────────┘
```

**The admin and the storefront live in one Next.js application.** For a single tenant, splitting them into separate applications only buys a second build, a second deployment and a second auth path; sharing the type definitions and the data access layer is worth more. They are separated on disk by the `app/(storefront)` and `app/(admin)` route groups, so the boundary is already clear if a split ever becomes worthwhile.

## 4. Data model

### 4.1 How translation is modelled

Translated content always goes in its own translation table. **No `name_en` / `name_de` columns on the primary table.** Adding a language must not require a schema change — a necessary property for an open-source template, because every adopter needs a different set of languages.

The composite primary key is `(entity id, locale)`.

### 4.2 Tables

```sql
-- Products: language-independent data only
products(
  id            TEXT PRIMARY KEY,
  slug          TEXT UNIQUE NOT NULL,      -- used in URLs, shared across languages
  status        TEXT NOT NULL,             -- draft | active | archived
  primary_image_key TEXT,                  -- R2 object key
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
)

-- Product translations: display content and SEO metadata
product_translations(
  product_id    TEXT NOT NULL,
  locale        TEXT NOT NULL,
  name          TEXT NOT NULL,
  summary       TEXT,
  description   TEXT,                      -- Markdown
  seo_title     TEXT,
  seo_description TEXT,
  seo_keywords  TEXT,
  og_image_key  TEXT,
  canonical_override TEXT,
  PRIMARY KEY (product_id, locale)
)

-- Features: the "what is it like" family of long-tail terms
-- For example: high temperature resistant ball valve
product_features(
  id            TEXT PRIMARY KEY,
  product_id    TEXT NOT NULL,
  locale        TEXT NOT NULL,
  group_key     TEXT NOT NULL,             -- cross-language key, see 4.2.1
  sort_order    INTEGER NOT NULL,
  title         TEXT NOT NULL,
  body          TEXT,
  icon_key      TEXT
)

-- Use cases: the "where is it used" family of long-tail terms
-- For example: ball valve for offshore oil platform
product_use_cases(
  id            TEXT PRIMARY KEY,
  product_id    TEXT NOT NULL,
  locale        TEXT NOT NULL,
  group_key     TEXT NOT NULL,             -- cross-language key, see 4.2.1
  sort_order    INTEGER NOT NULL,
  scenario_title TEXT NOT NULL,
  scenario_slug TEXT,                      -- landing page URL segment, localised per language
  has_own_page  INTEGER NOT NULL DEFAULT 0, -- whether it gets a landing page
  body          TEXT,                      -- Markdown
  spec_highlights TEXT                     -- JSON: the parameters that matter for this use case
)
```

### 4.2.1 group_key: the cross-language identity of a content block

`product_features` and `product_use_cases` hold one row per language, and nothing in those rows relates them to each other. `group_key` is that relation: every language version of one feature or use case shares a `group_key`, backed by a unique index on `(product_id, locale, group_key)`.

**Why it has to exist** — a real defect hit while implementing phase 2. Use-case landing page slugs are localised per language (`offshore-seawater-lines` / `offshore-seewasserleitungen` / `circuits-eau-de-mer-offshore`). Without a cross-language key, the only way to build hreflang is to share one slug across all languages, which makes hreflang point at URLs that do not exist — pointing crawlers straight at dead links.

The same mechanism is what makes the translation workbench (7.2) able to measure completeness at all: without it there is no way to tell which German row corresponds to which English one.

**When a translation is missing**: if a language has no row for a `group_key`, that language is simply omitted from hreflang. Another language's slug is never substituted.

```sql

-- SKUs and their options
product_variants(
  id            TEXT PRIMARY KEY,
  product_id    TEXT NOT NULL,
  sku           TEXT UNIQUE NOT NULL,
  stock         INTEGER NOT NULL DEFAULT 0,
  weight_grams  INTEGER,
  option_values TEXT NOT NULL,             -- JSON: {"size":"XL","color":"black"}
  moq           INTEGER NOT NULL DEFAULT 1, -- minimum order quantity, see 4.5
  lead_time_days_min INTEGER,              -- lead time floor, in business days
  lead_time_days_max INTEGER               -- lead time ceiling, in business days
)

-- Prices per currency: the base is entered by hand, the rest are derived,
-- and any of them can be overridden (see 4.4)
variant_prices(
  variant_id    TEXT NOT NULL,
  currency      TEXT NOT NULL,             -- ISO 4217
  amount_minor  INTEGER NOT NULL,          -- the effective price, as minor units
  source        TEXT NOT NULL,             -- base | auto | manual
  rate_used     REAL,                      -- rate an auto row was computed at, for drift comparison
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (variant_id, currency)
)

-- Rate snapshots, refreshed daily by the cron trigger
exchange_rates(
  base_currency   TEXT NOT NULL,           -- USD
  quote_currency  TEXT NOT NULL,           -- EUR | GBP
  rate            REAL NOT NULL,
  fetched_at      INTEGER NOT NULL,
  source          TEXT NOT NULL,           -- ecb
  PRIMARY KEY (base_currency, quote_currency)
)

-- Product images
product_images(
  id            TEXT PRIMARY KEY,
  product_id    TEXT NOT NULL,
  object_key    TEXT NOT NULL,             -- R2 key of the original
  alt_locale    TEXT NOT NULL,             -- alt text is stored per language
  alt_text      TEXT NOT NULL,             -- the admin requires it
  sort_order    INTEGER NOT NULL
)

-- Orders
orders(
  id            TEXT PRIMARY KEY,
  order_no      TEXT UNIQUE NOT NULL,      -- the public, human-readable number
  customer_id   TEXT,
  status        TEXT NOT NULL,             -- see the state machine
  currency      TEXT NOT NULL,
  subtotal_minor INTEGER NOT NULL,
  shipping_minor INTEGER NOT NULL,
  tax_minor     INTEGER NOT NULL,
  total_minor   INTEGER NOT NULL,
  stripe_payment_intent_id TEXT UNIQUE,
  shipping_address_json TEXT NOT NULL,
  locale        TEXT NOT NULL,             -- the language it was placed in, for notifications
  tracking_no   TEXT,
  created_at    INTEGER NOT NULL
)

-- Order lines are snapshots: renaming or repricing a product leaves history alone
order_items(
  id            TEXT PRIMARY KEY,
  order_id      TEXT NOT NULL,
  variant_id    TEXT NOT NULL,
  sku_snapshot  TEXT NOT NULL,
  name_snapshot TEXT NOT NULL,
  unit_price_minor INTEGER NOT NULL,
  quantity      INTEGER NOT NULL
)

-- Webhook idempotency
stripe_events(
  event_id      TEXT PRIMARY KEY,          -- the Stripe event id, unique
  type          TEXT NOT NULL,
  processed_at  INTEGER NOT NULL
)

-- Inventory movements, for audit
inventory_adjustments(
  id            TEXT PRIMARY KEY,
  variant_id    TEXT NOT NULL,
  delta         INTEGER NOT NULL,
  reason        TEXT NOT NULL,             -- order_paid | manual | refund | oversold_fix
  ref_id        TEXT,                      -- the related order id, and so on
  created_at    INTEGER NOT NULL
)

-- Customers and addresses
customers(
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  default_locale TEXT,
  default_currency TEXT,
  created_at    INTEGER NOT NULL
)
customer_addresses(
  id            TEXT PRIMARY KEY,
  customer_id   TEXT NOT NULL,
  recipient     TEXT NOT NULL,
  line1 TEXT NOT NULL, line2 TEXT,
  city TEXT NOT NULL, state TEXT, postal_code TEXT NOT NULL,
  country TEXT NOT NULL, phone TEXT,
  is_default    INTEGER NOT NULL DEFAULT 0
)

-- Administrators
admin_users(
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL,             -- owner | staff
  created_at    INTEGER NOT NULL
)
```

### 4.3 The decisions that matter, and why

1. **Money is always an integer in minor units** (`*_minor`, cents), never a float. This is what avoids commerce's most classic accumulated-precision bug.
2. **Prices in other currencies are derived, and can be overridden.** Only the USD base price is entered by hand; EUR and GBP are converted from it. When a specific market needs its own price, a single currency can be overridden. See 4.4.
3. **Features and use cases are separate tables.** They answer different search intents (product attributes versus applications), and they differ in where they render, how they are marked up as structured data, and what qualifies one for its own page. Merged now, they would have to be split later.
4. **Order lines are snapshots.** Renaming, repricing or delisting a product must not change how a historical order reads — finance and support both depend on this.
5. **Image alt text is stored per language.** On a multilingual site alt text is a ranking signal too, and one English alt shared across languages throws that away.

## 4.4 The pricing engine: a base price, derived conversions, and overrides

Maintaining 3 currencies × N SKUs by hand is not sustainable. The model:

```
Entered by hand: the USD base price, one number per variant
Computed:        EUR / GBP = USD × rate × (1 + buffer) → rounded to a price point
Optional:        a manual price for one variant in one currency, which then
                 never takes part in recalculation again
```

The three values of `variant_prices.source`:

| source | Meaning | On a rate refresh |
|---|---|---|
| `base` | The hand-entered base-currency price (USD) | Unchanged |
| `auto` | Derived from the base price | Recomputed when the threshold is met |
| `manual` | Priced by hand for that currency | Skipped; the entered value always stands |

### 4.4.1 Where the rates come from

The **European Central Bank's daily reference rates**: free, no API key, authoritative. Anyone who forks this can run it without registering for a third-party rates service, and that is the decisive reason for choosing it over a commercial API.

A Cloudflare Cron Trigger fetches them once a day into `exchange_rates`. ECB rates are quoted against EUR, so USD→GBP crosses through EUR.

> To verify: the current shape of the ECB feed and its update schedule, including that it does not publish on weekends or European holidays. Check the official data source during implementation. On a failed fetch the previous snapshot is kept and an alert is raised; a failure must never distort prices.

### 4.4.2 Price stability (a hard constraint)

**Rates update daily; prices do not.**

A price is recomputed only when the current rate has drifted more than a **configurable 2% threshold** away from the rate that price was computed at (`rate_used`). Only then are the affected static pages regenerated.

Three reasons, any one of which is enough to rule out recomputing daily:

1. Product pages are statically generated, so a daily price change means regenerating all of them daily
2. If the price in a page's JSON-LD drifts from the price actually charged, Google Merchant raises price-mismatch warnings
3. Returning customers who watch a price move every day lose trust in it

### 4.4.3 The rate buffer

Automatic conversion carries a **buffer, 3% by default and configurable**. If USD/EUR falls from 0.92 to 0.88, converting a euro price back to dollars loses roughly 4% of margin. The buffer exists to absorb that movement and Stripe's cross-border fee.

### 4.4.4 Psychological rounding

A converted amount cannot go on sale as it comes out (`$99 × 0.92 = €91.08`). It is rounded by a configurable rule, by default **up to a `.99` ending** (€91.08 → €91.99); for industrial goods a whole-number ending can be configured instead. The rule is a configuration change, not a code change.

### 4.4.5 Consistency at checkout

Checkout uses `variant_prices` as of the instant the order is created and writes them into the `order_items` snapshot; the Stripe PaymentIntent amount comes from that snapshot. If a recalculation runs while someone is checking out, they still pay the price they were shown when they placed the order.

### 4.4.6 How the admin presents this

The price section of the product edit page has to make both the origin of a price and the freshness of its rate obvious:

```
USD  [ 99.00 ]  base price
EUR  [ 91.99 ]  ⟳ converted (rate 0.92 · buffer 3% · updated 2 days ago)  [override]
GBP  [ 79.99 ]  ✎ set by hand                                            [revert to automatic]
```

**Defaults**: a 3% buffer, a 2% recalculation threshold, rounding up to `.99`.

## 4.5 Minimum order quantity and lead time

Both are essential fields in cross-border trade, and both belong at the **variant (SKU) level** rather than on the product: minimums and lead times routinely differ between specifications, and a large-bore variant often has a lower minimum but a longer lead time. The admin offers "apply to all SKUs" so they need not be entered repeatedly.

**Deliberately not structured**: specification tables and certifications go into the product description as rich text. What needs displaying varies enormously between categories, and forcing a structure on it constrains how content can be expressed while adding data entry work.

### 4.5.1 The business rules around MOQ

An MOQ is not display copy. It has to be enforced, in three places:

1. **The product page**: the quantity selector starts at the MOQ and steps by it, so nobody can land on 73 units when the minimum is 50
2. **Add to cart**: a quantity below the MOQ is refused, and the message states that SKU's actual minimum
3. **Checkout**: validated again server-side, because the client-side check can be bypassed. Failing it refuses to create the order

`moq` defaults to 1, so an ordinary product with no minimum needs no configuration.

### 4.5.2 How lead time is presented

Stored as a range (`lead_time_days_min` / `lead_time_days_max`, in business days) and presented in three places:

1. The product page: `Lead time: 15–20 business days`, with numbers and wording localised per locale
2. Checkout: with several SKUs, the longest line's lead time becomes the order's estimate
3. The order confirmation email: an expected dispatch date, which cuts down on "where is my order" enquiries

The values are language-independent integers localised only at the display layer, so they need no translation table.

**SEO**: the product page's JSON-LD emits `deliveryLeadTime` on the `Offer`, which Google can use to show delivery information.

## 5. Rendering and SEO

### 5.0 Markets, languages and currencies

Target markets: **Europe and North America**.

| locale | Markets | Default currency |
|---|---|---|
| `en` (default, carries `x-default`) | US, UK, Canada, Australia | USD |
| `de` | Germany, Austria, Switzerland | EUR |
| `fr` | France, Belgium, French-speaking Canada | EUR |
| `es` | Spain, Latin America | EUR |

Supported currencies: **USD (base), EUR, GBP**.

- GBP stays separate from EUR: since Brexit, UK tax treatment and pricing conventions have diverged from the eurozone's
- Language and currency are decoupled: an `en` visitor can switch to GBP or EUR, and the choice is stored in a cookie
- Every currency's price is derived from the USD base price and can be overridden; see 4.4

The language list is configured in one place (`config/locales.ts`). Adding a language means adding a configuration entry and the translated content — no schema change and no routing change.

**A note on content cost**: four languages means every product needs its name, description, SEO metadata, features and use cases four times over. The translation workbench (7.2) exists precisely to manage that cost: it shows how complete each language is, so the versions do not quietly drift apart.

### 5.1 Routes

Languages use a path prefix rather than subdomains: authority stays concentrated on one site, and it is the simplest thing to configure on Cloudflare.

```
/[locale]/                                   home
/[locale]/products                           product list
/[locale]/products/[slug]                    product page
/[locale]/products/[slug]/[useCaseSlug]      use-case landing page (when has_own_page = 1)
/[locale]/collections/[slug]                 category page
/[locale]/cart  /checkout  /account          transactional and account pages
/admin/...                                   admin, with no locale prefix
```

### 5.2 Rendering strategy

| Page type | Strategy | Why |
|---|---|---|
| Home, product, use-case, category | Static generation + ISR | SEO pages must load instantly and be fully readable by a crawler; an admin edit triggers revalidation |
| Cart, checkout, account | Dynamic SSR / CSR | Private to one visitor and uncacheable |
| Stock and live prices | Static page patched on the client | See below |

**Patching stock on the client**: the stock number in a static page is guaranteed to go stale, which produces the worst possible outcome — the page says in stock, and checkout says otherwise. So the static page renders everything SEO needs (a crawler gets a complete page), and after hydration the client requests `/api/inventory?variants=...` and replaces the stock and price with live values. The crawler gets complete content; the visitor gets current data.

### 5.3 SEO foundations (complete in the first version)

- **hreflang**: every page emits `<link rel="alternate" hreflang="...">` for every language version plus `x-default`. Without it, Google treats the language versions as duplicate content.
- **canonical**: every page renders its own canonical. A use-case landing page's canonical points at itself, never at the product page — pointing it at the product page forfeits that page's ranking outright.
- **JSON-LD**: product pages emit `Product` + `Offer` (price, currency, availability) + `BreadcrumbList`; use-case landing pages emit `Product` + `Article` according to what the content is. This directly decides whether search results can show price and availability rich snippets.
- **Dynamic sitemap**: `/sitemap.xml` is an index over per-language `/sitemap-[locale].xml`, generated live from D1 with `lastmod`. Use cases with `has_own_page = 0` are not listed.
- **robots.txt**: blocks `/cart`, `/checkout`, `/account`, `/admin` and URLs carrying filter query parameters, so crawl budget is not spent on unbounded filter combinations.
- **Image SEO**: alt text is mandatory in the admin, and R2 object keys use the product slug rather than a random hash.

### 5.4 Language and currency switching (a hard constraint)

**Never redirect or switch language or currency based on IP.**

- The language is decided solely by the URL path prefix, which is the authoritative source
- The currency defaults to the current language's default, and the visitor can switch it; the choice is stored in a cookie
- `request.cf.country` may be used to show a "switch to XX?" banner, but must never redirect or rewrite content on its own

**Why**: Google's crawler generally fetches from US addresses. Redirecting by IP means the crawler only ever sees one language version, leaving every other language unindexed — it destroys the indexing of a multilingual site outright. This is the most common fatal mistake made by multilingual cross-border stores.

## 6. Transactions

### 6.1 The cart

A guest cart lives in KV, keyed by a random `cart_id` held in an HttpOnly cookie, with a 30-day TTL. Signing in merges it into that customer's account.

The cart stores **`variant_id` and quantity only, never a price**. Prices are always recomputed from D1 at checkout, which is what makes client-side price tampering impossible.

### 6.2 Checkout and payment

```
1. The buyer starts checkout
   → the server revalidates: is the product live, is there stock, does the
     quantity meet the MOQ, and recomputes the price from current D1 data
   → creates the orders row (status = pending)
   → creates a Stripe PaymentIntent, using the server-computed amount and
     never a value supplied by the client
   → returns the client_secret

2. Stripe Elements completes payment on the client (card details never reach
   this system's servers)

3. Stripe webhook (payment_intent.succeeded)
   → verify the webhook signature
   → idempotency check: is event_id already in stripe_events
   → conditionally decrement stock, set the order to paid, write
     inventory_adjustments
   → send the confirmation email in the language recorded on orders.locale

4. The admin ships → enters a tracking number → status becomes shipped →
   the shipping notice goes out
```

### 6.3 Four protections that must be implemented correctly

1. **The webhook decides order status, not the client redirect.** Browsers crash and connections drop right after payment all the time, so a client-side "payment succeeded" callback cannot be relied on. If the buyer reaches the success page while the order is still pending, the page shows "processing" and polls.

2. **The webhook must be idempotent.** Stripe retries delivery, and the same event may arrive several times. Deduplicate on the `stripe_events.event_id` primary key and return 200 for a repeat without acting on it. Without this, stock is decremented twice.

3. **Stock is decremented once payment confirms, not at add-to-cart or order creation.** Decrementing earlier lets anyone drain the catalogue with scripted orders. The decrement is a conditional update (`UPDATE ... WHERE stock >= qty`); if it fails, the order is marked `oversold`, enters a manual queue and triggers a refund. The trade is explicit: a small chance of overselling followed by a refund is preferable to having stock held hostage. (Rejected alternative: reserving stock for 15 minutes at order creation, which needs an additional cleanup job and is more complex.)

4. **Order lines are snapshots.** See 4.3.

### 6.4 The order state machine

```
pending ──→ paid ──→ shipped ──→ delivered
   │          │          │
   │          └──────────┴──→ refunded
   ├──→ cancelled
   └──→ oversold (paid, but the stock was gone; handled by hand)
```

Only the transitions above are permitted. Anything else is refused at the data access layer and logged.

## 7. The admin

### 7.1 Authentication

- Self-hosted accounts, hashed with Argon2id (a WebCrypto-compatible implementation, given the Workers runtime)
- Session tokens in KV, behind an HttpOnly + Secure + SameSite cookie
- Two roles: `owner` (settings and administrator management included) and `staff` (products and orders only)
- The login endpoint is rate limited through a KV counter, against brute force

### 7.2 Modules

| Module | What it does |
|---|---|
| Products | CRUD, the SKU/option matrix, USD base price plus converted prices (overridable per currency, see 4.4.6), MOQ and lead time (with apply-to-all-SKUs), stock adjustment written to the audit trail, publish and unpublish |
| Content and SEO | Per-language editing of name, description, SEO metadata, features and use cases; the `has_own_page` toggle; mandatory alt text; a search result preview |
| Images | Drag-and-drop upload to R2, size variants generated on upload, ordering, choosing the primary image |
| Orders | List and detail, shipping (a tracking number triggers the email), refunds through the Stripe API, the oversold queue |
| Customers | The customer list, order history, address book |
| Translation workbench | Source language against target language side by side, with untranslated fields and completeness marked |

**The translation workbench is not a nicety.** The real cost of a multilingual site is keeping N language versions in sync afterwards. Without this view, adding one use case leaves no way to know which languages have not followed, and over time the versions inevitably drift apart.

## 8. Error handling

- Every external call (Stripe, R2, email) handles failure explicitly, and retryable operations retry
- A failed webhook must return a non-2xx so Stripe redelivers
- Logs are scrubbed: customer emails, addresses and payment details never reach them
- User-facing errors must be actionable. "Something went wrong" is not acceptable
- Every external input passes Zod validation before reaching business logic

## 9. Testing

Coverage percentage is not the goal. Three layers, chosen by risk:

1. **Unit**: the pricing engine (rate conversion, buffer, psychological rounding, the recalculation threshold, and that manual rows are never overwritten), the stock decrement condition, the order state machine, and hreflang / JSON-LD / sitemap generation
2. **Integration** (the Workers test runtime against a local D1): the full order flow, server-side MOQ validation with the client check bypassed, webhook idempotency, and authorisation (can a customer read someone else's order, can staff reach owner-only functionality)
3. **End to end** (Playwright with Stripe in test mode): browse → add to cart → checkout → pay with a test card → order created

## 10. Preparing to open source (done alongside development, not afterwards)

- Every secret goes through `wrangler secret` or an environment variable, with nothing hardcoded in the repository, and a `.dev.vars.example` provided
- The README documents deployment from nothing: create the D1 database, create the R2 buckets, run the migrations, configure the Stripe webhook
- A `pnpm setup` script automates the above
- A seed script (a sample product with features, use cases and content in every language) so a fresh clone shows a working site
- The MIT licence, CONTRIBUTING.md, and issue templates

## 11. Delivery phases

| Phase | Contents |
|---|---|
| 1 | Project skeleton, D1 schema, migrations, seed data, a working deployment |
| 2 | Storefront browsing, multilingual routing, SEO foundations (static generation, hreflang, sitemap, JSON-LD) |
| 3 | Admin authentication, product / content / SEO / image management, the pricing engine (rate cron, conversion, overrides) |
| 4 | Cart, checkout, Stripe, webhooks, stock decrement |
| 5 | Order management, email notifications, customer accounts |
| 6 | Translation workbench, and the open-source engineering work (README, scripts, licence) |

## 12. Open questions

These must be checked against current official documentation during implementation, never asserted from memory:

1. What image resizing is available inside the Workers runtime, and which plan it requires
2. The current interface and deliverability limits of Cloudflare Email for transactional mail; if it falls short, the fallback is a transactional email service such as Resend
3. ~~How far `@opennextjs/cloudflare` supports ISR and on-demand revalidation~~ **Verified 2026-09-03**: fully supported. The mechanism is three parts — an R2 incremental cache (`r2IncrementalCache`, optionally wrapped in `withRegionalCache`), a Durable Object queue (`doQueue`, deduplicating time-based revalidation) and a sharded Durable Object tag cache (`doShardedTagCache`, backing `revalidateTag` and `revalidatePath`) — assembled through `defineCloudflareConfig` in `open-next.config.ts`. This project's "an admin edit regenerates the affected product pages" approach holds.
4. D1's transaction semantics and concurrent write limits, to confirm the conditional decrement in 6.3 is viable
5. The current shape of the ECB daily reference rates feed, its update time, and the holiday gaps (see 4.4.1)

(The language and currency lists are settled; see 5.0.)

## 13. Where the implementation diverged

Recorded here rather than edited away, so the reasoning is auditable. Two of these are still open decisions.

**Stripe hosted Checkout instead of Elements** (6.2). Elements needs `@stripe/stripe-js` and `@stripe/react-stripe-js`; hosted Checkout needs neither and keeps card details equally far from our servers. The cost is that the buyer leaves for stripe.com, which weakens brand continuity. *Open: revisit if the branded checkout matters more than the two dependencies.*

**PBKDF2-SHA256 instead of Argon2id** (7.1). Argon2 on Workers means adding a WASM library. PBKDF2 is available in WebCrypto with no dependency at all, and at 210k iterations (OWASP's guidance for PBKDF2-HMAC-SHA256) combined with login rate limiting it is adequate for a handful of admin accounts. *Open: Argon2id is the stronger primitive; the trade was made for a template where every dependency is one more thing an adopter has to trust.*

**Dual-licensed MIT OR Apache-2.0 instead of MIT alone** (10). MIT says nothing about patents. Apache-2.0 adds an explicit patent grant and retaliation terms, which commercial adopters care about, and it mirrors Cloudflare's own tooling (`wrangler` is `MIT OR Apache-2.0`, `workerd` is Apache-2.0). Settled.

**A build-time theme system** (not in the original spec). Added after the storefront had a UI: routes fetch data and emit SEO metadata, and a theme decides only appearance. The contract is in `src/themes/contract.ts` and TypeScript enforces completeness. SEO logic never enters a theme, so a broken theme can make the site ugly but cannot damage its indexing. Settled.

**A shared storefront string catalogue** (not in the original spec). Interface strings originally lived inside each theme, which made every theme author a translator into four languages — and the translations had already rotted by the time a second theme existed to prove it. Commerce vocabulary and breadcrumb labels now live in `src/lib/storefront/i18n.ts`, English authoritative, read by both the route layer and the themes. A theme owns its voice and nothing else. Settled; see the phase 7 record.

**Breadcrumb structured data was not localised.** Section 5.3 requires per-language structured data, and the implementation emitted a hardcoded English "Products" into `BreadcrumbList` on all four language versions, while the visible breadcrumb was correct only in German. Both now read the shared catalogue. Fixed.

**Image size variants are not pre-generated** (2, 7.2). Originals are uploaded to R2 and cropped at display time. Open question 1 above is therefore still open; revisit when image volume or traffic justifies it.
