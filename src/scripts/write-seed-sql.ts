import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { buildSeedSql } from "./build-seed-sql";

// CLI 入口：把种子 SQL 落盘，供 wrangler d1 execute --file 使用。
// 与 build-seed-sql.ts 分开，是为了让后者不依赖 node:fs，从而能在 Workers 运行时里被测试。
const outPath = "drizzle/seed.sql";
const sql = buildSeedSql(Math.floor(Date.now() / 1000));

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, sql, "utf8");

console.log(`Wrote ${outPath} (${sql.trimEnd().split("\n").length} statements)`);
