import {
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/** 汇率快照，由 Cron Trigger 每日拉取（拉取逻辑在阶段 3 实现） */
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
