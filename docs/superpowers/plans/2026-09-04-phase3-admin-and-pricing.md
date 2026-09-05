# Phase 3: the admin and the pricing engine — implementation record

> **This is a record, not a plan.** Phases 1 and 2 were planned before they were
> built, and their documents read as plans with an execution record appended.
> Phases 3 to 6 were built in a single long session and documented afterwards,
> from the code and the commit history. Writing them up as if they had been
> planned first would be a fiction, so they are written as what they are: the
> decisions that were made, why, and what turned out to be wrong.

**Spec:** `docs/superpowers/specs/2026-09-03-nundar-design.md`, sections 4.4 and 7

**Commits:** `83e65b8`, `ba1404c`, `cf69095`, `1d306f9`, `ca20692`

---

## What this phase had to produce

Two things that look unrelated and are not: an admin somebody can safely be
given the keys to, and a pricing engine that stops anyone from having to
maintain three currencies by hand. They belong together because the admin is
where pricing is *observed* — a converted price with no visible provenance is
indistinguishable from a wrong one.

## Authentication

### Passwords

PBKDF2-SHA256 at 210,000 iterations through WebCrypto.

The spec called for Argon2id. Argon2 on Workers means adding a WASM library, and
this project ships as a template other people fork — every dependency is one
more thing an adopter has to trust and keep patched. PBKDF2 is in WebCrypto
already, and at OWASP's recommended iteration count, behind login rate limiting,
for a handful of admin accounts that sign in occasionally, it is adequate.

Argon2id is the stronger primitive and this remains an open decision; it is
recorded in the spec's divergence section rather than quietly dropped.

Verification is constant-time. An unrecognised stored hash format is a failed
verification rather than an exception, so a storage detail cannot surface as a
500 that reveals it. A hash stored with outdated parameters is upgraded on the
next successful sign-in, while the plaintext is briefly in hand.

### Sessions

Opaque 256-bit random tokens in KV, behind an HttpOnly + Secure + SameSite
cookie, expiring after one working day.

The session contents stay server-side. Putting the role in the cookie would let
the client choose its own privileges. Signing out deletes the KV entry rather
than only clearing the cookie — otherwise a leaked token keeps working.

`Secure` has to be omitted on local http or the browser silently discards the
cookie and sign-in fails forever with no visible cause. That cost an hour.

### Rate limiting

A KV counter keyed on the **email address**, not the IP. Changing IP is far
cheaper for an attacker than changing which account they are attacking. Every
failure refreshes the TTL, so sustained brute force stays locked out instead of
unlocking on a fixed schedule.

An unknown account and a wrong password return the same reason, so the error
cannot be used to enumerate valid accounts.

### Roles and the anti-lockout rules

Two roles: `owner` (settings and administrator management) and `staff` (products
and orders). Account management is owner-only, because if staff can create
accounts, staff can promote themselves.

Three rules with no way around them, each of which would otherwise brick a shop
permanently:

1. You cannot delete yourself — it locks you out
2. You cannot delete the last owner — the shop could never change its settings again
3. You cannot demote yourself — same outcome, reached differently

An unrecognised role in the database degrades to `staff`. Bad data must never
grant owner rights.

## The pricing engine

### Where rates come from

The European Central Bank's daily reference feed: free, no API key, and
authoritative. An adopter can fork this and run it without registering for
anything, which is the decisive argument against a commercial rates API.

The Workers runtime has no DOMParser, and the ECB document is small and
structurally fixed, so it is parsed with a regular expression. Rates are quoted
against EUR, so USD→GBP crosses through EUR.

### Why prices do not move daily

A price is recomputed only once the current rate has drifted more than 2% from
the rate it was computed at. Three reasons, any one of which is sufficient:

- Product pages are statically generated, so a daily price change means
  regenerating all of them daily
- Drift between the price in a page's JSON-LD and the price actually charged
  triggers Google Merchant warnings
- Customers who watch a price move every day stop trusting it

Conversion applies a 3% buffer before rounding up to a `.99` ending. The buffer
covers rate movement and Stripe's cross-border fee: USD/EUR falling from 0.92 to
0.88 costs roughly 4% of margin on euro sales.

