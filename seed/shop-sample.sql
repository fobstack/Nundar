-- Sample variants and base prices for the sample product in
-- content/product/stainless-ball-valve-dn50.
--
-- product_group is that bundle's translation_group, fixed in its mallok.json,
-- so the variants attach to the product in every language.
--
-- Run it after the site's first request, which is when Mallok creates the
-- shop plugin's tables:
--
--   npm run seed:local
--
-- It is idempotent. Only the USD base prices are entered here. The EUR and GBP
-- prices are derived by the plugin once it has fetched exchange rates.

INSERT OR IGNORE INTO p_shop_variant
  (id, product_group, sku, option_values, moq, lead_time_min, lead_time_max,
   stock, stock_policy, status, sort_order, created_at, updated_at)
VALUES
  ('sample-dn50-npt', '0b6f5c1e-6d0a-4c56-9a3e-2f1f4d7a9c10',
   'BV-316L-DN50-NPT', '{"connection":"NPT threaded"}', 10, 15, 20,
   120, 'track', 'active', 0,
   '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('sample-dn50-flg', '0b6f5c1e-6d0a-4c56-9a3e-2f1f4d7a9c10',
   'BV-316L-DN50-FLG', '{"connection":"ANSI 150 flanged"}', 5, 25, 35,
   40, 'track', 'active', 1,
   '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');

INSERT OR IGNORE INTO p_shop_price
  (variant_id, currency, amount_minor, source, rate_used, updated_at)
VALUES
  ('sample-dn50-npt', 'USD', 9900, 'base', NULL, '2026-10-01T00:00:00.000Z'),
  ('sample-dn50-flg', 'USD', 16800, 'base', NULL, '2026-10-01T00:00:00.000Z');
