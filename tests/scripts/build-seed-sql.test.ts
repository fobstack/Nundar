import { describe, expect, it } from "vitest";
import { buildSeedSql, sqlString } from "@/scripts/build-seed-sql";

describe("sqlString", () => {
  it("wraps a plain string in single quotes", () => {
    expect(sqlString("hello")).toBe("'hello'");
  });

  it("doubles embedded single quotes", () => {
    expect(sqlString("d'actionneur")).toBe("'d''actionneur'");
  });

  it("emits NULL for null rather than the string 'null'", () => {
    expect(sqlString(null)).toBe("NULL");
  });

  it("neutralises a statement-terminating payload", () => {
    expect(sqlString("'; DROP TABLE products; --")).toBe(
      "'''; DROP TABLE products; --'",
    );
  });
});

describe("buildSeedSql", () => {
  const sql = buildSeedSql(1_700_000_000);

  it("emits inserts for every seeded table", () => {
    expect(sql).toContain("INSERT OR IGNORE INTO products");
    expect(sql).toContain("INSERT OR IGNORE INTO product_translations");
    expect(sql).toContain("INSERT OR IGNORE INTO product_features");
    expect(sql).toContain("INSERT OR IGNORE INTO product_use_cases");
    expect(sql).toContain("INSERT OR IGNORE INTO product_variants");
    expect(sql).toContain("INSERT OR IGNORE INTO variant_prices");
  });

  it("is re-runnable, so it must not use bare INSERT", () => {
    expect(sql).not.toMatch(/INSERT INTO/);
  });

  it("carries content for all four locales", () => {
    expect(sql).toContain("Stainless Steel Ball Valve DN50");
    expect(sql).toContain("Edelstahl-Kugelhahn DN50");
    expect(sql).toContain("Vanne à bille inox DN50");
    expect(sql).toContain("Válvula de bola de acero inoxidable DN50");
  });

  it("writes prices as integer minor units", () => {
    expect(sql).toContain("9900");
    expect(sql).not.toMatch(/,\s*99\.0*,/);
  });
});