### The rule that must never bend

`source = manual` rows are never recomputed. A price chosen for a specific market
outranks whatever the exchange rate says, and a recalculation that silently
overwrote it would be indistinguishable from a bug until somebody noticed the
margin.

Changing the base price drops that SKU's `auto` rows, because they were derived
from a number that no longer exists. `manual` rows survive.

### The cron

Daily at 06:00 UTC. A failed fetch does not throw: it returns a failure and
leaves the previous snapshot in place. Not getting rates is routine — the ECB
skips weekends and European holidays, and networks wobble. Neither should
distort prices or take the Worker down. The logged message carries no request
context, so no PII reaches the logs.

**Not verified locally.** This machine's sandbox blocks outbound fetch from
workerd, proven with a minimal probe worker rather than assumed. The parsing and
recalculation are unit-tested against a captured ECB response; the live fetch
can only be confirmed after deployment.

### How the admin shows it

A converted price is useless without its provenance, so the edit page shows the
rate used, the buffer, and how old the rate is, and distinguishes `base`, `auto`
and `manual` visually. Overriding and reverting are one click each.

## Images

R2 only. Cloudflare Images is a separate paid product, and R2 has a free tier
with no egress charge. The cost is handling variants ourselves; the current
approach uploads the original and crops at display time, which is worth
revisiting when volume justifies it.

**Format is decided by magic bytes, never by the client's Content-Type or the
file extension.** Both can say anything, and a file stored as an image that is
really HTML becomes an XSS vector the moment it is served from our own origin.
SVG is refused outright for the same reason. When the declaration disagrees with
the bytes, the upload is refused rather than corrected — the mismatch usually
means someone is probing.

Images are served through the application rather than from a public bucket. A
private bucket means object keys cannot be enumerated, and it lets us set the
Content-Type and security headers ourselves instead of leaving them to the
storage layer.

Object keys are built from the product slug rather than a random hash, because
the filename is a ranking signal in image search.
`stainless-ball-valve-dn50-01.jpg` says more than `a3f9c2.jpg`. Path separators
are stripped again on the way in, as a second line of defence against traversal.

Alt text is mandatory rather than optional. It is both an accessibility
requirement and a ranking signal, and made optional the real-world outcome is
that nobody ever fills it in.

## Admin interface language

Separate from the storefront's content languages, and deliberately not sharing
their configuration. A storefront language faces buyers, is chosen by the URL
prefix, and affects SEO. The admin language faces whoever runs the shop, is
chosen by a cookie, and has nothing to do with SEO. Conflating them would mean
adding a buyer language inexplicably demanded another admin translation.

No i18n library: around 150 strings, two languages, almost no plural rules, and
Intl handles the number and date formatting. Missing a translation is a compile
error, not a blank spot found at runtime.

**Corrected later (`a52d65b`).** This shipped with Chinese as the default and as
the dictionary defining the message shape, which meant anyone forking the project
landed on a Chinese admin at first login. English is now the default and the
authoritative shape. The shop belongs to whoever deployed it.

## Reporting money

Customer lifetime spend is returned **grouped by currency and never summed**.
Adding a USD amount to a EUR amount produces a number that means nothing, and
showing it would mislead exactly the person making decisions from it.

Low stock is measured against that SKU's MOQ rather than a fixed threshold. A
SKU with a minimum order of 50 is already unsellable at 40, and a dashboard that
calls that "in stock" is lying.

## What this phase got wrong

| Problem | Cause | Fix |
|---|---|---|
| The R2 binding was named `IMAGES` | That name is reserved by Cloudflare Images; `wrangler types` generated `ImagesBinding` instead of `R2Bucket` | Renamed to `MEDIA` |
| Admin defaulted to Chinese | Written for its author rather than for whoever forks it | `a52d65b`, after the project charter made the rule explicit |
| Worker default export was anonymous | Lint rule | `4a8111f` |

## Deliberately not built

- Customer-facing accounts — phase 5
- Any storefront change; this phase only feeds it
- Structured technical-specification fields. What needs displaying varies
  enormously between product categories, and forcing a schema on it constrains
  content while adding data entry work. Specifications live in the description
  as Markdown.
