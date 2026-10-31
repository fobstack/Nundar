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

-- The site's address as the buyer checked out on it, which is where the
-- links in their emails point: an email is sent by a job, which has no
-- request to take an address from
ALTER TABLE p_shop_order ADD COLUMN site_origin TEXT NOT NULL DEFAULT '';

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

-- When a runner took up an outbox row. Two at once — the request that made
-- the change and the minute's tick — must not both send its emails, so a
-- row is claimed before its follow-up runs, and a claim is let go after ten
-- minutes in case its runner stopped
ALTER TABLE p_shop_outbox ADD COLUMN claimed_at TEXT;

-- The orders as the admin lists them. A table panel shows a column as it is
-- stored, so the amounts are spelled out here, in whole minor units divided
-- without a float, and the address is read out of its JSON
CREATE VIEW IF NOT EXISTS p_shop_order_admin AS
SELECT
  o.id,
  o.order_no,
  o.status,
  o.created_at,
  o.updated_at,
  o.email,
  o.company,
  COALESCE(json_extract(o.shipping_address, '$.recipient'), '') AS recipient,
  COALESCE(json_extract(o.shipping_address, '$.country'), '') AS country,
  COALESCE(json_extract(o.shipping_address, '$.phone'), '') AS phone,
  trim(
    COALESCE(json_extract(o.shipping_address, '$.line1'), '') || ', ' ||
    COALESCE(NULLIF(json_extract(o.shipping_address, '$.line2'), '') || ', ', '') ||
    COALESCE(json_extract(o.shipping_address, '$.postalCode'), '') || ' ' ||
    COALESCE(json_extract(o.shipping_address, '$.city'), '') ||
    COALESCE(', ' || NULLIF(json_extract(o.shipping_address, '$.state'), ''), '') || ', ' ||
    COALESCE(json_extract(o.shipping_address, '$.country'), '')
  ) AS address,
  o.currency,
  o.currency || ' ' || (o.subtotal_minor / 100) || '.' || substr('0' || (o.subtotal_minor % 100), -2) AS subtotal,
  o.currency || ' ' || (o.shipping_minor / 100) || '.' || substr('0' || (o.shipping_minor % 100), -2) AS shipping,
  o.currency || ' ' || (o.tax_minor / 100) || '.' || substr('0' || (o.tax_minor % 100), -2) AS tax,
  o.currency || ' ' || (o.total_minor / 100) || '.' || substr('0' || (o.total_minor % 100), -2) AS total,
  o.shipping_zone,
  o.tax_id,
  o.tax_mode,
  o.tracking_no,
  o.carrier,
  o.locale,
  o.stripe_payment_intent_id,
  (SELECT COUNT(*) FROM p_shop_stripe_event AS e
   WHERE e.order_id = o.id AND e.outcome = 'refused' AND e.refund_id IS NULL) AS refunds_owed
FROM p_shop_order AS o;

-- The order's lines as the admin lists them, amounts spelled out the same way
CREATE VIEW IF NOT EXISTS p_shop_order_line_admin AS
SELECT
  l.id,
  l.order_id,
  l.sku_snapshot AS sku,
  l.name_snapshot AS name,
  l.quantity,
  o.currency || ' ' || (l.unit_price_minor / 100) || '.' || substr('0' || (l.unit_price_minor % 100), -2) AS unit_price,
  o.currency || ' ' || ((l.unit_price_minor * l.quantity) / 100) || '.' || substr('0' || ((l.unit_price_minor * l.quantity) % 100), -2) AS line_total
FROM p_shop_order_line AS l
JOIN p_shop_order AS o ON o.id = l.order_id;

-- Payments the shop took and could not keep: for a cancelled order, one paid
-- twice, one that did not come to its total. Each has to be refunded by a
-- person, and the refund is recorded on the event
CREATE VIEW IF NOT EXISTS p_shop_refused_payment AS
SELECT
  e.event_id AS id,
  e.order_id,
  COALESCE(o.order_no, '') AS order_no,
  COALESCE(o.status, '') AS order_status,
  e.payment_intent_id,
  e.processed_at,
  e.refund_id,
  CASE WHEN e.refund_id IS NULL THEN 'to_refund' ELSE 'refunded' END AS state
FROM p_shop_stripe_event AS e
LEFT JOIN p_shop_order AS o ON o.id = e.order_id
WHERE e.outcome = 'refused';
