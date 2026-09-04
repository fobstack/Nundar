import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createDb } from "@/db/client";
import * as schema from "@/db/schema";

describe("createDb", () => {
  it("returns a drizzle client bound to the given D1 database", async () => {
    const db = createDb(env.DB);
    const rows = await db.select().from(schema.products).limit(1);
    expect(Array.isArray(rows)).toBe(true);
  });

  it("exposes the schema so relational helpers are available", () => {
    const db = createDb(env.DB);
    expect(db.query.products).toBeDefined();
    expect(db.query.productTranslations).toBeDefined();
  });
});
