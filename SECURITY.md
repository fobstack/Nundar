# Security Policy

## Reporting a vulnerability

**Do not open a public issue for a security problem.** Report it privately
through GitHub's [private vulnerability reporting][gh-private] on this
repository — that is the channel we monitor, and it keeps the report
confidential until a fix ships.

Include: what you found, how to reproduce it, and what an attacker could achieve.
A working proof of concept helps but is not required.

You will get an acknowledgement within 3 working days and an assessment within
10. If the report is valid we will agree a disclosure date with you before
publishing.

If what you found is in pages, sign-in, the admin, media or caching rather than
in the shop, it is most likely in [Mallok][mallok] — report it there.

[gh-private]: https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability
[mallok]: https://github.com/fobstack/mallok/blob/main/docs/SECURITY.md

## Supported versions

Nundar is self-deployed: you run your own copy. Security fixes land on `main`.
There are no backported release branches.

Nundar is in development and not yet fit to run a real shop; see the README.

## Where the trust boundaries are

Nundar is a plugin and a theme inside a Mallok site, and the boundary follows
that split.

**Mallok owns** administrator accounts and their passwords, sessions, CSRF
protection for the admin, the first-run setup key, API tokens, uploaded media,
content sanitisation, and the encryption of secrets a plugin stores. Its
security document describes each. Nundar implements none of them again.

**The shop plugin owns** what follows.

| Data | Where it lives | Notes |
|---|---|---|
| Card numbers, CVV | **Nowhere in Nundar** | Payment goes through Stripe's hosted checkout, so card data never reaches this code. A test lists the columns an order may have. |
| Buyer email, company, tax number and shipping address | D1, on the order | Written when checkout places an order, before the buyer is sent to Stripe. Never written to a log or put in an address. Read in the admin by a signed-in administrator, or a token with `export`. With Stripe Tax on, the address, company and email are also sent to Stripe as a customer of the seller's account. |
| A mark of the visitor who placed an order | D1, on the order | Mallok's one-way hash of the connecting address, which checkout's limit per visitor counts by. Not in an export. |
| Stripe keys and the webhook signing secret | Plugin secrets | Encrypted by Mallok; never logged, never returned by any endpoint. The admin's **Test** buttons return only a verdict. |
| The key orders' links are signed with | D1, in the shop's state | Made once, at random. Anyone who can read the database can open every order's page — which shows nothing the database does not already hold. Not in an export. Deleting it withdraws every link at once. |
| What a buyer says of themselves in an inquiry: name, email address, company, phone, message | D1, on the inquiry | Written when a cart is sent as a request for a quote. It is the first personal data the shop holds. Read in the admin by a signed-in administrator, or a token with `export`; deleted there. Never written to a log or put in an address, and the job the plugin queues carries an id only. **The email is another matter**: once handed to Mallok it sits, whole, in Mallok's own queue — see the residual risks. |
| A mark of the visitor who sent an inquiry | D1, on the inquiry | Mallok's one-way hash of the connecting address, which is what the limit per visitor counts by. The address itself is never stored, and the admin's list does not show the mark. |
| The shop's part of a site export | Not stored: built when asked | Mallok's export, which needs a signed-in administrator or a token with `export`, includes every order and inquiry — names, email addresses, phone numbers, companies, countries, shipping addresses, messages — as files under `shop/`, and the shop's settings, among them the address inquiries are announced to. Whoever holds an export holds that. It leaves out a cart's id and the mark of an inquiry's sender. |
| Cart contents | D1, keyed by an unguessable 128-bit id | Variant ids and quantities only — **never prices**. A test asserts the table has no price column. |
| The cart cookie | `HttpOnly`, `SameSite=Lax`, `Secure` on HTTPS, scoped to `/_mallok/p/shop` | It identifies a cart and nothing else. It is not a session and grants nothing in the admin. |
| Prices, stock, variants | D1 | Changed only through the admin's variant form — which needs a signed-in administrator, or a token with `content:write` — or the plugin's own scheduled repricing. Every change of stock is a row in a ledger. |

## Design decisions that are security controls

These are deliberate and should not be "simplified" away:

- **Prices are never accepted from a client.** The cart stores quantities only;
  every amount is recomputed from the database when the cart is priced.
- **MOQ and stock are enforced on the server.** The form's `min` and `max` are
  a convenience. A direct POST is refused with the same rules, and a test posts
  one.
- **Stock cannot go negative.** The column carries `CHECK (stock >= 0)`, and a
  test proves that a decrement which would oversell rolls back the whole D1
  batch it is in.
