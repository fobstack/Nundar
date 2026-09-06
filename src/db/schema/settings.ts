import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Settings an operator can change without a redeploy.
 *
 * A narrow key-value table rather than a wide one-row table, so adding a
 * setting needs no migration. The cost is that values are untyped strings and
 * the typing lives in `src/lib/settings`, which is the right trade here: a shop
 * gains settings gradually, and a migration per setting would guarantee they
 * are never added.
 *
 * **Not everything belongs here.** `SITE.url`, the locale list and the theme are
 * build-time values because canonical URLs, hreflang and static pages are baked
 * at build time — making them editable would produce a shop whose live pages
 * disagree with its settings page. Only things read at request time qualify.
 */
export const siteSettings = sqliteTable("site_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
