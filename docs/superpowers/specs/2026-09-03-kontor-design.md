# kontor 设计规格文档

> Cloudflare 全家桶外贸独立站商城系统
> 状态：设计定稿，待生成实施计划
> 日期：2026-09-03

## 1. 项目定位

一套跑在 Cloudflare 平台上的**单租户可自部署**外贸独立站商城系统。当前第一个实例是作者自己的外贸独立站，未来以开源模板形式发布——别人 fork 后配好自己的 D1 / R2 / Stripe 凭据即可独立运行一份，一份代码对应一个站。

**明确不做的事**（划定边界，避免范围蔓延）：

- 不做多租户 SaaS：没有 tenant_id 隔离、没有订阅计费、没有平台后台
- 不做多商户入驻：没有商户后台、没有结算分账
- 不做 B2B 询价流程：第一版是即时下单支付，不做询价单和账期

### 1.1 核心差异点

相对通用开源商城系统（Medusa / Saleor / Bagisto），本系统的差异在于**以 SEO 长尾词获客为第一性目标**而非以交易功能完备度为目标：

1. 每个商品是一个内容完整的静态页面，携带独立的多语言 SEO 字段
2. 商品之下挂载两类结构化长尾内容——**产品特性**（product features）与**使用工况**（use cases），分别对应两类不同搜索意图
3. 使用工况可按需"提升"为独立落地页，一个商品自然衍生 N 个长尾词页面
4. 多语言从第一天就是一等公民，含翻译完整度管理

## 2. 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 框架 | Next.js（App Router）+ TypeScript | SSR/ISR 对 SEO 友好；生态成熟 |
| 部署 | `@opennextjs/cloudflare` → Cloudflare Workers | 全家桶要求；边缘分发对多国访问有利 |
| 样式 | Tailwind CSS | 无额外运行时开销 |
| 主数据库 | Cloudflare D1（SQLite） | 关系查询 + 事务，适合电商业务逻辑 |
| ORM | Drizzle | D1 支持好、类型安全、迁移可版本控制 |
| 对象存储 | Cloudflare R2 | 出口流量免费；有免费额度（10GB 存储/月） |
| 缓存 / 会话 | Cloudflare KV | 游客购物车、admin session、限流计数 |
| 定时任务 | Cloudflare Cron Triggers | 每日拉取汇率、触发价格重算 |
| 支付 | Stripe | 国际主流，支持卡 / Apple Pay / Google Pay |
| 邮件 | Cloudflare Email Routing / Email Service | 收敛外部依赖，保持全家桶纯度 |
| 校验 | Zod | 全部外部输入（表单、API、webhook）统一校验 |
| 测试 | Vitest + `@cloudflare/vitest-pool-workers` + Playwright | 在真实 Workers 运行时里测，而非 Node mock |

**图片方案**：第一版仅用 R2，上传时预生成所需尺寸变体存入 R2。不引入 Cloudflare Images（付费产品）。当图片量增长或需要更灵活的动态变体时再迁移——因为访问都走同一套图片 URL 服务层，迁移只需改该层实现。

> 待核实项：Workers 运行时里做图片 resize 的具体方案（wasm 图片库 vs `fetch` 的 `cf.image` 选项及其套餐要求）需在实施阶段查阅当前 Cloudflare 官方文档确认，不依据记忆断言。

## 3. 总体架构

```
┌──────────────────────────────────────────────────────────────┐
│ Next.js (App Router) on Cloudflare Workers (via OpenNext)     │
│  ├─ 前台商城：/[locale]/...  静态生成 + ISR                     │
│  └─ 后台管理：/admin/...     动态 SSR，session 鉴权             │
├──────────────────────────────────────────────────────────────┤
│ D1   商品 / 翻译 / 特性 / 工况 / SKU / 多币种价格 / 订单 / 客户   │
│ R2   商品图原图 + 预生成尺寸变体                                 │
│ KV   游客购物车 / admin session / 限流计数                       │
├──────────────────────────────────────────────────────────────┤
│ Cron    每日拉取 ECB 汇率 → 按阈值触发价格重算与静态页再生成      │
├──────────────────────────────────────────────────────────────┤
│ Stripe  PaymentIntent + Webhook 驱动订单状态流转                │
│ Email   订单确认 / 发货通知 / 密码重置                           │
└──────────────────────────────────────────────────────────────┘
```

