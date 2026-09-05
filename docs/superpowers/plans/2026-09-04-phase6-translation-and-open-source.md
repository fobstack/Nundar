# Phase 6: the translation workbench and open-sourcing — implementation record

> A record written after the fact, from the code and the commit history.

**Spec:** `docs/superpowers/specs/2026-09-03-nundar-design.md`, sections 7.2 and 10

**Commits:** `26495d5`, `c24a4ea`, `999deca`, `463a34b`, `b6e007f`

---

## The translation workbench

The spec calls this "not a nicety", and that is the whole argument for it.

The real cost of a multilingual site is not building it. It is keeping N
language versions in sync afterwards. Add one use case and, without this view,
nobody knows which languages have not caught up — and over time the versions
drift apart silently, which is worse than never having translated them, because
the site now looks complete and is not.

### How completeness is measured

`group_key` is what makes this possible at all. Features and use cases store one
row per language with nothing relating those rows, so `group_key` is the
identity that says "these four rows are the same thing in four languages".
Without it there is no way to tell which German row corresponds to which English
one.

The same column exists because of the phase 2 hreflang defect. One mechanism,
two problems it solves — which is usually the sign it is the right mechanism.

**Only entries that have source content count.** A field left empty in the
default language is not a missing translation, and counting it as one produces a
completeness score that can never reach 100% and therefore tells nobody
anything. When the source language has nothing at all, the score is 100 rather
than 0/0.

The product list shows per-language completeness directly, because the place you
notice a language falling behind should be the place you were already looking.

## Open-sourcing

Done alongside the build rather than bolted on, which the spec insists on and
which turned out to matter — several of the decisions below would have been
expensive to retrofit.

### Licensing

Dual `MIT OR Apache-2.0`, at the user's option.

MIT alone says nothing about patents. Apache-2.0 adds an explicit patent grant
and retaliation terms, which commercial adopters care about. Dual-licensing
mirrors Cloudflare's own tooling — `wrangler` is `MIT OR Apache-2.0`, `workerd`
is Apache-2.0 — so an adopter already comfortable with that stack faces nothing
new.

The spec said MIT alone; this is a deliberate upgrade, recorded in the
divergence section.

### Contributor licensing

An ICLA derived from the Apache model, with the reasoning stated rather than
assumed. A project that may one day be relicensed, or acquired, needs clean
provenance on every contribution — and getting that retroactively from
contributors who have moved on ranges from painful to impossible.

### Security policy

`SECURITY.md` documents the trust boundaries, which design decisions are
security controls rather than style choices, and the residual risks already
known. That last part is the one most projects skip, and it is the one that
makes the document worth reading.

The security contact is still a placeholder pending a domain.

### The three findings from the security review (`999deca`)

Reviewing the finished system against its own threat model turned up three real
problems:

1. **Public endpoints had no rate limit.** Checkout writes an order and calls
   Stripe on every request. Fixed with a KV fixed-window limiter keyed on
   `cf-connecting-ip` — never the forgeable `x-forwarded-for`, which would let
   an attacker choose their own bucket.

2. **No security headers.** Added frame denial, MIME-sniff prevention, a
   restrictive referrer policy, a permissions policy, HSTS, and a CSP without
   `script-src 'unsafe-inline'`. Each one closes a real surface: framing enables
   clickjacking over the genuine checkout button, sniffing can get an uploaded
   file executed, and a leaked referrer hands order numbers to third parties.

3. **`admin:create` accepted the password as an argument.** Command line
   arguments appear in `ps` output, visible to every other user on the machine,
   and get written to shell history. It now reads from stdin only and refuses a
   positional password outright.

### One-click deploy

The Deploy to Cloudflare button provisions the D1 database, both R2 buckets and
the KV namespace, writes the generated ids back into the config, runs the
migrations and deploys.

The migration scripts reference the **binding** `DB`, never the database name.
Someone else's deployment may name the database differently, and a hardcoded
name would send their migrations looking for a database that does not exist.
This was a real bug, found by reading the deploy flow as an adopter rather than
as its author.

### Zero-account local development

`pnpm setup` generates the migrations, creates the local database and loads the
sample data. D1, R2 and KV are simulated by miniflare, so no Cloudflare account
is needed to run or test anything.

CI runs `pnpm setup` itself rather than the three underlying commands, so the
first command a new contributor runs from the README is continuously proven to
work. That is the failure that discourages people most, and it is invisible
unless something checks it.

## What came after this phase

Two things not in the original six-phase plan:

**A build-time theme system** (`7964337`, `9e2cd51`). Added once the storefront
had a real design, so that restyling never requires touching the SEO logic.

**A second theme** (`2b479ab`), which exposed three defects the first theme had
been hiding — a stylesheet collision, interface strings trapped inside themes,
and an English breadcrumb in every language's structured data. A contract with
one implementation is a guess.

Both are recorded in the spec's divergence section.

## Still open

- Customer-facing accounts (see the phase 5 record — a deliberate omission)
- The transactional path is not translated (see the phase 4 record — a defect)
- Argon2id and Stripe Elements remain unresolved against the spec
- Deployment, a domain, and a live Stripe account
