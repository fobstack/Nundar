# Nundar

> 本文是 [README.md](README.md) 的中文翻译，仅为方便阅读，可能滞后；两者冲突时以英文版为准。

**[Mallok](https://github.com/fobstack/mallok) 的商城插件和商城主题。** 为想靠买家真实搜索词获得流量的跨境卖家而做，不去和所有人争抢同一个大词。

> **状态：开发中。** Nundar 正在 Mallok 上重建。商品目录这一侧已经可用；页面上的价格、购物车页和结账还没有，见[现在能用什么](#现在能用什么)。目前还不能用来经营真实店铺。

---

## 要解决的问题

把产品卖到国外时，一个商品通常只被当成**一个页面**。这正是问题所在。搜索「海上平台海水管路用球阀」的买家，比搜索「球阀」的买家离下单近得多，而前一个词几乎没人竞争。

## Nundar 的做法

**一个商品是一套内容，不是一个页面。**

| 内容 | 回答什么 | 能拿下的搜索词示例 |
|---|---|---|
| **商品** | 它是什么 | `316L stainless ball valve DN50` |
| **应用场景** | 用在哪里、为什么 | `ball valve for offshore platform seawater lines` |
| **聚合页** | 哪些商品具备这个属性 | `corrosion-resistant valves` |

每篇应用场景都是独立的落地页，有自己的网址、标题和结构化数据，并且**每种语言有自己的网址别名**：

```
/applications/offshore-seawater-lines
/de/applications/offshore-seewasserleitungen
/fr/applications/circuits-eau-de-mer-offshore
/es/applications/lineas-agua-de-mar-offshore
```

应用场景页链接到它讨论的商品，商品页列出写给它的应用场景，各语言版本之间用正确的 `hreflang` 互相指向。

**写一篇应用场景是一个慎重的决定。** 产品特点，以及不值得单独成页的应用场景，留在商品页里。每个特点各做一页，只会在商品之间产生大量相近的页面，拖累整个域名。属性词由聚合页承接：一个页面汇集具备同一属性的商品，方便买家比较。

## 它是怎么构成的

Nundar 不是 Mallok 旁边的第二个应用。一个商城就是一个加了两样东西的 Mallok 站点：

| 部分 | 位置 | 负责什么 |
|---|---|---|
| **商城插件** | `src/plugins/shop/` | 规格、各币种价格、库存、起订量、购物车、按汇率重新定价 |
| **商城主题** | `src/theme/` | 商品页、应用场景页、聚合页和列表页的外观，四种语言 |
| **示例内容** | `content/`、`seed/` | 一个商品、它的应用场景、一个聚合页和一个联系页 |

其余的都由 Mallok 提供：内容和编辑器、多语言和 `hreflang`、sitemap、后台和登录、媒体、边缘缓存、邮件。这条边界是有意划的：交易逻辑只在插件里，页面相关的东西不在这里重做。

一切运行在 Cloudflare Workers 上，使用 D1 和 R2。本地开发不需要 Cloudflare 账号。

## 现在能用什么

Nundar 基于 `mallok@0.1.0-rc.9`。商城的一部分功能需要 Mallok 目前还没有的扩展点，这些部分会等扩展点就绪，不做绕路实现。

| | 现在可用 | 等 Mallok 的下一版插件接口 |
|---|---|---|
| **页面** | 英、德、法、西四种语言的首页、商品页、应用场景页、聚合页、列表页和联系页；`hreflang`、canonical、sitemap；没有客户端 JavaScript | 页面上的价格、规格和库存状态；`Offer` 结构化数据 |
| **目录数据** | 规格、以整数最小单位存储的价格、库存、起订量、交期、按单生产策略 | 在后台编辑这些数据（目前只读，示例数据由 SQL 载入） |
| **定价** | 美元基准价；欧元和英镑按 ECB 汇率换算，带缓冲、价位取整和漂移阈值；手动价格永不被覆盖 | |
| **购物车** | 通过普通表单提交加入、修改、移除，服务端校验起订量和库存 | 购物车页；把购物车作为一次询盘提交 |
| **结账** | | 付款、订单和订单邮件（下一阶段） |

原因和计划见 [`docs/superpowers/specs/2026-09-30-nundar-on-mallok-design.md`](docs/superpowers/specs/2026-09-30-nundar-on-mallok-design.md)。

### 容易做错、并且有测试保证的商业规则

- 金额一律是整数最小单位，任何地方都不用浮点数。
- 购物车只存规格和数量，绝不存价格。
- 起订量由表单校验，**并且**由服务端再校验一次，因为表单可以被绕过。
- 库存带数据库约束，付款时的扣减不可能变成负数：有测试证明整个 D1 batch 会回滚。
- 手动设置的价格永远不会被汇率刷新覆盖。
- 语言只由网址决定，绝不按访客 IP 判断。

## 快速开始

需要 Node.js 22 和 npm。**不需要 Cloudflare 账号。**

```bash
git clone https://github.com/fobstack/Nundar.git
cd Nundar
npm ci
npm run build        # 准备后台和主题的静态资源
npm run smoke:shop   # 在一次性的本地 Worker 上把整个商城走一遍
```

`smoke:shop` 是最快看到整体效果的方式：它创建管理员、应用 `site.json`、用 Mallok CLI 发布 `content/`、载入示例规格、请求两种语言的页面，并加入购物车。

### 可以浏览的本地商城

```bash
# 仅第一次：本地密钥。绝不要提交 .dev.vars。
(umask 077; set -C; printf 'MALLOK_SECRET=%s\nMALLOK_SETUP_KEY=%s\n' \
  "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > .dev.vars)

npm run dev
```

1. 打开 Wrangler 打印的地址，进入 `/_mallok/setup`，输入 `.dev.vars` 里的 `MALLOK_SETUP_KEY` 创建管理员。
2. 在后台打开 **Shop** 插件的开关，并创建一个带 `content:write` 和 `settings:write` 权限的 API 令牌。
3. 把令牌放进环境变量，然后应用 `site.json`、发布内容、载入示例规格：

```bash
export MALLOK_TOKEN=<令牌>
npx mallok publish . --with-settings --url http://localhost:8787
npm run seed:local
```

站点在 `/`（英文）、`/de/`、`/fr/` 和 `/es/`。

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 本地开发服务器，带本地 D1 和 R2 |
| `npm run build` | 准备静态资源，然后做一次生产构建（部署预演） |
| `npm test` | 站点检查，然后在真实 Workers 运行时里跑插件和主题测试 |
| `npm run lint` / `npm run typecheck` | 代码检查和类型检查 |
| `npm run smoke` | 向真实的本地 Worker 发一次真实请求 |
| `npm run smoke:shop` | 在真实的本地 Worker 上走完整个商城 |
| `npm run seed:local` | 把示例规格载入本地数据库 |

## 部署

暂时不要部署。现在部署出来的商城只有目录，没有价格，也没有购物车页。等 Nundar 就绪后，部署走 Mallok 自己的流程：`npx mallok create . --slug <slug>`，它会在你自己的 Cloudflare 账号上创建 Worker、D1 数据库和 R2 存储桶。这条路径还没有在本仓库上跑过。

## 语言和币种

| 语言 | 网址 | 默认币种 |
|---|---|---|
| 英语（默认语言，承载 `x-default`） | `/…` | USD |
| 德语 | `/de/…` | EUR |
| 法语 | `/fr/…` | EUR |
| 西班牙语 | `/es/…` | EUR |

币种：USD（基准价，手工定价）、EUR 和 GBP。新增一种语言，只需把它加进 `site.json` 和主题的 `locales/`，再翻译内容，不需要改表结构，因为每个语言版本都是一条独立的内容。

## 设计决策

- [`docs/superpowers/specs/2026-09-30-nundar-on-mallok-design.md`](docs/superpowers/specs/2026-09-30-nundar-on-mallok-design.md) —— Nundar 如何建在 Mallok 之上，以及为什么
- [`docs/superpowers/specs/2026-09-03-nundar-design.md`](docs/superpowers/specs/2026-09-03-nundar-design.md) —— 最初的设计；其中的商业决策仍然有效，架构部分已被取代
- [`docs/superpowers/plans/`](docs/superpowers/plans/) —— 各阶段计划，以及实现过程中的发现

改动任何结构性的东西之前，请先读设计文档。如果你的改动与其中记录的决策矛盾，请在同一个 PR 里更新文档并说明新的理由。

之前的实现是一个独立的 Next.js 应用，保留在 `nextjs-final` 标签下。

## 参与贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。贡献需要签署 [ICLA](CLA.md)，只要一行。

## 安全

请不要为安全问题开公开 issue。见 [SECURITY.md](SECURITY.md)。

## 许可证

以 **MIT OR Apache-2.0** 双许可证发布，任选其一。Nundar 依赖的 Mallok 采用 Apache-2.0。
