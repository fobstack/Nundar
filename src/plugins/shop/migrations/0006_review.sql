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
