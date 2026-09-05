import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { hashPassword } from "@/lib/auth/password";

/**
 * Create an admin account.
 *
 * The password is read **from stdin only** and never from an argument: command
 * line arguments show up in `ps aux`, visible to every other user on the
 * machine, and get written into the shell history file.
 *
 * Usage:
 *   pnpm admin:create you@example.com            # prompts for the password
 *   pnpm admin:create you@example.com --remote   # writes to the deployed D1
 *   echo "$PASSWORD" | pnpm admin:create you@example.com   # piped, for CI
 */
function readPassword(prompt: string): Promise<string> {
  // Piped input, as in CI: read one line without prompting
  if (!process.stdin.isTTY) {
    return new Promise((resolve) => {
      const rl = createInterface({ input: process.stdin });
      rl.once("line", (line) => {
        rl.close();
        resolve(line);
      });
    });
  }

  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    // Echo off, so the password never appears on the terminal
    const stdout = process.stdout as NodeJS.WriteStream & {
      moveCursor?: (dx: number, dy: number) => void;
    };
    const originalWrite = stdout.write.bind(stdout);
    let muted = false;

    stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
      if (muted && typeof chunk === "string") {
        return true;
      }
      return (originalWrite as (...args: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof stdout.write;

    rl.question(prompt, (answer) => {
      muted = false;
      stdout.write = originalWrite;
      originalWrite("\n");
      rl.close();
      resolve(answer);
    });

    muted = true;
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flags = args.filter((arg) => arg.startsWith("--"));
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const [email] = positional;

  if (!email) {
    console.error(
      "Usage: pnpm admin:create <email> [--remote] [--staff]\n" +
        "The password is read from stdin — never pass it as an argument,\n" +
        "it would show up in `ps` output and in your shell history.",
    );
    process.exit(1);
  }

  if (positional.length > 1) {
    console.error(
      "Refusing to take a password as a command-line argument: it is visible\n" +
        "in `ps` output to every user on this machine and is written to your\n" +
        "shell history. Run `pnpm admin:create <email>` and type it instead.",
    );
    process.exit(1);
  }

  const remote = flags.includes("--remote");
  const role = flags.includes("--staff") ? "staff" : "owner";

  const password = await readPassword(`Password for ${email}: `);

  if (password.length < 12) {
    console.error(
      "Password must be at least 12 characters. Admin accounts own the whole store.",
    );
    process.exit(1);
  }

  const hash = await hashPassword(password);
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  // Escape single quotes: both the email and the hash may contain them
  const esc = (value: string) => value.replace(/'/g, "''");

  const sql = `INSERT INTO admin_users (id, email, password_hash, role, created_at) VALUES ('${esc(id)}', '${esc(email.trim().toLowerCase())}', '${esc(hash)}', '${role}', ${now}) ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash, role = excluded.role;`;

  execFileSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      "nundar",
      remote ? "--remote" : "--local",
      "--command",
      sql,
    ],
    { stdio: "inherit" },
  );

  console.log(
    `\nAdmin ${email} (${role}) ready on ${remote ? "remote" : "local"} D1.`,
  );
}

void main();
