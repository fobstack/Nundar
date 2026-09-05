import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { buildSeedSql } from "./build-seed-sql";

// CLI entry point: write the seed SQL to disk for `wrangler d1 execute --file`.
// Kept apart from build-seed-sql.ts so that module needs no node:fs and can
// therefore be tested inside the Workers runtime.
const outPath = "drizzle/seed.sql";
const sql = buildSeedSql(Math.floor(Date.now() / 1000));

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, sql, "utf8");

console.log(`Wrote ${outPath} (${sql.trimEnd().split("\n").length} statements)`);
