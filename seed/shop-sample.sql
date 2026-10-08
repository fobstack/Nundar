-- Sample variants and base prices for the sample products in content/product.
--
-- One variant per size on offer. product_group is the product bundle's
-- translation_group, fixed in that bundle's mallok.json, so a variant attaches
-- to its product in every language.
--
-- The quantities, lead times and prices are invented for the sample: enough to
-- exercise minimum order quantities, a made-to-order part and repricing, and
-- nothing a real catalogue should inherit.
--
-- Run it after the site's first request, which is when Mallok creates the
-- shop plugin's tables:
--
--   npm run seed:local
--
-- It is idempotent. Each variant has three prices: a USD base price, and a
-- EUR and a GBP price entered by hand, as a seller with a price list for each
-- market enters them. A price entered by hand is `manual` and is never
-- recomputed. Leave one out and the plugin derives it from the base price,
-- once it has fetched exchange rates, and keeps it in step with them.

INSERT OR IGNORE INTO p_shop_variant
  (id, product_group, sku, option_values, moq, lead_time_min, lead_time_max,
   stock, stock_policy, status, sort_order, created_at, updated_at)
VALUES
  ('sample-ti-shc-m5-10', '50b0633f-18e5-5dd3-8079-19659453e7c6',
   'TI-SHC-M5-10', '{"length":"10 mm"}', 100, 5, 10,
   12000, 'track', 'active', 0,
   '2026-10-05T00:00:00.000Z', '2026-10-05T00:00:00.000Z'),
  ('sample-ti-shc-m5-16', '50b0633f-18e5-5dd3-8079-19659453e7c6',
   'TI-SHC-M5-16', '{"length":"16 mm"}', 100, 5, 10,
   9000, 'track', 'active', 1,
   '2026-10-05T00:00:00.000Z', '2026-10-05T00:00:00.000Z'),
  ('sample-ti-shc-m5-20', '50b0633f-18e5-5dd3-8079-19659453e7c6',
   'TI-SHC-M5-20', '{"length":"20 mm"}', 100, 5, 10,
   15000, 'track', 'active', 2,
   '2026-10-05T00:00:00.000Z', '2026-10-05T00:00:00.000Z'),
  ('sample-ti-shc-m5-25', '50b0633f-18e5-5dd3-8079-19659453e7c6',
   'TI-SHC-M5-25', '{"length":"25 mm"}', 100, 5, 10,
   6000, 'track', 'active', 3,
   '2026-10-05T00:00:00.000Z', '2026-10-05T00:00:00.000Z'),
  ('sample-ti-btn-m3-10', '7002b568-4d58-5536-9c0a-7ee63e1f745d',
   'TI-BTN-M3-10', '{"length":"10 mm"}', 200, 5, 10,
   20000, 'track', 'active', 0,
   '2026-10-05T00:00:00.000Z', '2026-10-05T00:00:00.000Z'),
  ('sample-ti-btn-m4-12', '07f02818-a8b0-5121-bd04-673422e2552e',
   'TI-BTN-M4-12', '{"length":"12 mm"}', 200, 10, 15,
   8000, 'track', 'active', 0,
   '2026-10-05T00:00:00.000Z', '2026-10-05T00:00:00.000Z'),
  ('sample-ti-csk-m6-16', '0e3809c6-54b7-5f36-8848-d4fc51080818',
   'TI-CSK-M6-16', '{"length":"16 mm"}', 100, 5, 10,
   7000, 'track', 'active', 0,
   '2026-10-05T00:00:00.000Z', '2026-10-05T00:00:00.000Z'),
  ('sample-ti-hex-m8-30', '2337ded8-1991-59b3-82eb-abe140dd99ea',
   'TI-HEX-M8-30', '{"length":"30 mm"}', 50, 10, 15,
   3000, 'track', 'active', 0,
   '2026-10-05T00:00:00.000Z', '2026-10-05T00:00:00.000Z'),
  ('sample-ti-shl-m6-20', '76826d2f-ea98-53c3-b9fc-d6bc06279e98',
   'TI-SHL-M6-20', '{"length":"20 mm"}', 25, 20, 30,
   0, 'made_to_order', 'active', 0,
   '2026-10-05T00:00:00.000Z', '2026-10-05T00:00:00.000Z');