- **Every input is validated with Zod** before it reaches the database.
- **Every SQL statement is parameterised.** Lists of ids travel as one JSON
  parameter rather than being spliced into the statement.
- **The redirect after a cart change goes only to a path on the same site.**
  It is judged by the path as a browser will read it, not by the text that
  was sent: another origin, a protocol-relative `//host`, a backslash, and a
  path that only becomes `//host` once its dot segments are resolved all
  fall back to the cart page, so the cart cannot be used as an open redirect.
- **What a refused change shows comes from the database, not from the
  address.** The buyer is sent to the cart page with the reason and the
  variant in the address; the page looks the figures up. A link somebody made
  up can choose among the shop's own sentences and put no words of its own
  on the page.
- **Only what a visitor can see can be bought.** A product that is a draft,
  or published for a later date, cannot be put in a cart by knowing its
  variant's id.
- **A public page carries nothing of anyone's cart.** The form beside a size
  and the header's link to the cart are the same for every visitor, so the
  page stays in the shared cache. The cart cookie is sent only to the shop's
  own routes, and the cart page is served `private, no-store` and `noindex`.
- **A form posted from another site is refused** by Mallok before the shop
  sees it, so a page elsewhere cannot fill or empty a visitor's cart.
- **A page says whether a size can be had, never how many are left.** The
  count is read to decide the state and goes no further. Only the cart page,
  which is one visitor's own, says how many can be had — when it refuses a
  quantity that is more than that.
- **A cart cookie that is not a well-formed id is ignored**, and so is one
  that names no live cart: a fresh id is issued. The id is the only thing
  that protects a cart, so the shop never takes up one a visitor chose, and
  an expired cart's lines do not come back with the next thing added.
- **Cart size is bounded**: at most 100 lines and 500 units per line, so one
  cart cannot be grown without limit. The 500 is a rule of the shop as well
  as a bound: it is judged with the minimum order, so a line above it cannot
  be ordered either, however it came to be in a cart.
- **The cart's routes are rate limited** through Mallok's rate-limit bindings, each route with its own count per visitor, at the relaxed tier: a buyer changes a cart many times in ordinary use.
- **Logs never contain personal data.** The scheduled work logs counts and a
  reference date.
- **The theme runs three scripts in a visitor's browser, and says so.** Each
  is a file of the site's own, declared in `theme.json` with its size. One is
  loaded on the home page and the catalogue to filter a table that is
  already in the page; one on an engineering reference page that asks for
  it, to compute from numbers the visitor types; one on pages with prices in
  more than one currency, to show another currency's amounts, which are
  already in the page. None sends anything anywhere. The currency switch
  keeps one thing, the code of the currency chosen, in the browser's own
  storage — not in a cookie, which would be sent with every page — and works
  without it where storage is blocked. The cart needs no script: adding,
  changing and removing are plain forms. There is no inline
  script and no inline event handler. Tests fail if a template loads a
  script that is not declared, if a declared size is not the file's, or if
  any other page carries a script that is not structured data.
- **The theme loads nothing from another host.** Its fonts and images are
  files served by the site, so no visitor's address is passed to a third
  party by opening a page. The inquiry form is Mallok's: with Turnstile
  configured it loads Cloudflare's challenge script on the pages that carry
  the form.
- **A manual price is never overwritten.** The repricing statement re-checks it
  at write time, so a price set by hand between the read and the write still
  stands.

### Inquiries

A cart can be sent as a request for a quote, from a form on the cart page.
That form is public, stores a row and sends an email, and — see the residual
risks — has no challenge in front of it. What is in its place:

- **Mallok refuses the form when another site caused it**, and limits it at
  its strict tier, with a count of its own per visitor.
- **A visitor may send five inquiries in an hour, exactly.** The count is
  taken in the plugin's own table inside the write, so two sent at the same
  moment cannot both slip under it. It is asked once before the write too,
  so that a visitor over it queues no work. Requests that reach the Worker
  with no connecting address, which Mallok can give no mark, are counted
  together as one visitor, as Mallok's own rate limit counts them: tighter
  than meant, never unlimited.
- **An inquiry needs a cart.** The form is a second request, carrying the
  cookie of a first that put a real part, in a quantity the shop accepts,
  into a cart. A request that has neither stores nothing.
- **A field no person sees.** Whatever fills it in is answered as if all
  were well, and nothing is stored.
