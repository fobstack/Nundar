# Kontor

一套跑在 Cloudflare 上的外贸独立站商城系统。以 SEO 长尾词获客为第一性目标：每个商品是内容完整的静态页面，携带多语言 SEO 字段、产品特性与使用工况内容块；内容够厚的工况可一键提升为独立落地页，自动进 sitemap 并生成逐语言本地化的 URL。

单租户自部署——一份代码对应一个站点。

## 一键部署

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/FobStack/kontor)

点击后 Cloudflare 会把仓库复制到你的 GitHub 账号，**自动创建所需的 D1 数据库、两个 R2 桶和 KV 命名空间并把 id 写回配置**，跑一遍迁移后完成首次部署。你只需要在设置页填几个值（每一项都有说明）。

部署完成后还要做三件事：

1. **绑定自己的域名**——默认给的是 `*.workers.dev` 地址，而 canonical 与 hreflang 依赖真实域名，SEO 会因此失效。绑好域名后把 `NEXT_PUBLIC_SITE_URL` 改成它。
2. **启用发信域名**：`npx wrangler email sending enable yourdomain.com`（域名 DNS 需托管在 Cloudflare）
3. **建后台账号**：`pnpm admin:create you@example.com`（密码从终端输入，不走命令行参数）

想完全手工控制每一步，见下面的「手工部署」。

## 为什么不是又一个开源商城

| | 通用开源商城 | Kontor |
|---|---|---|
| 首要目标 | 交易功能完备度 | **SEO 长尾词获客** |
| 商品页 | 一个商品一个页面 | 商品页 + N 个工况落地页，逐语言本地化 slug |
| 多语言 | 常见为插件 | 一等公民，含翻译完整度工作台 |
| 多币种 | 手工维护或纯汇率换算 | 基准价自动换算 + 可单币种手动覆盖 |
| 部署 | 需要服务器与数据库 | 全 Cloudflare，本地开发零账号依赖 |

## 技术栈

Next.js 16（App Router）· TypeScript · Tailwind CSS 4 · `@opennextjs/cloudflare` · Cloudflare D1 / R2 / KV / Durable Objects / Cron / Email · Drizzle ORM · Stripe · Vitest（跑在真实 Workers 运行时）

## 目标市场

| locale | 覆盖市场 | 默认币种 |
|---|---|---|
| `en`（默认，承担 `x-default`） | 美国、英国、加拿大、澳洲 | USD |
| `de` | 德国、奥地利、瑞士 | EUR |
| `fr` | 法国、比利时、加拿大法语区 | EUR |
| `es` | 西班牙、拉美 | EUR |

支持币种 USD（基准）/ EUR / GBP。运营只填 USD 基准价，其余币种由 ECB 每日汇率自动换算（带缓冲系数与心理价位取整），可按需手动覆盖。

## 本地开发

前置：Node.js 20+、pnpm。**不需要 Cloudflare 账号**——D1 / R2 / KV 全部由 miniflare 本地模拟。

```bash
pnpm install
pnpm setup     # 生成迁移、建表、灌示例数据
pnpm dev
```

访问 http://localhost:3000/en （或 `/de` `/fr` `/es`）。

进后台：

```bash
pnpm admin:create you@example.com 'your-password'
```

然后访问 http://localhost:3000/admin/login

## 功能

**前台**
- 四语言静态商品页，含完整 hreflang、自指 canonical、Product/Offer/Article/BreadcrumbList 结构化数据
- 使用工况可提升为独立落地页，各语言使用本地化 slug
- 动态 sitemap（不收录未成页的工况）、robots
- 静态页 + 客户端补实时库存与价格
- 购物车、结账、订单状态查询

**后台**
- 中英双语界面（与前台的买家语言分开；漏翻在编译期报错）
- 商品创建（默认落草稿）与多语言内容编辑，SEO 字段带长度提示
- 商品图上传到 R2，按文件头校验真实格式、alt 文本强制必填
- 定价：基准价 + 自动换算 + 单币种手动覆盖，显示所用汇率与新鲜度
- MOQ 与交货周期
- 工况成页开关
- 订单管理：发货、送达、退款、取消，按状态机决定可用操作
- 翻译工作台：各语言完整度与逐条缺失清单
- 客户管理：列表、地址本、订单历史（消费额按币种分列，不合并）
- 销售看板：营收按币种、待处理订单、库存低于起订量的 SKU
- 管理员账号管理与设置（owner 专属，含防自锁规则）

**自动化**
- 每日 Cron 拉取 ECB 汇率，偏离超阈值才重算价格
- Stripe webhook 驱动订单状态，幂等且带超卖保护
- 多语言事务邮件（订单确认、发货通知）

## 手工部署到 Cloudflare

