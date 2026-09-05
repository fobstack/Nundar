import { execFileSync } from "node:child_process";
import { existsSync, copyFileSync } from "node:fs";

/**
 * Prepare a local development environment in one command: generate the
 * migrations, create the tables, load the sample data.
 *
 * No Cloudflare account is needed at any point — D1, R2 and KV are all
 * simulated locally by miniflare.
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