- **A cart is stored as one inquiry however often the form arrives, and as
  exactly what is in it.** The write happens only while the cart is still
  what was read — the same lines, the same quantities, no other — and
  empties it in the same batch. A second request finds the first one's
  inquiry and is told its number; a cart that changed meanwhile is not sent,
  and nothing put in it is lost.
- **Nothing a person typed travels in an address.** The answer to the form
  is a redirect that carries the inquiry's number, or the kind of reason
  none was made and the name of a field — so a refused form comes back
  empty. The fields carry the server's own rules as `required`, `maxlength`
  and `pattern`, so that a browser refuses what the server would.
- **The page that confirms an inquiry shows it only to the browser holding
  the cart it was sent from.** A number alone, in a link somebody passed on
  or made up, shows nothing.
- **A name, a company and a phone number are one line each.** White space of
  any kind in one, a line break included, becomes a single space before it
  is stored: such a value ends up in the subject of an email. Any other
  control character is refused.
- **An address is made only of what addresses are made of**: letters and
  digits of any script, and `.`, `_`, `+`, `-` and `'`. The admin makes a
  `mailto:` link of an address, and the seller's email is answered to it; a
  `?`, a `%` or a `,` in one would add a recipient or a subject of the
  buyer's choosing. The rare real address with another sign in it is refused
  with them.
- **Emails escape everything a person typed**, and the one to the seller is
  answered to the buyer's address, not sent from it.
- **The email that confirms to the buyer is off unless switched on**, and
  repeats nothing the buyer typed about themselves: it goes to an address
  nobody has shown to be theirs.
- **An exported cell cannot be a formula.** A value beginning with `=`, `+`,
  `-` or `@` is a formula to a spreadsheet; the export makes it text. So
  is every piece of a value that a spreadsheet would make a cell of: where
  the list separator is a semicolon, a row is split on `;` whatever the
  quotes say.
- **Deleting inquiries asks for a box to be ticked**, and is refused without
  it. It removes the inquiry and its lines from the shop's tables for good.
  It does not reach an email already handed to Mallok — see the residual
  risks.
- **The job that sends the emails is given an id and nothing else.** It reads
  the inquiry when it runs, and marks each email on the inquiry once Mallok
  has taken it, so that a second run sends only what is not marked. That is
  at least once, and nearly always once: a Worker stopped between the two
  sends that email again. The mark means handed to Mallok, not delivered.

### Payment

- **A payment is believed only with Stripe's signature** over the bytes as
  received — Mallok hands the route the raw body — compared in constant time,
  and only within five minutes of the time Stripe signed it. Only the `v1`
  scheme is read. Until the signing secret is set, every delivery is answered
  503 and nothing is read: Stripe keeps it and delivers it again.
- **No amount comes from a client.** Checkout prices the cart from the
  database at the moment it places the order, and the Checkout session is
  opened for the order's own lines and shipping. Stripe's currency
  conversion is switched off for every session.
- **A payment is held to its order.** Its currency and the amount received
  must come to the order's total — or, with Stripe Tax, to at least its goods
  and shipping, the rest being the tax. One that does not is recorded for a
  refund and the order is not paid.
- **Only an order waiting for its payment takes one.** A second payment, for
  an order paid or oversold already, is recorded for a refund.
- **Stock is taken when a payment is confirmed, never before**, and once,
  however Stripe reports it; the payment is one D1 batch.
- **A paid session is never cancelled.** Before an order is cancelled — by a
  new checkout of the same cart, by the seller, by the cron — its Checkout
  session is closed at Stripe; one Stripe has complete is left to its
  payment, whose word may still be on its way.
- **One open payment per cart**, and an order written only while no other
  from its cart is waiting, asked inside the write.
- **A limit on placing orders**: ten an hour from one visitor, counted in the
  order's own write, behind Mallok's strict rate limit. Each placement writes
  an order and asks Stripe for a session.
- **Money moves at Stripe before the books do.** A refund is made at Stripe
  and then recorded; a refund already made in Stripe's dashboard is
  recorded when the admin is asked to make it.
- **An order's page opens only with its link's secret**, an HMAC of the
  order's id; a wrong one, none and an unknown order all answer the same
  404. The page sends no referrer, and writes nothing.
- **Redirects** go to the shop's own paths, or to the page Stripe's API
  returned for the session.
- **Links point at the site's own domain** when it has one, never at the
  host a request named.
- **A Stripe error never carries what was sent.** It is described by
  Stripe's identifiers and the HTTP status; the free-text message is dropped.
- **The emails escape everything a person typed**, and the buyer is written
  to only once a payment is in, or by the seller's own action: never because
  a form was filled in with their address.
