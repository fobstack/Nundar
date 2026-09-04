# shopcf

一套跑在 Cloudflare 上的外贸独立站商城系统。以 SEO 长尾词获客为第一性目标：每个商品是内容完整的静态页面，携带多语言 SEO 字段、产品特性与使用工况内容块。

单租户自部署——一份代码对应一个站点。

> 当前进度：阶段 1（项目地基）已完成。前台商品页、后台管理、购物车与支付见 `docs/superpowers/specs/` 中的分阶段计划。

## 技术栈

Next.js 16（App Router）· TypeScript · Tailwind CSS 4 · `@opennextjs/cloudflare` · Cloudflare D1 / R2 / KV / Durable Objects / Cron · Drizzle ORM · Vitest（跑在真实 Workers 运行时）

## 目标市场

| locale | 覆盖市场 | 默认币种 |
|---|---|---|
| `en`（默认，承担 `x-default`） | 美国、英国、加拿大、澳洲 | USD |
| `de` | 德国、奥地利、瑞士 | EUR |
| `fr` | 法国、比利时、加拿大法语区 | EUR |
| `es` | 西班牙、拉美 | EUR |

支持币种：USD（基准）/ EUR / GBP。运营只填 USD 基准价，其余币种由汇率自动换算，可按需手动覆盖。

## 本地开发

前置：Node.js 20+、pnpm。**不需要 Cloudflare 账号**——D1 / R2 / KV 全部由 miniflare 在本地模拟。

```bash
pnpm install
pnpm db:generate      # 由 schema 生成迁移 SQL（已生成则可跳过）
pnpm db:migrate:local # 建表
pnpm db:seed:local    # 灌示例数据（可重复执行）
pnpm dev
```

访问 http://localhost:3000/en （或 `/de` `/fr` `/es`）应看到示例商品与对应语言、币种的展示。

## 部署到 Cloudflare

```bash
npx wrangler login
```

创建云端资源，把各命令输出的 id 填入 `wrangler.jsonc`（替换其中的 `local-placeholder-replace-before-deploy`）：

```bash
npx wrangler d1 create shopcf
npx wrangler r2 bucket create shopcf-images
npx wrangler r2 bucket create shopcf-inc-cache
npx wrangler kv namespace create SESSIONS
```

然后部署并初始化远端数据库：

```bash
pnpm deploy
pnpm db:migrate:remote
pnpm db:seed:remote   # 可选，灌示例数据
```

## 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 本地开发服务器 |
| `pnpm test` | 跑测试（在真实 Workers 运行时中） |
| `pnpm typecheck` | 类型检查 |
| `pnpm lint` | 代码检查 |
| `pnpm db:generate` | 由 schema 生成迁移 SQL |
| `pnpm db:migrate:local` | 应用迁移到本地 D1 |
| `pnpm db:seed:local` | 向本地 D1 灌示例数据（幂等） |
| `pnpm cf-typegen` | 由 wrangler.jsonc 重新生成绑定类型 |
| `pnpm preview` | 本地预览 Workers 产物 |
| `pnpm deploy` | 构建并部署到 Cloudflare |

改动 `wrangler.jsonc` 的绑定后需重跑 `pnpm cf-typegen`，否则类型检查会报找不到新绑定。

## 环境变量

阶段 1 不需要任何密钥。后续阶段（Stripe、会话密钥、发件地址）的变量清单见 `.dev.vars.example`：

```bash
cp .dev.vars.example .dev.vars
```

`.dev.vars` 已被 gitignore，仓库内不含任何密钥。

## 目录结构

```
src/
├── config/          语言、币种、定价参数（新增语言只改这里）
├── db/
│   ├── schema/      D1 表结构，按业务域分文件
│   └── client.ts    数据库客户端，区分动态与静态路由取绑定
├── lib/
│   ├── money.ts     最小货币单位整数运算
│   ├── pricing.ts   汇率换算、缓冲、心理价位取整
│   └── queries/     数据读取，与路由解耦以便独立测试
├── scripts/         种子数据与 SQL 生成
└── app/[locale]/    多语言路由

drizzle/migrations/  迁移 SQL
tests/               与 src 同构的测试
```

## 设计文档

架构、数据模型与各项取舍的**理由**见：

- `docs/superpowers/specs/2026-09-03-shopcf-design.md` — 完整设计规格
- `docs/superpowers/plans/` — 分阶段实施计划

## 协议

MIT