**后台与前台同处一个 Next.js 应用**：单租户场景下拆成独立应用只会多一套构建、部署与鉴权成本，共享类型定义和数据访问层收益更大。目录上以 `app/(storefront)` 与 `app/(admin)` 路由组隔离，将来若要拆分，边界已经清晰。

## 4. 数据模型

### 4.1 多语言建模原则

翻译内容一律拆到独立的 translation 表，**不在主表加 `name_en` / `name_de` 这类列**。新增一门语言无需改表结构——这是开源模板的必要条件，因为使用者需要的语言各不相同。

复合主键为 `(实体 id, locale)`。

### 4.2 表结构

```sql
-- 商品主表：仅语言无关数据
products(
  id            TEXT PRIMARY KEY,
  slug          TEXT UNIQUE NOT NULL,      -- URL 用，全语言共用
  status        TEXT NOT NULL,             -- draft | active | archived
  primary_image_key TEXT,                  -- R2 object key
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
)

-- 商品翻译：展示内容与 SEO meta
product_translations(
  product_id    TEXT NOT NULL,
  locale        TEXT NOT NULL,
  name          TEXT NOT NULL,
  summary       TEXT,
  description   TEXT,                      -- Markdown
  seo_title     TEXT,
  seo_description TEXT,
  seo_keywords  TEXT,
  og_image_key  TEXT,
  canonical_override TEXT,
  PRIMARY KEY (product_id, locale)
)

-- 产品特性：对应"产品是什么样"类长尾词
-- 例：high temperature resistant ball valve
product_features(
  id            TEXT PRIMARY KEY,
  product_id    TEXT NOT NULL,
  locale        TEXT NOT NULL,
  group_key     TEXT NOT NULL,             -- 跨语言标识，见 4.2.1
  sort_order    INTEGER NOT NULL,
  title         TEXT NOT NULL,
  body          TEXT,
  icon_key      TEXT
)

-- 使用工况：对应"产品用在哪"类长尾词
-- 例：ball valve for offshore oil platform
product_use_cases(
  id            TEXT PRIMARY KEY,
  product_id    TEXT NOT NULL,
  locale        TEXT NOT NULL,
  group_key     TEXT NOT NULL,             -- 跨语言标识，见 4.2.1
  sort_order    INTEGER NOT NULL,
  scenario_title TEXT NOT NULL,
  scenario_slug TEXT,                      -- 独立落地页 URL 片段，逐语言本地化
  has_own_page  INTEGER NOT NULL DEFAULT 0, -- 是否生成独立落地页
  body          TEXT,                      -- Markdown
  spec_highlights TEXT                     -- JSON：该工况下的关键参数
)
```

### 4.2.1 group_key：内容块的跨语言标识

`product_features` 与 `product_use_cases` 每语言一行，但行与行之间没有天然关联。`group_key` 就是这个关联：同一条特性/工况的各语言版本共用一个 `group_key`，配合 `(product_id, locale, group_key)` 唯一索引。

**为什么必须有**（实现阶段 2 时踩到的真实缺陷）：工况落地页的 slug 是逐语言本地化的（`offshore-seawater-lines` / `offshore-seewasserleitungen` / `circuits-eau-de-mer-offshore`）。没有跨语言标识就只能让所有语言共用同一个 slug 拼 hreflang，结果是 hreflang 指向根本不存在的 URL——等于主动把爬虫引向死链。

同一机制也是翻译工作台（7.2）统计翻译完整度的前提：没有它就无法判断德语的哪一条对应英语的哪一条。

**缺翻译时的处理**：某语言缺该 `group_key` 的记录时，hreflang 直接省略该语言条目，绝不用其他语言的 slug 顶替。