- **Logs carry no personal data**: kinds, statuses and order ids. A database
  failure answering a webhook with 500 is logged with D1's message, which
  names a constraint and never a value.

### Finding orders again

There are no buyer accounts. A buyer who has lost an order's link asks for
their orders by the address they ordered with.

- **The form says the same whether or not there were orders** — that a
  link is on its way if any were placed with that address — **and in the
  same time**: the email, and the key that signs the orders' links, are
  queued after the answer has gone. It tells nobody who has bought here.
- **An address is compared without regard to ASCII case, and only so.** The
  database folds ASCII letters and nothing else, and the address typed is
  folded by the database too, never by the Worker: JavaScript folds all of
  Unicode, and turns U+212A KELVIN SIGN into an ASCII k, so an address
  folded there could be sent the orders of another.
- **Only an address a payment was made from is written to.** An order left
  waiting, or cancelled because its payment page lapsed, carries whatever
  address was typed into checkout, and is not counted. Without that, a
  stranger could place an order in someone's name, let it lapse, and have
  the shop write to them.
- **Two limits, counted inside the write**: five requests an hour from one
  visitor, and three links an hour to one address, whoever asks — so that
  the form cannot fill a buyer's inbox. A request counts whether or not the
  address has orders, so the limits say nothing either.
- **The link's secret is 32 random bytes**, of which the database keeps only
  the SHA-256 digest; it opens the list for 24 hours. The list shows each
  order by its own signed link, and the page sends no referrer and writes
  nothing.
- **What a request leaves behind** is the address typed, lower-cased, and
  the visitor's IP hash, for the day the link is good; the cron's hourly
  housekeeping deletes every expired one, all at once, on its next run
  after the day. They are not in the export.
- **A request costs the same, however large the shop.** It reads the
  address's own orders through an index, and a refused one reads none: D1
  bills rows read, and on the Free plan stops every query for the rest of
  the day once they are spent.
- **The address is never in a link or a log.** The email carries the link
  and nothing of the orders.

### Customers and sales in the admin

The customers panel gathers what orders and inquiries already hold — an
address, a company, a country, counts and totals — and keeps nothing of its
own. Sales are counted from the shop's own records. Both are read-only views
an administrator sees.

## Known residual risks

Stated plainly rather than left for an auditor to find:

- **The rate limit is coarse.** Cloudflare's binding counts per location and
  is eventually consistent, by its own description. It slows scripted abuse;
  it is not an exact quota. A determined client can still create carts, and
  each costs D1 writes against the account's daily allowance; the cart page
  costs D1 reads on every request, since it is never cached.
- **The exchange-rate feed is a third-party dependency.** If the ECB serves
  wrong data, automatic prices recompute from it. The drift threshold and the
  buffer limit the blast radius, and a failed fetch keeps the previous
  snapshot, but no sanity band on the rate itself is enforced yet.
- **A cached page can show a price that has since changed.** A page carries
  the price it was rendered with, and is purged when a variant is saved in
  the admin or a repricing run moves a price. Where the purge does not reach
  — a site without a purge token, a purge Cloudflare refuses, or the defect
  Mallok has recorded in which a purge is reported and does not happen — the
  page keeps the old price until its cache entry expires, an hour by default.
  The cart never does: it prices every line from the database on every
  request, so what a buyer is shown before ordering is the price they pay.
  Whether purges evict on a deployed site has not been verified here.
- **Setting stock in the admin overwrites it.** When a seller types a figure,
  a payment that lands between opening the form and saving it is lost from
  the figure, though not from the ledger, which records the difference from
  the stock as it was when the write landed. A save that names no figure
  writes no stock: the field comes to the form empty for that reason.
- **The inquiry form has no challenge in front of it.** Mallok can verify a
  Turnstile token for a plugin's route, and has nowhere to draw the widget on
  a plugin's page: a theme may load no script from another host, and the
  hook that injects one does not run there. The controls listed under
  Inquiries stop one visitor and a simple script. They do not stop many
  addresses working together, which can fill the inquiry table and the
  seller's inbox, and use up what the site's email provider allows. It is
  written up for Mallok; until it is there, watch the inquiries, mark spam
  and delete it.
- **With the buyer's confirmation switched on, the form sends an email to
  whatever address is typed into it.** That is the reason it is off by
  default. Switched on without a challenge, the shop can be used to send its
  confirmation to people who asked for nothing.