INSERT OR IGNORE INTO p_shop_price
  (variant_id, currency, amount_minor, source, rate_used, updated_at)
VALUES
  ('sample-ti-shc-m5-10', 'USD', 185, 'base', NULL, '2026-10-05T00:00:00.000Z'),
  ('sample-ti-shc-m5-16', 'USD', 205, 'base', NULL, '2026-10-05T00:00:00.000Z'),
  ('sample-ti-shc-m5-20', 'USD', 220, 'base', NULL, '2026-10-05T00:00:00.000Z'),
  ('sample-ti-shc-m5-25', 'USD', 245, 'base', NULL, '2026-10-05T00:00:00.000Z'),
  ('sample-ti-btn-m3-10', 'USD', 160, 'base', NULL, '2026-10-05T00:00:00.000Z'),
  ('sample-ti-btn-m4-12', 'USD', 210, 'base', NULL, '2026-10-05T00:00:00.000Z'),
  ('sample-ti-csk-m6-16', 'USD', 260, 'base', NULL, '2026-10-05T00:00:00.000Z'),
  ('sample-ti-hex-m8-30', 'USD', 480, 'base', NULL, '2026-10-05T00:00:00.000Z'),
  ('sample-ti-shl-m6-20', 'USD', 1250, 'base', NULL, '2026-10-05T00:00:00.000Z'),
  ('sample-ti-shc-m5-10', 'EUR', 175, 'manual', NULL, '2026-10-05T00:00:00.000Z'),
  ('sample-ti-shc-m5-10', 'GBP', 150, 'manual', NULL, '2026-10-05T00:00:00.000Z'),
  ('sample-ti-shc-m5-16', 'EUR', 195, 'manual', NULL, '2026-10-05T00:00:00.000Z'),
  ('sample-ti-shc-m5-16', 'GBP', 165, 'manual', NULL, '2026-10-05T00:00:00.000Z'),
  ('sample-ti-shc-m5-20', 'EUR', 210, 'manual', NULL, '2026-10-05T00:00:00.000Z'),
  ('sample-ti-shc-m5-20', 'GBP', 180, 'manual', NULL, '2026-10-05T00:00:00.000Z'),
  ('sample-ti-shc-m5-25', 'EUR', 230, 'manual', NULL, '2026-10-05T00:00:00.000Z'),
  ('sample-ti-shc-m5-25', 'GBP', 200, 'manual', NULL, '2026-10-05T00:00:00.000Z'),
  ('sample-ti-btn-m3-10', 'EUR', 150, 'manual', NULL, '2026-10-05T00:00:00.000Z'),
  ('sample-ti-btn-m3-10', 'GBP', 130, 'manual', NULL, '2026-10-05T00:00:00.000Z'),
  ('sample-ti-btn-m4-12', 'EUR', 200, 'manual', NULL, '2026-10-05T00:00:00.000Z'),
  ('sample-ti-btn-m4-12', 'GBP', 170, 'manual', NULL, '2026-10-05T00:00:00.000Z'),
  ('sample-ti-csk-m6-16', 'EUR', 245, 'manual', NULL, '2026-10-05T00:00:00.000Z'),
  ('sample-ti-csk-m6-16', 'GBP', 210, 'manual', NULL, '2026-10-05T00:00:00.000Z'),
  ('sample-ti-hex-m8-30', 'EUR', 455, 'manual', NULL, '2026-10-05T00:00:00.000Z'),
  ('sample-ti-hex-m8-30', 'GBP', 390, 'manual', NULL, '2026-10-05T00:00:00.000Z'),
  ('sample-ti-shl-m6-20', 'EUR', 1185, 'manual', NULL, '2026-10-05T00:00:00.000Z'),
  ('sample-ti-shl-m6-20', 'GBP', 1020, 'manual', NULL, '2026-10-05T00:00:00.000Z');
