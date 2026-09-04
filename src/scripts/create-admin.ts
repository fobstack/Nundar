import { execFileSync } from "node:child_process";
import { hashPassword } from "@/lib/auth/password";

/**
 * 建后台账号：生成密码哈希并经 wrangler 写入 D1。
 *
 * 用法：
 *   pnpm admin:create you@example.com 'your-password'          # 本地
 *   pnpm admin:create you@example.com 'your-password' --remote  # 线上
 *
 * 密码只在本进程里出现，落库的只有 PBKDF2 哈希。
 */
async function main() {
  const [email, password, ...flags] = process.argv.slice(2);

  if (!email || !password) {
    console.error(
      "Usage: pnpm admin:create <email> <password> [--remote] [--staff]",
    );
    process.exit(1);
  }

  const remote = flags.includes("--remote");
  const role = flags.includes("--staff") ? "staff" : "owner";

  const hash = await hashPassword(password);
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  // 单引号转义：邮箱与哈希都可能含特殊字符
  const esc = (value: string) => value.replace(/'/g, "''");

  const sql = `INSERT INTO admin_users (id, email, password_hash, role, created_at) VALUES ('${esc(id)}', '${esc(email.trim().toLowerCase())}', '${esc(hash)}', '${role}', ${now}) ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash, role = excluded.role;`;

  execFileSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      "shopcf",
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