```sql

-- SKU / 规格
product_variants(
  id            TEXT PRIMARY KEY,
  product_id    TEXT NOT NULL,
  sku           TEXT UNIQUE NOT NULL,
  stock         INTEGER NOT NULL DEFAULT 0,
  weight_grams  INTEGER,
  option_values TEXT NOT NULL,             -- JSON: {"size":"XL","color":"black"}
  moq           INTEGER NOT NULL DEFAULT 1, -- 最小起订量，见 4.5
  lead_time_days_min INTEGER,              -- 交货周期下限（工作日）
  lead_time_days_max INTEGER               -- 交货周期上限（工作日）
)

-- 多币种价格：基准价手填，其余自动换算，支持手动覆盖（见第 4.4 节）
variant_prices(
  variant_id    TEXT NOT NULL,
  currency      TEXT NOT NULL,             -- ISO 4217
  amount_minor  INTEGER NOT NULL,          -- 最终生效价格，最小货币单位整数
  source        TEXT NOT NULL,             -- base | auto | manual
  rate_used     REAL,                      -- auto 行记录计算时所用汇率，用于阈值比对
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (variant_id, currency)
)

-- 汇率快照，由 Cron Trigger 每日拉取
exchange_rates(
  base_currency   TEXT NOT NULL,           -- USD
  quote_currency  TEXT NOT NULL,           -- EUR | GBP
  rate            REAL NOT NULL,
  fetched_at      INTEGER NOT NULL,
  source          TEXT NOT NULL,           -- ecb
  PRIMARY KEY (base_currency, quote_currency)
)

-- 商品图
product_images(
  id            TEXT PRIMARY KEY,
  product_id    TEXT NOT NULL,
  object_key    TEXT NOT NULL,             -- R2 原图 key
  alt_locale    TEXT NOT NULL,             -- alt 文本按语言存
  alt_text      TEXT NOT NULL,             -- 后台必填校验
  sort_order    INTEGER NOT NULL
)

-- 订单
orders(
  id            TEXT PRIMARY KEY,
  order_no      TEXT UNIQUE NOT NULL,      -- 对外可读单号
  customer_id   TEXT,
  status        TEXT NOT NULL,             -- 见状态机
  currency      TEXT NOT NULL,
  subtotal_minor INTEGER NOT NULL,
  shipping_minor INTEGER NOT NULL,
  tax_minor     INTEGER NOT NULL,
  total_minor   INTEGER NOT NULL,
  stripe_payment_intent_id TEXT UNIQUE,
  shipping_address_json TEXT NOT NULL,
  locale        TEXT NOT NULL,             -- 下单时语言，用于发对应语言邮件
  tracking_no   TEXT,
  created_at    INTEGER NOT NULL
)

-- 订单行：存快照，商品改名改价不影响历史订单
order_items(
  id            TEXT PRIMARY KEY,
  order_id      TEXT NOT NULL,
  variant_id    TEXT NOT NULL,
  sku_snapshot  TEXT NOT NULL,
  name_snapshot TEXT NOT NULL,
  unit_price_minor INTEGER NOT NULL,
  quantity      INTEGER NOT NULL
)

-- Webhook 幂等表
stripe_events(
  event_id      TEXT PRIMARY KEY,          -- Stripe event id，唯一
  type          TEXT NOT NULL,
  processed_at  INTEGER NOT NULL
)

-- 库存调整流水（审计用）
inventory_adjustments(
  id            TEXT PRIMARY KEY,
  variant_id    TEXT NOT NULL,
  delta         INTEGER NOT NULL,
  reason        TEXT NOT NULL,             -- order_paid | manual | refund | oversold_fix
  ref_id        TEXT,                      -- 关联订单 id 等
  created_at    INTEGER NOT NULL
)

-- 客户与地址
customers(
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  default_locale TEXT,
  default_currency TEXT,
  created_at    INTEGER NOT NULL
)
customer_addresses(
  id            TEXT PRIMARY KEY,
  customer_id   TEXT NOT NULL,
  recipient     TEXT NOT NULL,
  line1 TEXT NOT NULL, line2 TEXT,
  city TEXT NOT NULL, state TEXT, postal_code TEXT NOT NULL,
  country TEXT NOT NULL, phone TEXT,
  is_default    INTEGER NOT NULL DEFAULT 0
)

-- 后台用户
admin_users(
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL,             -- owner | staff
  created_at    INTEGER NOT NULL
)
```

### 4.3 关键决策与理由

1. **金额一律用最小货币单位整数**（`*_minor`，美分/欧分），永不使用浮点数。避免电商最经典的精度累积误差。
2. **多币种价格自动换算，允许手动覆盖**。运营只填 USD 基准价，EUR / GBP 由汇率自动换算生成；需要针对特定市场定价时可手动覆盖单个币种。详见 4.4。
3. **特性与工况分表**。两者搜索意图不同（产品属性 vs 应用场景），渲染位置、结构化数据标记、独立成页的条件都不同，混表后期必然要拆。
4. **订单行存快照**。商品改名、改价、下架都不影响历史订单展示，这是财务与客服的刚需。
5. **图片 alt 按语言存**。多语言站的图片 alt 也是排名信号，不能全语言共用一份英文 alt。

