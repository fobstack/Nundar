import {
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/** Exchange-rate snapshots, refreshed daily by the cron trigger */
export const exchangeRates = sqliteTable(
  "exchange_rates",
  {
    baseCurrency: text("base_currency").notNull(),
    quoteCurrency: text("quote_currency").notNull(),
    rate: real("rate").notNull(),
    fetchedAt: integer("fetched_at").notNull(),
    source: text("source").notNull(), // ecb
  },
  (table) => [primaryKey({ columns: [table.baseCurrency, table.quoteCurrency] })],
);
