-- Shop plugin: what checkout needs — more about an order, and the zones an
-- order can be shipped to.
--
-- Mallok's migrator drops whole-line comments and then splits on semicolons,
-- so a comment must have a line to itself, and none here contains a
-- semicolon. A migration is applied once, in one batch with the record of
-- its having been applied, so the columns added here cannot be added twice.

-- The cart an order was placed from. Emptied once the order is paid, not
-- before: a payment that fails must not cost the buyer their cart
ALTER TABLE p_shop_order ADD COLUMN cart_id TEXT;

-- A digest of the secret in the link the buyer is sent to follow their
-- order. The secret itself is in the link and nowhere in the database
ALTER TABLE p_shop_order ADD COLUMN access_hash TEXT;

-- Who is buying: the shop sells to businesses
ALTER TABLE p_shop_order ADD COLUMN company TEXT NOT NULL DEFAULT '';

-- The buyer's VAT or other tax number, when they gave one
ALTER TABLE p_shop_order ADD COLUMN tax_id TEXT NOT NULL DEFAULT '';

-- Who carries the order, beside its tracking number
ALTER TABLE p_shop_order ADD COLUMN carrier TEXT;

-- The zone the order was shipped to, by name, as it was when the order was
-- placed: a snapshot, like the lines
ALTER TABLE p_shop_order ADD COLUMN shipping_zone TEXT NOT NULL DEFAULT '';

-- none: no tax is charged. stripe: Stripe calculates it at checkout, and the
-- order's tax and total are known once the payment is
ALTER TABLE p_shop_order ADD COLUMN tax_mode TEXT NOT NULL DEFAULT 'none';

-- When the Checkout session the order was sent to stops taking payment
ALTER TABLE p_shop_order ADD COLUMN stripe_session_expires_at TEXT;

-- For a payment the shop had to refuse: the refund a person made of it
ALTER TABLE p_shop_stripe_event ADD COLUMN refund_id TEXT;

CREATE TABLE IF NOT EXISTS p_shop_shipping_zone (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
             CHECK (typeof(sort_order) = 'integer'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- A country belongs to one zone at most: the key says so. A country in no
-- zone cannot be shipped to
CREATE TABLE IF NOT EXISTS p_shop_shipping_country (
  -- ISO 3166-1 alpha-2, upper case
  country TEXT PRIMARY KEY CHECK (length(country) = 2 AND country = upper(country)),
  zone_id TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS p_shop_shipping_country_zone
  ON p_shop_shipping_country (zone_id);

-- What shipping to a zone costs, in each currency it can be paid in
CREATE TABLE IF NOT EXISTS p_shop_shipping_rate (
  zone_id         TEXT NOT NULL,
  currency        TEXT NOT NULL,
  amount_minor    INTEGER NOT NULL
                  CHECK (typeof(amount_minor) = 'integer' AND amount_minor >= 0),
  -- An order whose goods come to this much or more ships free. Null when
  -- nothing does
  free_over_minor INTEGER
                  CHECK (free_over_minor IS NULL
                         OR (typeof(free_over_minor) = 'integer' AND free_over_minor > 0)),
  PRIMARY KEY (zone_id, currency)
);