## 4.4 定价引擎（基准价 + 自动换算 + 可覆盖）

手动维护 3 币种 × N 个 SKU 的价格不可持续。定价模型如下：

```
运营输入：USD 基准价（每个 variant 一个数）
系统计算：EUR / GBP = USD × 汇率 × (1 + 缓冲系数) → 心理价位取整
可选覆盖：对特定 variant 的特定币种手动定价，此后不再参与自动重算
```

`variant_prices.source` 三种取值语义：

| source | 含义 | 汇率刷新时 |
|---|---|---|
| `base` | 运营手填的基准币种价格（USD） | 不变 |
| `auto` | 由基准价换算生成 | 满足阈值条件时重算 |
| `manual` | 运营针对该币种手动定价 | 跳过，永远保留手填值 |

### 4.4.1 汇率来源

采用**欧洲央行（ECB）每日参考汇率**：免费、无需 API key、权威。开源使用者 fork 后无需注册任何第三方汇率服务即可运行——这是选它而非商业汇率 API 的决定性理由。

由 Cloudflare Cron Trigger 每日拉取一次写入 `exchange_rates`。ECB 汇率以 EUR 为基准，USD→GBP 需经 EUR 交叉换算。

> 待核实：ECB 汇率数据的当前接口形态与更新时间（含周末与欧洲节假日不更新的情况），实施阶段查阅官方数据源确认。拉取失败时保留上一次快照并告警，绝不因汇率拉取失败导致价格异常。

### 4.4.2 价格稳定性（关键约束）

**汇率每日更新，但价格不随之每日变动。**

仅当当前汇率相对该价格计算时所用汇率（`rate_used`）偏离超过**阈值 2%**（可配）时，才触发重算并重新生成受影响的静态页。

理由有三，任一条都足以否定"每日重算"：

1. 商品页为静态生成，价格每日变动意味着每日全量重新生成
2. 页面 JSON-LD 中的价格与实际结算价格若频繁漂移，可能触发 Google Merchant 价格不一致警告
3. 老客户看到价格逐日浮动会损害信任

### 4.4.3 汇率缓冲

自动换算必须带**缓冲系数（默认 3%，可配）**。USD/EUR 从 0.92 跌至 0.88 时，欧元售价换回美元将损失约 4% 毛利；缓冲即为覆盖该波动与 Stripe 跨境手续费而设。

### 4.4.4 心理价位取整

换算结果不可直接上架（`$99 × 0.92 = €91.08`）。按可配规则取整，默认**向上取整至 `.99` 结尾**（€91.08 → €91.99）；工业品场景可配置为整数结尾。规则在配置文件中调整，不改代码。

### 4.4.5 结算一致性

结账时以订单创建瞬间的 `variant_prices` 为准并写入 `order_items` 快照，Stripe PaymentIntent 金额取自该快照。价格重算与用户结账并发时，用户支付的永远是他下单那一刻看到的价格。

### 4.4.6 后台呈现

商品编辑页价格区需明确区分价格来源与汇率新鲜度：

```
USD  [ 99.00 ]  基准价
EUR  [ 91.99 ]  ⟳ 自动换算（汇率 0.92 · 缓冲 3% · 更新于 2 天前）  [手动覆盖]
GBP  [ 79.99 ]  ✎ 手动设定                                        [恢复自动]
```

**默认参数**：缓冲系数 3%、重算阈值 2%、取整至 `.99` 结尾。

## 4.5 最小起订量（MOQ）与交货周期

外贸场景刚需字段，置于 **variant（SKU）层级**而非商品层级：不同规格的起订量与交期经常不同（大口径规格起订量低但交期长）。后台提供"批量应用到全部 SKU"操作以避免重复填写。

**不做结构化的字段**：技术参数表、认证证书统一放入商品描述富文本。不同品类需展示的参数差异极大，强行结构化会束缚内容表达，且增加后台填写负担。

### 4.5.1 MOQ 的业务规则

MOQ 不只是展示文案，必须参与校验，三处都要拦：

