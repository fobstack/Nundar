# 阶段 2：前台商品浏览与 SEO 基建 Implementation Plan

> **执行方式**：本计划由掌握完整上下文的同一会话执行，因此按任务级编排（每个任务给出接口契约与必须覆盖的测试点），而非逐步骤复述代码。执行仍严格遵循 TDD：先写失败测试 → 确认失败 → 实现 → 确认通过 → 提交。

**Goal:** 让每个商品成为内容完整、SEO 完备的静态页面，并把使用工况按需提升为独立落地页，形成长尾词矩阵。

**Architecture:** 商品页、工况页、列表页全部走 `generateStaticParams` 静态生成 + ISR；SEO 元信息（hreflang / canonical / JSON-LD）由集中的 SEO 工具层统一产出，避免各页面各写一套；库存与价格在静态页 hydration 后经 `/api/inventory` 补实时数据。

**Tech Stack:** 承阶段 1，无新增依赖。

**Spec:** `docs/superpowers/specs/2026-09-03-kontor-design.md`（第 5 节）

## Global Constraints

承阶段 1 全部约束，另加：

- **语言由 URL 路径前缀唯一决定**，禁止按 IP 跳转或改写内容
- **每个页面必须输出完整 hreflang 集合**（四语言 + x-default），缺失会让 Google 把不同语言版本判为重复内容
- **工况落地页的 canonical 指向自身**，不得指向商品页——指向商品页等于放弃该页排名
- **`has_own_page = 0` 的工况不生成独立页面、不进 sitemap**
- **静态页中的库存数字视为可能过期**，真实库存由客户端补数据覆盖

---

## Task 1: 站点配置与 SEO 工具层

**Files:** `src/config/site.ts`、`src/lib/seo.ts`、`tests/lib/seo.test.ts`

**Produces:**
- `SITE: { url: string; name: string }`（`url` 从 `NEXT_PUBLIC_SITE_URL` 读，缺省 `http://localhost:3000`）
- `absoluteUrl(path: string): string`
- `buildAlternates(pathByLocale: (locale: Locale) => string): { canonical: string; languages: Record<string, string> }`
- `localePath(locale: Locale, ...segments: string[]): string`

**测试点：**
1. `localePath("de", "products", "x")` → `/de/products/x`
2. `buildAlternates` 输出四语言全集
3. `buildAlternates` 输出 `x-default` 且指向默认语言
4. canonical 为绝对 URL
5. 路径拼接不产生重复斜杠

## Task 2: 商品详情查询

**Files:** `src/lib/queries/products.ts`（扩展）、`tests/lib/queries/product-detail.test.ts`

**Produces:**
- `getProductDetail(db, slug, locale, currency): Promise<ProductDetail | null>`
  返回：商品基础字段、该语言翻译、`features[]`、`useCases[]`（含 `hasOwnPage`）、`variants[]`（含 `moq`、交期、该币种价格与实际币种）
- `listProductSlugs(db): Promise<string[]>` —— 供 `generateStaticParams`
- `listUseCasePages(db): Promise<{ slug: string; locale: Locale; useCaseSlug: string }[]>` —— 仅 `has_own_page = 1`

**测试点：**
1. 未知 slug 返回 null
2. archived 商品返回 null
3. 按 locale 取到对应语言的名称与描述
4. features 与 useCases 按 `sort_order` 排序
5. variants 带 moq 与交期区间
6. 价格按请求币种，缺价回落基准币种并如实报告
7. `listUseCasePages` 只返回 `has_own_page = 1` 的记录

## Task 3: 商品详情页

**Files:** `src/app/[locale]/products/[slug]/page.tsx`、`tests/app/product-page.test.ts`

**内容块顺序**（SEO 与阅读动线一致）：名称 → 摘要 → 价格与 MOQ/交期 → 描述 → 产品特性 → 使用工况（`has_own_page` 的给出内链）

**Produces:** `generateStaticParams`（四语言 × 全部 slug）、`generateMetadata`（title/description 取自翻译表，含 alternates）

**测试点：** 交给 Task 4 的 JSON-LD 测试与构建产物断言（见验收）

## Task 4: 结构化数据（JSON-LD）

**Files:** `src/lib/seo/jsonld.ts`、`tests/lib/jsonld.test.ts`

**Produces:**
- `productJsonLd(input): object` —— `Product` + `Offer`（`price`、`priceCurrency`、`availability`）
- `breadcrumbJsonLd(items): object`
- `useCaseJsonLd(input): object` —— `Article` + 关联 `Product`

**测试点：**
1. 价格以主单位小数字符串输出（`"99.00"`），不是最小单位整数
2. `priceCurrency` 与实际币种一致
3. 库存为 0 时 availability 为 `OutOfStock`
4. `offers` 覆盖全部 SKU
5. breadcrumb 的 position 从 1 递增
6. 含 MOQ 时输出 `eligibleQuantity`，含交期时输出 `deliveryLeadTime`

