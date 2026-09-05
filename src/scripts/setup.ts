import { execFileSync } from "node:child_process";
import { existsSync, copyFileSync } from "node:fs";

/**
 * 一键把本地开发环境准备好：生成迁移、建表、灌示例数据。
 *
 * 全程不需要 Cloudflare 账号——D1 / R2 / KV 都由 miniflare 在本地模拟。
 */
function run(command: string, args: string[]): void {
  console.log(`\n▸ ${command} ${args.join(" ")}`);
  execFileSync(command, args, { stdio: "inherit" });
}

function main(): void {
  if (!existsSync(".dev.vars") && existsSync(".dev.vars.example")) {
    copyFileSync(".dev.vars.example", ".dev.vars");
    console.log("▸ created .dev.vars from the example template");
  }

  run("pnpm", ["db:generate"]);
  run("pnpm", ["db:migrate:local"]);
  run("pnpm", ["db:seed:local"]);

  console.log(`
Setup complete.

  pnpm dev                  start the storefront at http://localhost:3000/en
  pnpm admin:create <email> <password>   create an admin account
  pnpm test                 run the test suite

Deploying needs a Cloudflare account — see the README.
`);
}

main();