1. **商品页**：数量选择器初始值即为 MOQ，步进按 MOQ 递增（避免用户选出 MOQ=50 时的 73 件这种无效数量）
2. **加入购物车**：数量低于 MOQ 时拒绝并提示该 SKU 的实际起订量
3. **结账**：服务端二次校验（前端校验可被绕过），不通过则拒绝创建订单

`moq` 默认值为 1，即不设起订限制的普通商品无需额外配置。

### 4.5.2 交货周期的呈现

以区间存储（`lead_time_days_min` / `lead_time_days_max`，单位工作日），呈现于三处：

1. 商品页：`Lead time: 15–20 business days`，按 locale 本地化数字与文案
2. 结账页：多 SKU 时取各行交期的最大值作为整单预计交期
3. 订单确认邮件：写入预计发货时间，减少客户催单

数值为语言无关的整数，仅展示层做本地化，无需进翻译表。

**SEO 关联**：商品页 JSON-LD 的 `Offer` 中输出 `deliveryLeadTime`，可被 Google 用于展示配送信息。

## 5. 前台渲染与 SEO 策略

### 5.0 目标市场、语言与币种

目标市场：**欧美**。

| locale | 覆盖市场 | 默认币种 |
|---|---|---|
| `en`（默认，承担 `x-default`） | 美国、英国、加拿大、澳洲 | USD |
| `de` | 德国、奥地利、瑞士 | EUR |
| `fr` | 法国、比利时、加拿大法语区 | EUR |
| `es` | 西班牙、拉美 | EUR |

支持币种：**USD（基准）/ EUR / GBP**。

- GBP 作为独立币种，不并入 EUR——英国脱欧后税制与定价习惯已与欧元区分离
- 语言与币种解耦：`en` 用户可手动切到 GBP 或 EUR，选择存 cookie
- 各币种价格由 USD 基准价自动换算生成，可按需手动覆盖，机制见 4.4

语言列表集中配置于一处（`config/locales.ts`），新增语言只需增加配置项与对应翻译数据，无需改表结构或路由代码。

**内容生产成本提示**：4 门语言意味着每个商品的名称、描述、SEO meta、特性、工况都需 4 份内容。翻译工作台（见 7.2）正是为管理这一成本而设计——它会显式标出各语言的翻译完整度，避免语言版本内容漂移。

### 5.1 路由结构

语言用路径前缀，不用子域名——单站权重集中，Cloudflare 上配置最简单。

```
/[locale]/                                   首页
/[locale]/products                           商品列表
/[locale]/products/[slug]                    商品页
/[locale]/products/[slug]/[useCaseSlug]      工况落地页（has_own_page = 1 时）
/[locale]/collections/[slug]                 分类页
/[locale]/cart  /checkout  /account          交易与账户
/admin/...                                   后台（不带 locale 前缀）
```

### 5.2 渲染策略

| 页面类型 | 策略 | 理由 |
|---|---|---|
| 首页、商品页、工况页、分类页 | 静态生成 + ISR | SEO 页面须秒开且对爬虫完整可读；后台改内容后触发 revalidate |
| 购物车、结账、账户 | 动态 SSR / CSR | 用户私有数据，不可缓存 |
| 库存与实时价格 | 静态页 + 客户端补数据 | 见下 |

**库存实时补数据**：静态页中的库存数字必然会过期，会造成"页面显示有货、下单才发现无货"。做法是静态页先渲染 SEO 所需的全部内容（爬虫获得完整页面），hydration 后请求 `/api/inventory?variants=...` 刷新真实库存与价格并覆盖显示。爬虫拿到的是完整内容，用户拿到的是实时数据。

### 5.3 SEO 基建（第一版即完整实现）

- **hreflang**：每页输出全部语言版本的 `<link rel="alternate" hreflang="...">` 及 `x-default`。缺失会导致 Google 将不同语言版本判为重复内容。
- **canonical**：每页自渲染 canonical。工况落地页的 canonical 指向自身，不指向商品页——指向商品页等于主动放弃该页排名。
- **JSON-LD 结构化数据**：商品页输出 `Product` + `Offer`（价格、货币、库存状态）+ `BreadcrumbList`；工况落地页按内容性质输出 `Product` + `Article`。直接影响搜索结果能否展示价格与库存富媒体摘要。
- **动态 sitemap**：`/sitemap.xml` 为索引，按语言拆分 `/sitemap-[locale].xml`，从 D1 实时生成并带 `lastmod`。`has_own_page = 0` 的工况不进 sitemap。
- **robots.txt**：屏蔽 `/cart`、`/checkout`、`/account`、`/admin` 及带筛选查询参数的 URL，避免爬虫预算浪费在无限筛选组合上。
- **图片 SEO**：alt 后台强制必填；R2 object key 用商品 slug 而非随机哈希。

