-- Shop plugin: orders, their lines, payment events, the stock ledger and the
-- outbox.
--
-- Mallok's migrator drops whole-line comments and then splits on semicolons,
-- so a comment must have a line to itself, and none here contains a
-- semicolon. Every statement is idempotent.
--
-- Money columns check their own storage type. SQLite keeps a value such as
-- 99.5 in an INTEGER column as a real number rather than refuse it, and money
-- here is integer minor units or it is nothing.

CREATE TABLE IF NOT EXISTS p_shop_order (
  id                       TEXT PRIMARY KEY,
  -- The number a buyer sees and quotes: a date and a random suffix, so it
  -- says nothing about how many orders the shop takes
  order_no                 TEXT NOT NULL UNIQUE,
  -- pending | paid | shipped | delivered | cancelled | refunded | oversold.
  -- Deliberately not a CHECK: the order state machine is the one place that
  -- decides which statuses exist and which moves are legal, and a CHECK could
  -- only be changed later by rebuilding this table
  status                   TEXT NOT NULL DEFAULT 'pending',
  currency                 TEXT NOT NULL,
  subtotal_minor           INTEGER NOT NULL
                           CHECK (typeof(subtotal_minor) = 'integer' AND subtotal_minor >= 0),
  shipping_minor           INTEGER NOT NULL DEFAULT 0
                           CHECK (typeof(shipping_minor) = 'integer' AND shipping_minor >= 0),
  tax_minor                INTEGER NOT NULL DEFAULT 0
                           CHECK (typeof(tax_minor) = 'integer' AND tax_minor >= 0),
  -- What is charged. It is the sum of its parts or the row is refused
  total_minor              INTEGER NOT NULL
                           CHECK (typeof(total_minor) = 'integer'
                                  AND total_minor = subtotal_minor + shipping_minor + tax_minor),
  stripe_session_id        TEXT,
  -- The payment that settled the order, which is also what a refund names.
  -- Unique, so a payment that settled one order can never settle another.
  -- Orders still waiting for payment hold NULL, which does not collide
  stripe_payment_intent_id TEXT UNIQUE,
  -- The only channel an order notification has
  email                    TEXT NOT NULL,
  -- JSON object: recipient, line1, line2, city, state, postalCode, country,
  -- phone
  shipping_address         TEXT NOT NULL,
  -- The language the order was placed in, so the buyer is written to in it
  locale                   TEXT NOT NULL,
  tracking_no              TEXT,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS p_shop_order_status
  ON p_shop_order (status, created_at);

-- An order line is a snapshot. Renaming, repricing or delisting the product
-- later must not change what a past order says was bought, or for how much
CREATE TABLE IF NOT EXISTS p_shop_order_line (
  -- '<order id>:<variant id>'
  id               TEXT PRIMARY KEY,
  order_id         TEXT NOT NULL,
  variant_id       TEXT NOT NULL,
  sku_snapshot     TEXT NOT NULL,
  name_snapshot    TEXT NOT NULL,
  unit_price_minor INTEGER NOT NULL
                   CHECK (typeof(unit_price_minor) = 'integer' AND unit_price_minor >= 0),
  quantity         INTEGER NOT NULL
                   CHECK (typeof(quantity) = 'integer' AND quantity > 0),
  -- One line per variant. The payment write reads a line's quantity by this
  -- pair and relies on there being exactly one
  UNIQUE (order_id, variant_id)
);

-- Every payment event acted on, and what was done about it. Stripe delivers
-- an event more than once, and acting on one twice would take the stock twice
CREATE TABLE IF NOT EXISTS p_shop_stripe_event (
  event_id          TEXT PRIMARY KEY,
  type              TEXT NOT NULL,
  order_id          TEXT NOT NULL,
  payment_intent_id TEXT NOT NULL,
  -- paid: the order was paid. oversold: paid for, and the stock had gone.
  -- refused: the order could not take a payment, so this one has to be
  -- refunded by a person
  outcome           TEXT NOT NULL,
  processed_at      TEXT NOT NULL,
  -- Stripe can send two events about one object, to be told apart by the
  -- object's id and the event's type. One payment is acted on once
  UNIQUE (type, payment_intent_id)
);

CREATE INDEX IF NOT EXISTS p_shop_stripe_event_order
  ON p_shop_stripe_event (order_id);

-- The stock ledger: every change to a variant's stock, and why
CREATE TABLE IF NOT EXISTS p_shop_stock_adjustment (
  -- For a movement an order causes: '<reason>:<order id>:<variant id>'. Built
  -- from what the row records, so the same movement cannot be written twice
  id         TEXT PRIMARY KEY,
  variant_id TEXT NOT NULL,
  delta      INTEGER NOT NULL CHECK (typeof(delta) = 'integer' AND delta <> 0),
  -- order_paid | refund | manual
  reason     TEXT NOT NULL,
  -- The order the movement belongs to. NULL for a manual correction
  ref_id     TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS p_shop_stock_adjustment_ref
  ON p_shop_stock_adjustment (ref_id, reason);

CREATE INDEX IF NOT EXISTS p_shop_stock_adjustment_variant
  ON p_shop_stock_adjustment (variant_id, created_at);

-- The outbox: what still has to happen because something changed. The
-- buyer's email, the purge of a product's cached pages, a person told about a
-- payment to refund.
--
-- A row is written in the same batch as the change it follows from, so the
-- change and the duty to follow it up cannot come apart. Sending an email
-- after the batch instead would lose it whenever the Worker stopped in
-- between, and nothing would know it was owed
CREATE TABLE IF NOT EXISTS p_shop_outbox (
  -- The order the rows were committed in, which is the order to carry them
  -- out in: "shipped" before "delivered". A timestamp cannot say this. It is
  -- supplied by whoever makes the change, and two changes can carry the same
  -- one
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  -- '<topic>:<order id>' for a change of status, which an order goes through
  -- at most once. '<topic>:<event id>' for a refused payment. Built from what
  -- the row records, so the same duty cannot be written twice
  id         TEXT NOT NULL UNIQUE,
  -- order.paid | order.oversold | order.shipped | order.delivered |
  -- order.cancelled | order.refunded | payment.refused
  topic      TEXT NOT NULL,
  order_id   TEXT NOT NULL,
  -- For payment.refused: the payment intent that has to be refunded
  ref        TEXT,
  created_at TEXT NOT NULL,
  -- NULL until everything that follows from the row has been handed over
  handled_at TEXT
);

-- Only the rows still owed, so finding them stays cheap however long the
-- shop has been running
CREATE INDEX IF NOT EXISTS p_shop_outbox_pending
  ON p_shop_outbox (seq) WHERE handled_at IS NULL;