```bash
npx wrangler login
```

创建云端资源，把各命令输出的 id 填入 `wrangler.jsonc`（替换其中的 `local-placeholder-replace-before-deploy`）：

```bash
npx wrangler d1 create kontor
npx wrangler r2 bucket create kontor-media
npx wrangler r2 bucket create kontor-inc-cache
npx wrangler kv namespace create SESSIONS
```

数据库可以叫任何名字——迁移脚本用的是**绑定名 `DB`**，不是库名。

配置密钥：

```bash
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put MAIL_FROM_ADDRESS
```

启用发信域名（发件地址必须属于该域名）：

```bash
npx wrangler email sending enable yourdomain.com
```

设置正式站点地址（canonical 与 hreflang 都基于它，不设会输出 localhost）：

```
NEXT_PUBLIC_SITE_URL=https://yourdomain.com
```

部署并初始化远端数据库：

```bash
pnpm deploy
pnpm db:migrate:remote
pnpm db:seed:remote          # 可选，灌示例数据
pnpm admin:create you@example.com 'password' --remote
```

最后在 Stripe 控制台把 webhook 指向 `https://yourdomain.com/api/webhooks/stripe`，订阅 `payment_intent.succeeded`。

## 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm setup` | 一键准备本地环境 |
| `pnpm dev` | 本地开发服务器 |
| `pnpm test` | 跑测试（在真实 Workers 运行时中） |
| `pnpm typecheck` / `pnpm lint` | 类型检查 / 代码检查 |
| `pnpm db:generate` | 由 schema 生成迁移 SQL |
| `pnpm db:migrate:local` / `:remote` | 应用迁移 |
| `pnpm db:seed:local` / `:remote` | 灌示例数据（幂等） |
| `pnpm admin:create <email> <pw>` | 建后台账号，加 `--remote` 建在线上 |
| `pnpm cf-typegen` | 由 wrangler.jsonc 重新生成绑定类型 |
| `pnpm preview` | 本地预览 Workers 产物 |
| `pnpm deploy` | 构建并部署 |

改动 `wrangler.jsonc` 的绑定后需重跑 `pnpm cf-typegen`。

## 环境变量

见 `.dev.vars.example`。本地开发不需要任何密钥；Stripe 与邮件相关变量在启用支付、发信时才需要。

```bash
cp .dev.vars.example .dev.vars
```

`.dev.vars` 已被 gitignore，仓库内不含任何密钥。

## 目录结构

```
src/
├── config/          语言、币种、定价参数、站点配置（新增语言只改这里）
├── db/
│   ├── schema/      D1 表结构，按业务域分文件
│   └── client.ts    数据库客户端，区分动态与静态路由取绑定
├── lib/
│   ├── money.ts     最小货币单位整数运算
│   ├── pricing/     汇率拉取、换算、重算、Cron 任务
│   ├── cart/        购物车存储与结账定价校验
│   ├── orders/      订单状态机、下单、支付、后台操作
│   ├── stripe/      Stripe REST 客户端与 webhook 验签
│   ├── email/       多语言邮件模板与发信
│   ├── auth/        密码、会话、限流、后台守卫
│   ├── admin/       后台查询与变更
│   ├── seo.ts       canonical / hreflang 构造
│   └── queries/     前台数据读取
├── api/             前端接口封装
├── components/      客户端组件
├── scripts/         种子数据、建号、环境准备
└── app/
    ├── [locale]/    多语言前台
    ├── admin/       后台
    └── api/         接口路由

drizzle/migrations/  迁移 SQL
tests/               与 src 同构的测试
```

## 设计文档

架构、数据模型与各项取舍的**理由**见：

- `docs/superpowers/specs/2026-09-03-kontor-design.md` — 完整设计规格
- `docs/superpowers/plans/` — 分阶段实施计划与执行记录（含实现中发现的缺陷与修复）

改动结构性设计前请先读 spec；与其中记录的决定冲突时，在同一个 PR 里更新 spec 并说明新的理由。

## 贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 协议

双协议：**`MIT OR Apache-2.0`**，使用者任选其一。

这与 Cloudflare 自家工具链一致（wrangler 是 `MIT OR Apache-2.0`，workerd 是
Apache-2.0）。之所以不只用 MIT：MIT 对专利只字未提，而 Apache-2.0 第 3 条有
明确的专利授权与专利反制条款，对商业使用者和下游集成方更安全。

贡献需签署 [ICLA](CLA.md)，一行字即可——理由见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 安全

漏洞请勿公开提 issue，见 [SECURITY.md](SECURITY.md)。其中列出了完整的信任边界
（卡号永不经过本系统、密码与会话如何存放、哪些数据绝不进日志），以及哪些设计
决定其实是安全控制而非风格选择。
