-- Shop plugin: the admin's view of customers and of sales.
--
-- Mallok's migrator drops whole-line comments and then splits on semicolons,
-- so a comment must have a line to itself, and none here contains a
-- semicolon. Every statement is idempotent.
--
-- These are read-only views for table panels, which list a column as it is
-- stored: amounts are spelled out from minor units without a float, as in
-- 0004. All three currencies the shop sells in have two decimal places.

-- A customer is an address that placed an order or sent an inquiry, as
-- typed, compared without regard to case. There are no buyer accounts: this
-- gathers what the shop already holds, and holds nothing of its own
CREATE VIEW IF NOT EXISTS p_shop_customer_admin AS
WITH contact AS (
  SELECT lower(email) AS id, email, company, created_at,
         COALESCE(json_extract(shipping_address, '$.country'), '') AS country
  FROM p_shop_order
  UNION ALL
  SELECT lower(email), email, company, created_at, country
  FROM p_shop_inquiry
),
spent AS (
  SELECT lower(email) AS id, currency, SUM(total_minor) AS minor
  FROM p_shop_order
  WHERE status IN ('paid', 'shipped', 'delivered')
  GROUP BY lower(email), currency
)
SELECT
  c.id,
  (SELECT x.email FROM contact AS x WHERE x.id = c.id
   ORDER BY x.created_at DESC LIMIT 1) AS email,
  COALESCE((SELECT x.company FROM contact AS x
            WHERE x.id = c.id AND x.company <> ''
            ORDER BY x.created_at DESC LIMIT 1), '') AS company,
  COALESCE((SELECT x.country FROM contact AS x
            WHERE x.id = c.id AND x.country <> ''
            ORDER BY x.created_at DESC LIMIT 1), '') AS country,
  (SELECT COUNT(*) FROM p_shop_order AS o
   WHERE lower(o.email) = c.id
     AND o.status IN ('paid', 'shipped', 'delivered', 'refunded', 'oversold')) AS orders,
  (SELECT COUNT(*) FROM p_shop_inquiry AS i WHERE lower(i.email) = c.id) AS inquiries,
  COALESCE((SELECT group_concat(amount, '  ')
            FROM (SELECT s.currency || ' ' || (s.minor / 100) || '.' ||
                         substr('0' || (s.minor % 100), -2) AS amount
                  FROM spent AS s WHERE s.id = c.id
                  ORDER BY s.currency)), '') AS spent,
  MIN(c.created_at) AS first_seen,
  MAX(c.created_at) AS last_seen
FROM contact AS c
GROUP BY c.id;

-- A customer's orders, beside the customer
CREATE VIEW IF NOT EXISTS p_shop_customer_order_admin AS
SELECT
  o.id,
  lower(o.email) AS customer_id,
  o.order_no,
  o.status,
  o.created_at,
  o.currency || ' ' || (o.total_minor / 100) || '.' || substr('0' || (o.total_minor % 100), -2) AS total
FROM p_shop_order AS o;

-- A customer's inquiries, beside the customer
CREATE VIEW IF NOT EXISTS p_shop_customer_inquiry_admin AS
SELECT
  i.id,
  lower(i.email) AS customer_id,
  i.inquiry_no,
  i.status,
  i.created_at,
  i.subtotal
FROM p_shop_inquiry AS i;

-- Sales by month and currency, as first written. 0006 replaces it: this
-- counted an oversold order's refund and not its payment. Nothing prunes
-- the outbox. Whatever first does has to keep these rows or change the view
CREATE VIEW IF NOT EXISTS p_shop_sales_month AS
WITH movement AS (
  SELECT substr(b.created_at, 1, 7) AS month, o.currency,
         1 AS sold, o.total_minor AS sold_minor, 0 AS refunded, 0 AS refunded_minor
  FROM p_shop_outbox AS b
  JOIN p_shop_order AS o ON o.id = b.order_id
  WHERE b.topic = 'order.paid'
  UNION ALL
  SELECT substr(b.created_at, 1, 7), o.currency, 0, 0, 1, o.total_minor
  FROM p_shop_outbox AS b
  JOIN p_shop_order AS o ON o.id = b.order_id
  WHERE b.topic = 'order.refunded'
),
by_month AS (
  SELECT month, currency, SUM(sold) AS orders, SUM(sold_minor) AS revenue_minor,
         SUM(refunded) AS refunds, SUM(refunded_minor) AS refunded_minor
  FROM movement
  GROUP BY month, currency
)
SELECT
  month || ':' || currency AS id,
  month,
  currency,
  orders,
  revenue_minor,
  currency || ' ' || (revenue_minor / 100) || '.' || substr('0' || (revenue_minor % 100), -2) AS revenue,
  refunds,
  currency || ' ' || (refunded_minor / 100) || '.' || substr('0' || (refunded_minor % 100), -2) AS refunded,
  CASE WHEN revenue_minor - refunded_minor < 0 THEN '-' ELSE '' END ||
    currency || ' ' || (abs(revenue_minor - refunded_minor) / 100) || '.' ||
    substr('0' || (abs(revenue_minor - refunded_minor) % 100), -2) AS net,
  CASE WHEN orders = 0 THEN ''
       ELSE currency || ' ' || ((revenue_minor / orders) / 100) || '.' ||
            substr('0' || ((revenue_minor / orders) % 100), -2)
  END AS average
FROM by_month;

-- What sells: each SKU's quantity and takings, in each currency, over the
-- orders that were paid and not refunded. The name is the newest one an
-- order recorded for it
CREATE VIEW IF NOT EXISTS p_shop_product_sales AS
WITH sold AS (
  SELECT l.sku_snapshot AS sku, l.name_snapshot AS name, o.currency,
         l.quantity, l.unit_price_minor * l.quantity AS minor, o.created_at
  FROM p_shop_order_line AS l
  JOIN p_shop_order AS o ON o.id = l.order_id
  WHERE o.status IN ('paid', 'shipped', 'delivered')
)
SELECT
  s.sku || ':' || s.currency AS id,
  s.sku,
  (SELECT x.name FROM sold AS x WHERE x.sku = s.sku
   ORDER BY x.created_at DESC LIMIT 1) AS name,
  s.currency,
  SUM(s.quantity) AS quantity,
  COUNT(*) AS orders,
  SUM(s.minor) AS revenue_minor,
  s.currency || ' ' || (SUM(s.minor) / 100) || '.' || substr('0' || (SUM(s.minor) % 100), -2) AS revenue
FROM sold AS s
GROUP BY s.sku, s.currency;

-- A link a buyer asked for, to see their orders. The shop has no buyer
-- accounts: a buyer gives the address they ordered with and is emailed a
-- link, which opens a list of that address's orders for a day. The link's
-- secret is not kept, only its SHA-256 digest
CREATE TABLE IF NOT EXISTS p_shop_order_link (
  -- Hex SHA-256 of the secret in the link
  id         TEXT PRIMARY KEY,
  -- The address asked for, in lower case, as orders are matched
  email      TEXT NOT NULL,
  -- One-way, from Mallok: what the limit per visitor counts by. Null when
  -- the request had no address to hash
  ip_hash    TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS p_shop_order_link_email
  ON p_shop_order_link (email, created_at);

CREATE INDEX IF NOT EXISTS p_shop_order_link_visitor
  ON p_shop_order_link (ip_hash, created_at);

CREATE INDEX IF NOT EXISTS p_shop_order_link_expiry
  ON p_shop_order_link (expires_at);