- **An inquiry keeps what a buyer typed until someone deletes it.** There is
  no retention period. An administrator deletes inquiries in the admin; a
  CSV that was exported, and an email already sent to the seller, are copies
  the shop no longer controls.
- **Deleting an inquiry does not delete its email from Mallok's queue.** To
  send an email a plugin hands the whole message to Mallok, which keeps it —
  the buyer's name, address, phone number and message — as a row of its own
  `job` table: for seven days after it is delivered, and for good if it
  never is, which is what happens on a site with no email key. A plugin may
  not write Mallok's tables, so nothing here can remove it. **To erase what
  a person typed, delete the inquiry and then the rows of `job` whose
  payload names them, in the database.** It is written up for Mallok.
- **A form the server refuses comes back empty.** The fields carry the
  server's rules, and the server takes what a browser lets through, so a
  person should not meet that for what they typed; the cart changing, or
  the visitor's limit being reached, while the form is being filled in, is
  how they can. Whether a browser's autofill ever fills the field no person
  sees — which would drop a real request without a word — has not been
  tried.
- **An export is as private as the database.** It carries orders and
  inquiries as they are stored. Keep an exported directory where the
  database's own backups would be kept, and do not commit one.
- **A shop can outgrow its export.** The export is built in one request, in
  memory; a table with more rows than `EXPORT_ROW_LIMIT`, or files of more
  text together than `EXPORT_BYTE_LIMIT`, fail it rather than be cut short,
  and Mallok then produces no backup of the site at all. The limits are
  guards against a Worker's memory that have not been measured on a real
  account — on the smallest plan the CPU allowance may stop an export well
  before them — and nothing prunes the stock ledger or the orders. It is
  written up for Mallok.
- **When the shop's export fails, do not switch the shop off to get a
  backup.** Mallok's command line and admin say only that the plugin
  failed, and suggest fixing or disabling it; with the shop disabled the
  export succeeds and has nothing of the shop's in it. The reason is in the
  Worker's log, under `shop_export_refused`.
- **Sample content and sample variants are public test data.** Do not load
  `seed/shop-sample.sql` into a production database, and do not choose the
  sample in Mallok's first-run wizard for a site that will sell — or delete
  its content, variants and zones before it does. The sample catalogue
  describes a supplier that does not exist: its certifications, test figures
  and compliance statements are illustrative, and a real site must replace
  them with its own before it is published.
- **Checkout has no challenge in front of it**, for the reason the inquiry
  form has none. Ten orders an hour a visitor bound what one address can
  make; many addresses together can make many pending orders and Stripe
  sessions, and with Stripe Tax as many Stripe customers, which nothing
  deletes. A pending order is cancelled an hour after its page lapses, and
  stays in the database, cancelled, with the email and address typed in.
- **An order's link does not expire.** Whoever has it — a forwarded email —
  sees the order's address, company and tax number. It cannot be withdrawn
  for one order; deleting the key in the shop's state withdraws them all.
- **Orders are not deleted.** A cancelled or refunded order keeps the
  buyer's details, as records of a sale are usually kept; there is no
  retention period and no erasure in the admin.
- **The order emails go through Mallok's queue as the inquiry's do**, and
  stay in its `job` table as described above. So does the email that carries
  a link to a buyer's orders, link included: whoever can read that table
  within the day can open the list.
- **A link to a buyer's orders opens them for a day, for whoever has it** —
  and the list it opens carries each order's own link, which does not
  expire. Whoever opens a forwarded email within the day can keep those
  orders' addresses, companies and tax numbers for good. The link is in the
  address of the page it opens, as an order's own link is, and cannot be
  withdrawn before it lapses, except by deleting its row.
- **Many addresses together can still have the shop write to real buyers**:
  three links an hour to each address that has paid, whoever asks. Nothing
  more is disclosed by it — the email goes to the address, not to whoever
  asked — and the form has no challenge in front of it, for the reason the
  inquiry form has none.
- **A purchase has been run end to end in Stripe's test mode only on a local
  site** (design §22): paid, delivered twice, refunded, expired and cancelled.
  Stripe Tax, wallets, a card that asks for authentication and a deployed
  site's webhook endpoint have not been tried at Stripe; the tests run against
  a stand-in for Stripe's API built from its documentation.

## Dependency posture

Runtime dependencies are deliberately minimal: `mallok` and `zod`. The ECB feed
and Stripe's API are called over plain `fetch`, with no SDK. Every dependency is attack surface that a
self-hosted shop inherits.

Before adding one, ask whether the platform or Mallok already provides it.
