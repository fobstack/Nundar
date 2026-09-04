import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const customers = sqliteTable(
  "customers",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    defaultLocale: text("default_locale"),
    defaultCurrency: text("default_currency"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [uniqueIndex("customers_email_unique").on(table.email)],
);

export const customerAddresses = sqliteTable(
  "customer_addresses",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    recipient: text("recipient").notNull(),
    line1: text("line1").notNull(),
    line2: text("line2"),
    city: text("city").notNull(),
    state: text("state"),
    postalCode: text("postal_code").notNull(),
    country: text("country").notNull(),
    phone: text("phone"),
    isDefault: integer("is_default").notNull().default(0),
  },
  (table) => [
    index("customer_addresses_customer_idx").on(table.customerId),
  ],
);

export const adminUsers = sqliteTable(
  "admin_users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull(), // owner | staff
    createdAt: integer("created_at").notNull(),
  },
  (table) => [uniqueIndex("admin_users_email_unique").on(table.email)],
);