### 5.4 语言与币种切换规则（硬约束）

**禁止按 IP 强制跳转或强制切换语言、币种。**

- 语言由 URL 路径前缀唯一决定，是权威来源
- 币种默认取当前语言的默认币种，用户可手动切换，选择存 cookie
- 可用 `request.cf.country` 显示"是否切换到 XX"的提示条，但绝不自动执行跳转或改写内容

**理由**：Google 爬虫通常从美国 IP 抓取，按 IP 强制跳转会导致爬虫只能看到一个语言版本，其他语言页面无法被索引，直接摧毁多语言站的收录。这是多语言外贸站最常见的致命错误。

## 6. 交易流程

### 6.1 购物车

游客态存 KV，key 取自 HttpOnly cookie 中的随机 `cart_id`，TTL 30 天；登录后合并至该客户名下。

购物车**只存 `variant_id` 与数量，不存价格**。价格永远在结账时从 D1 重算，杜绝前端篡改价格。

### 6.2 结账与支付

```
1. 用户点击结账
   → 后端重新校验：商品是否上架、库存是否充足、数量是否满足 MOQ、按当前 D1 数据重算价格
   → 创建 orders 记录（status = pending）
   → 创建 Stripe PaymentIntent（金额取后端计算结果，绝不信任前端传值）
   → 返回 client_secret

2. 前端 Stripe Elements 完成支付（卡号等敏感信息不经过本系统服务器）

3. Stripe Webhook（payment_intent.succeeded）
   → 校验 webhook 签名
   → 幂等检查：event_id 是否已存在于 stripe_events
   → D1 事务内：条件扣减库存 + 订单状态置 paid + 写 inventory_adjustments
   → 发送订单确认邮件（按 orders.locale 选择语言）

4. 后台发货 → 填物流单号 → 状态置 shipped → 发送发货通知邮件
```

### 6.3 四项必须正确实现的防护

1. **订单状态以 Webhook 为准，不以前端跳转为准**。用户支付后浏览器崩溃或断网很常见，前端"支付成功"回调不可靠。前端跳转成功页时若订单仍为 pending，显示"处理中"并轮询。

2. **Webhook 必须幂等**。Stripe 会重试投递，同一事件可能多次到达。以 `stripe_events.event_id` 主键去重，重复事件直接返回 200 忽略。否则库存会被重复扣减。

3. **库存在支付确认后扣减，而非加购或创建订单时扣减**。加购即扣会被恶意刷单占光库存。扣减使用 D1 事务内条件更新（`UPDATE ... WHERE stock >= qty`）；失败则将订单标记为 `oversold`，进入人工处理队列并触发自动退款。取舍明确：宁可承受极小概率超卖后退款，也不接受库存被恶意占用。（已排除的备选方案：下单锁库存 15 分钟——需额外引入定时清理任务，复杂度更高。）

4. **订单行快照**。见 4.3。

### 6.4 订单状态机

```
pending ──→ paid ──→ shipped ──→ delivered
   │          │          │
   │          └──────────┴──→ refunded
   ├──→ cancelled
   └──→ oversold（支付成功但库存不足，人工处理）
```

状态流转只允许上图定义的转移，非法转移在数据访问层拒绝并记录。

## 7. 后台管理

### 7.1 鉴权

- 自建账号密码，Argon2id 哈希（Workers 上使用 WebCrypto 兼容实现）
- session token 存 KV，配 HttpOnly + Secure + SameSite cookie
- 角色两级：`owner`（含设置与管理员账号管理）、`staff`（仅商品与订单）
- 登录接口限流（KV 计数），防暴力破解

### 7.2 模块