## Task 5: 工况落地页

**Files:** `src/app/[locale]/products/[slug]/[useCaseSlug]/page.tsx`

**Produces:** 仅对 `has_own_page = 1` 生成；canonical 指向自身；面包屑回溯到商品页；页面底部内链回商品页与同商品其他工况页。

**测试点：** `has_own_page = 0` 的 slug 访问返回 404（构建期不生成 + 运行时 notFound）

## Task 6: 商品列表页

**Files:** `src/app/[locale]/products/page.tsx`

复用 `listActiveProducts`，输出 `CollectionPage` + `ItemList` JSON-LD。

## Task 7: sitemap 与 robots

**Files:** `src/app/sitemap.ts`、`src/app/robots.ts`、`tests/app/sitemap.test.ts`

**Produces:** 全部语言的首页、列表页、商品页、`has_own_page` 工况页，带 `lastModified`；robots 屏蔽 `/cart`、`/checkout`、`/account`、`/admin`、`/api`。

**测试点：**
1. 每个商品出现四次（四语言）
2. `has_own_page = 0` 的工况不出现
3. archived 商品不出现
4. 每条含 alternates 语言映射
5. robots 的 disallow 清单完整

## Task 8: 库存实时补数据

**Files:** `src/app/api/inventory/route.ts`、`src/components/LiveStock.tsx`、`tests/app/inventory-api.test.ts`

**契约：** `GET /api/inventory?variants=a,b` → `{ items: [{ variantId, stock, priceMinor, currency }] }`

**测试点：**
1. 返回请求的 variant 的实时库存
2. 未知 variantId 被忽略而非报错
3. 缺参数返回 400
4. variant 数量超过 50 个返回 400（防滥用）
5. 响应头 `Cache-Control: no-store`

## 完成标准

- `pnpm test` 全绿，`pnpm typecheck`、`pnpm lint` 通过
- `pnpm build` 生成：4 语言 × (首页 + 列表页 + 商品页) + 4 语言 × 独立工况页
- 商品页 HTML 中含完整 hreflang 集合、自指 canonical、`Product` JSON-LD
- `/sitemap.xml` 可访问且不含 `has_own_page = 0` 的工况页

---

## 执行记录（2026-09-04）

阶段 2 全部 8 个任务已完成并验证。

**新增页面**：4 语言 ×（首页 + 列表页 + 商品页 + 工况落地页）= 16 个静态页，另加 `/sitemap.xml`、`/robots.txt`、`/api/inventory`。

**实现中发现并修复的两个真实缺陷：**

1. **hreflang 指向 404**（严重）。工况落地页的 slug 逐语言本地化，但初版让所有语言共用英文 slug 拼 hreflang，导致德/法/西的 hreflang 全部指向不存在的页面。根因是 `product_use_cases` 各语言行之间没有共同标识。修复：新增 `group_key` 列（见 spec 4.2.1）与 `getUseCaseAlternates` 查询，逐语言取真实 slug；缺翻译的语言直接省略该 hreflang 条目而非用别的语言顶替。

2. **构建期 D1 并发失败**。`generateStaticParams` 读本地 D1 时，多个 Next 构建 worker 并发连同一个 miniflare SQLite 触发 `D1_ERROR: internal error`。修复：`next.config.ts` 设 `experimental.cpus = 1`、`workerThreads = false`，构建串行化。

**其他偏差：**

| 偏差 | 原因 |
|---|---|
| 迁移合并为单个 `0000` 而非追加 `0001` | SQLite 不支持给已有表加无默认值的 NOT NULL 列；项目尚未部署到任何远端，合并是安全的 |
| `useCaseJsonLd` 更名为 `buildUseCaseJsonLd` | ESLint 的 `react-hooks/rules-of-hooks` 把 `use` 前缀误判为 React Hook |
| 提前实现根路径重定向（原属阶段 2 计划外） | 已在阶段 1 补齐 |

**验证结果**：`pnpm test` 110 个用例全绿（15 个测试文件）、`pnpm typecheck`、`pnpm lint`、`pnpm build` 全部通过。

dev 模式实测：
- `/sitemap.xml` 16 条，不含 `has_own_page = 0` 的工况，工况页 URL 为各语言本地化 slug
- `/robots.txt` disallow 清单完整（api/admin/cart/checkout/account/带参 URL）
- `/api/inventory?variants=...&currency=EUR` 返回实时库存与回落后的真实币种；缺参数返回 400
- 未成页的工况 URL 返回 404
- 商品页 HTML 含四语言 hreflang + x-default、自指 canonical、Product/Offer/BreadcrumbList JSON-LD（含 MOQ 的 `eligibleQuantity` 与交期的 `deliveryLeadTime`）
