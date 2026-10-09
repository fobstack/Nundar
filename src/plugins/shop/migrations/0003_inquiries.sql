-- Shop plugin: a cart sent as one inquiry, and its lines.
--
-- Mallok's migrator drops whole-line comments and then splits on semicolons,
-- so a comment must have a line to itself, and none here contains a
-- semicolon. Every statement is idempotent.
--
-- An inquiry is a request for a quote: nothing is charged and no stock is
-- taken. It holds what a person typed about themselves, which is personal
-- data, and nothing else in the shop's tables does before an order exists.

CREATE TABLE IF NOT EXISTS p_shop_inquiry (
  id              TEXT PRIMARY KEY,
  -- The number the buyer and the seller quote to each other: a date and a
  -- random suffix, so it says nothing about how many inquiries a shop gets
  inquiry_no      TEXT NOT NULL UNIQUE,
  -- new | answered | spam. Whoever reads the inquiries sets it, and nothing
  -- in the shop acts on it
  status          TEXT NOT NULL DEFAULT 'new'
                  CHECK (status IN ('new', 'answered', 'spam')),
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  company         TEXT NOT NULL DEFAULT '',
  phone           TEXT NOT NULL DEFAULT '',
  message         TEXT NOT NULL DEFAULT '',
  -- The language the cart was sent in, so the buyer is answered in it
  locale          TEXT NOT NULL,
  -- The one currency every amount of this inquiry is in
  currency        TEXT NOT NULL,
  -- The country the request came from, as the edge reports it. Empty when it
  -- does not
  country         TEXT NOT NULL DEFAULT '',
  line_count      INTEGER NOT NULL
                  CHECK (typeof(line_count) = 'integer' AND line_count > 0),
  -- What the lines came to when the cart was sent. Null when a line had no
  -- price, which is what an inquiry is for
  subtotal_minor  INTEGER
                  CHECK (subtotal_minor IS NULL
                         OR (typeof(subtotal_minor) = 'integer' AND subtotal_minor >= 0)),
  -- The same, as the buyer saw it. The admin lists a column as it is stored
  -- and has no way to format an amount, so the text is stored beside it
  subtotal        TEXT NOT NULL DEFAULT '',
  -- The cart it was sent from. The page that confirms an inquiry shows it
  -- only to the browser holding that cart
  cart_id         TEXT NOT NULL,
  -- One-way, from Mallok. It is what an exact limit per visitor counts by.
  -- Null when the request had no address to hash
  ip_hash         TEXT,
  -- When the seller was told by email, and when the buyer was. Null until
  -- then, which is how a job that runs twice sends each once
  notified_at     TEXT,
  acknowledged_at TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS p_shop_inquiry_created
  ON p_shop_inquiry (created_at);

CREATE INDEX IF NOT EXISTS p_shop_inquiry_visitor
  ON p_shop_inquiry (ip_hash, created_at);

CREATE INDEX IF NOT EXISTS p_shop_inquiry_cart
  ON p_shop_inquiry (cart_id, created_at);

-- A line is a snapshot, as an order's is. Renaming, repricing or delisting
-- the product later must not change what the buyer asked about
CREATE TABLE IF NOT EXISTS p_shop_inquiry_line (
  -- '<inquiry id>:<position>'
  id               TEXT PRIMARY KEY,
  inquiry_id       TEXT NOT NULL,
  position         INTEGER NOT NULL
                   CHECK (typeof(position) = 'integer' AND position >= 0),
  variant_id       TEXT NOT NULL,
  sku              TEXT NOT NULL,
  name             TEXT NOT NULL,
  quantity         INTEGER NOT NULL
                   CHECK (typeof(quantity) = 'integer' AND quantity > 0),
  -- Null when the variant had no price in the inquiry's currency
  unit_price_minor INTEGER
                   CHECK (unit_price_minor IS NULL
                          OR (typeof(unit_price_minor) = 'integer' AND unit_price_minor >= 0)),
  -- As the buyer saw them, for the admin's list. Empty without a price
  unit_price       TEXT NOT NULL DEFAULT '',
  line_total       TEXT NOT NULL DEFAULT '',
  UNIQUE (inquiry_id, variant_id)
);

CREATE INDEX IF NOT EXISTS p_shop_inquiry_line_inquiry
  ON p_shop_inquiry_line (inquiry_id, position);