| 模块 | 功能 |
|---|---|
| 商品管理 | 商品 CRUD、SKU/规格矩阵、USD 基准价 + 自动换算价（可单币种覆盖，见 4.4.6）、MOQ 与交货周期（支持批量应用到全部 SKU）、库存调整（写流水）、上下架 |
| 内容与 SEO | 按语言分栏编辑：名称/描述/SEO meta/特性/工况；工况 `has_own_page` 开关；alt 必填校验；搜索结果预览 |
| 图片管理 | 拖拽上传至 R2、上传时生成尺寸变体、排序、设主图 |
| 订单管理 | 列表/详情、发货（填单号触发邮件）、退款（调 Stripe API）、oversold 人工处理队列 |
| 客户管理 | 客户列表、订单历史、地址本查看 |
| 翻译工作台 | 左右对照：源语言 vs 目标语言，标出未翻译字段与翻译完整度 |

**翻译工作台不是锦上添花**：多语言站的真实成本在持续维护 N 个语言版本的内容同步。缺少该视图，新增一条工况后无法得知哪些语言尚未跟进，长期必然出现语言版本内容漂移。

## 8. 错误处理原则

- 所有外部调用（Stripe、R2、邮件）显式处理失败，可重试的操作实现重试
- Webhook 处理失败必须返回非 2xx，让 Stripe 重新投递
- 错误日志脱敏：客户邮箱、地址、支付信息一律不入日志
- 面向用户的错误信息必须可操作，禁止 "Something went wrong" 式无信息提示
- 全部外部输入经 Zod 校验后才进入业务逻辑

## 9. 测试策略

不追求覆盖率数字，按风险分三层：

1. **单元测试**：定价引擎（汇率换算、缓冲系数、心理价位取整、重算阈值判定、manual 行不被覆盖）、库存扣减条件、订单状态机、hreflang / JSON-LD / sitemap 生成
2. **集成测试**（Workers 测试运行时 + 本地 D1）：下单全流程、MOQ 服务端校验（前端绕过场景）、webhook 幂等、越权访问（客户能否读到他人订单、staff 能否访问 owner 功能）
3. **E2E**（Playwright + Stripe 测试模式）：浏览商品 → 加购 → 结账 → 测试卡支付 → 订单生成

## 10. 开源准备（随开发同步进行，不留待后补）

- 全部密钥走 `wrangler secret` / 环境变量，仓库零硬编码，提供 `.dev.vars.example`
- README 写明从零部署完整步骤：建 D1、建 R2 bucket、跑迁移、配 Stripe webhook
- `pnpm setup` 脚本自动化上述步骤
- 种子数据脚本（示例商品 + 特性 + 工况 + 多语言内容），clone 后即可看到可运行的站点
- MIT 协议、CONTRIBUTING.md、issue 模板

## 11. 分阶段交付

| 阶段 | 内容 |
|---|---|
| 1 | 项目骨架 + D1 schema + 迁移 + 种子数据 + 部署跑通 |
| 2 | 前台商品浏览 + 多语言路由 + SEO 基建（静态生成、hreflang、sitemap、JSON-LD） |
| 3 | 后台鉴权 + 商品/内容/SEO/图片管理 + 定价引擎（汇率 Cron、自动换算、手动覆盖） |
| 4 | 购物车 + 结账 + Stripe + webhook + 库存扣减 |
| 5 | 订单管理 + 邮件通知 + 客户账户 |
| 6 | 翻译工作台 + 开源工程化（README / 脚本 / 协议） |

## 12. 待确认事项

以下项在实施阶段需查阅当前官方文档确认，不依据记忆断言：

1. Workers 运行时内图片 resize 的可用方案及套餐要求
2. Cloudflare Email 发送事务邮件的当前接口形态与送达率限制；若不满足需求，退回方案为接入 Resend 等事务邮件服务
3. ~~`@opennextjs/cloudflare` 对 ISR / on-demand revalidation 的当前支持程度~~ **已核实（2026-09-03）**：完整支持。机制为三件套——R2 增量缓存（`r2IncrementalCache`，可叠加 `withRegionalCache`）+ Durable Object 队列（`doQueue`，去重时间型重验证）+ Durable Object 分片 tag cache（`doShardedTagCache`，支撑 `revalidateTag` / `revalidatePath` 按需重验证），在 `open-next.config.ts` 中经 `defineCloudflareConfig` 装配。本项目"后台改内容 → 触发对应商品页重新生成"的方案成立。
4. D1 的事务语义与并发写入限制，确认 6.3 的条件扣减方案可行
5. ECB 每日参考汇率的当前接口形态、更新时间与节假日空档处理（见 4.4.1）

（语言与币种清单已确定，见 5.0）
