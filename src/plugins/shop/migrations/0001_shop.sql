-- Shop plugin: variants, prices, exchange rates and carts.
--
-- Everything here is language-independent. A variant belongs to a product
-- through product_group, which is the product content's translation_group, so
-- one set of variants serves every language version of that product.
--
-- Mallok's migrator drops whole-line comments and then splits on semicolons,
-- so a comment must have a line to itself and never trail a line of SQL.
-- Every statement is idempotent.

CREATE TABLE IF NOT EXISTS p_shop_variant (
  id            TEXT PRIMARY KEY,
  product_group TEXT NOT NULL,
  sku           TEXT NOT NULL UNIQUE,
  -- JSON object of option name to value, for example {"size":"DN50"}
  option_values TEXT NOT NULL DEFAULT '{}',
  -- The minimum order quantity. Enforced on the page, at add-to-cart and at
  -- checkout, never display copy alone
  moq           INTEGER NOT NULL DEFAULT 1 CHECK (moq >= 1),
  -- Lead time as a range of business days. Null when it is not stated
  lead_time_min INTEGER,
  lead_time_max INTEGER,
  -- The CHECK is what lets a payment's stock decrement share one D1 batch: a
  -- decrement that would go negative fails its statement and rolls the whole
  -- batch back
  stock         INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  -- track: stock is a hard limit. made_to_order: always orderable, and the
  -- lead time is what the buyer is told
  stock_policy  TEXT NOT NULL DEFAULT 'track'
                CHECK (stock_policy IN ('track', 'made_to_order')),
  weight_grams  INTEGER,
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'archived')),
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS p_shop_variant_product
  ON p_shop_variant (product_group, sort_order);

CREATE TABLE IF NOT EXISTS p_shop_price (
  variant_id   TEXT NOT NULL,
  currency     TEXT NOT NULL,
  -- Integer minor units, never a float
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  -- base: entered by hand in the base currency. auto: derived from the base
  -- price at an exchange rate. manual: entered by hand for this currency, and
  -- never recomputed
  source       TEXT NOT NULL CHECK (source IN ('base', 'auto', 'manual')),
  -- The rate an auto row was computed at, to measure drift against
  rate_used    REAL,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (variant_id, currency)
);

CREATE TABLE IF NOT EXISTS p_shop_rate (
  base_currency  TEXT NOT NULL,
  quote_currency TEXT NOT NULL,
  rate           REAL NOT NULL CHECK (rate > 0),
  -- The date the source published the rate for, as YYYY-MM-DD
  reference_date TEXT NOT NULL,
  fetched_at     TEXT NOT NULL,
  source         TEXT NOT NULL,
  PRIMARY KEY (base_currency, quote_currency)
);

CREATE TABLE IF NOT EXISTS p_shop_cart (
  id         TEXT PRIMARY KEY,
  currency   TEXT,
  locale     TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS p_shop_cart_expiry ON p_shop_cart (expires_at);

-- A cart line holds a variant and a quantity and never a price. Prices are
-- recomputed from p_shop_price whenever the cart is priced
CREATE TABLE IF NOT EXISTS p_shop_cart_line (
  cart_id    TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  quantity   INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (cart_id, variant_id)
);

-- Small key-value state for the scheduled work: when rates were last tried,
-- and where a chunked repricing run has got to
CREATE TABLE IF NOT EXISTS p_shop_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
