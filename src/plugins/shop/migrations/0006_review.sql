-- Shop plugin: corrections to 0005, found by review before it was released.
--
-- Mallok's migrator drops whole-line comments and then splits on semicolons,
-- so a comment must have a line to itself, and none here contains a
-- semicolon. Every statement is idempotent: a view is dropped and made
-- again, and holds no data.

-- Sales by month counted a refund of an oversold order and not the payment
-- it gave back: an oversold order is paid as "oversold", never as "paid",
-- so its refund made a month's net negative. Money is received when a
-- payment is confirmed, either way. An oversold order restocked and
-- fulfilled is "paid" afterwards, and takes no second payment: that row is
-- not a sale. A refund is counted in the month it was made
DROP VIEW IF EXISTS p_shop_sales_month;

CREATE VIEW p_shop_sales_month AS
WITH movement AS (
  SELECT substr(b.created_at, 1, 7) AS month, o.currency,
         1 AS sold, o.total_minor AS sold_minor, 0 AS refunded, 0 AS refunded_minor
  FROM p_shop_outbox AS b
  JOIN p_shop_order AS o ON o.id = b.order_id
  WHERE b.topic = 'order.oversold'
     OR (b.topic = 'order.paid'
         AND NOT EXISTS (SELECT 1 FROM p_shop_outbox AS x
                         WHERE x.order_id = b.order_id
                           AND x.topic = 'order.oversold'))
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

-- Finding a buyer's orders compares lower(email), which no index covered:
-- each request read every paid order the shop had, through the status
-- index. The form is public and D1's allowance is counted in rows read, so
-- enough requests could spend a day's allowance and stop the shop. An index
-- on the same expression lets a request read the address's own orders
CREATE INDEX IF NOT EXISTS p_shop_order_email
  ON p_shop_order (lower(email), status);

-- The customers view gathers inquiries by the same expression
CREATE INDEX IF NOT EXISTS p_shop_inquiry_email
  ON p_shop_inquiry (lower(email));

-- A customer's country was the newest contact's that named one, and the two
-- kinds of contact mean different things: an order names the country it
-- ships to, which the buyer gave, and an inquiry the country the request
-- came from, as the edge reported it — one inquiry sent while travelling
-- moved a buyer abroad. The country an order ships to comes first now, and
-- an inquiry's only for an address that never ordered
DROP VIEW IF EXISTS p_shop_customer_admin;

CREATE VIEW p_shop_customer_admin AS
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
  COALESCE((SELECT json_extract(o.shipping_address, '$.country')
            FROM p_shop_order AS o
            WHERE lower(o.email) = c.id
              AND COALESCE(json_extract(o.shipping_address, '$.country'), '') <> ''
            ORDER BY o.created_at DESC LIMIT 1),
           (SELECT i.country FROM p_shop_inquiry AS i
            WHERE lower(i.email) = c.id AND i.country <> ''
            ORDER BY i.created_at DESC LIMIT 1),
           '') AS country,
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
