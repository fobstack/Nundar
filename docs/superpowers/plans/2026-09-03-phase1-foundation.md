# 阶段 1：项目地基 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭起可运行、可测试、可部署的项目地基——Next.js on Cloudflare Workers 骨架、完整 D1 表结构与迁移、金额与定价核心工具、种子数据，最终部署到 Cloudflare 跑通。

**Architecture:** Next.js App Router 经 `@opennextjs/cloudflare` 部署至 Cloudflare Workers；D1 为主库，用 Drizzle 定义 schema 并由 drizzle-kit 生成迁移、wrangler 应用；ISR 缓存采用 R2 增量缓存 + Durable Object 队列与 tag cache；测试跑在真实 Workers 运行时（`@cloudflare/vitest-pool-workers`）而非 Node mock。

**Tech Stack:** Next.js (App Router) · TypeScript · Tailwind CSS · `@opennextjs/cloudflare` · Cloudflare D1 / R2 / KV / Cron · Drizzle ORM + drizzle-kit · Zod · Vitest + `@cloudflare/vitest-pool-workers`

**Spec:** `docs/superpowers/specs/2026-09-03-shopcf-design.md`

## Global Constraints

以下为全项目约束，每个任务的要求隐含包含本节：

- **金额一律用最小货币单位整数**（字段后缀 `_minor`），任何环节不得出现浮点金额运算。
- **语言固定四门**：`en`（默认，承担 `x-default`）、`de`、`fr`、`es`；集中配置于 `src/config/locales.ts`，新增语言只改配置不改表结构。
- **币种固定三种**：`USD`（基准）、`EUR`、`GBP`。
- **禁止按 IP 强制跳转或强制切换语言、币种**。语言由 URL 路径前缀唯一决定；`request.cf.country` 只可用于显示提示条，绝不自动跳转或改写内容。
- **仓库零硬编码密钥**。全部走 `wrangler secret` / 环境变量，提供 `.dev.vars.example` 模板。
- **翻译内容一律拆到 translation 表**，主表不得出现 `name_en` / `name_de` 这类按语言开列的字段。
- **单租户**：不引入 `tenant_id`、不做租户隔离逻辑。
- **测试跑在 Workers 运行时**，不使用 Node mock 替代 D1/KV/R2。
- **提交信息用 Conventional Commits**，一个 commit 只做一件事，不附加任何 AI 署名或 `Co-authored-by`。

## 前置条件（需要人工完成，无法由执行者代劳）

以下步骤需要 Cloudflare 账号凭据，执行到 Task 5 与 Task 9 前必须由项目所有者完成：

1. `wrangler login` 完成账号授权
2. Task 5 中的 `wrangler d1 create shopcf` 会输出 `database_id`，需填入 `wrangler.jsonc`
3. Task 9 部署需要账号具备 Workers 与 R2 权限

执行者遇到这些步骤时应停下来告知所有者，不要尝试绕过。

---

## File Structure

```
src/
├── config/
│   ├── locales.ts          语言清单、默认语言、locale→默认币种映射
│   ├── currency.ts         币种清单、基准币种、小数位、定价引擎参数
│   └── site.ts             站点名、域名、社交账号等站点级配置
├── db/
│   ├── schema/
│   │   ├── product.ts      products / translations / features / use_cases / variants / prices / images
│   │   ├── order.ts        orders / order_items / stripe_events / inventory_adjustments
│   │   ├── customer.ts     customers / customer_addresses / admin_users
│   │   ├── pricing.ts      exchange_rates
│   │   └── index.ts        汇总导出，供 drizzle-kit 与运行时使用
│   └── client.ts           getDb / getDbAsync（绑定 D1，区分动态与静态路由）
├── lib/
│   ├── money.ts            最小单位整数的构造、运算、格式化
│   ├── pricing.ts          汇率换算、缓冲系数、心理价位取整、重算阈值判定
│   └── queries/
│       └── products.ts     商品读取查询（与路由解耦，便于独立测试）
├── app/
│   └── [locale]/page.tsx   最小首页，验证数据到页面链路
└── scripts/
    ├── seed-data.ts        种子数据定义（唯一来源，四语言完整内容）
    ├── seed.ts             经 drizzle 写库，供测试使用
    └── build-seed-sql.ts   生成 drizzle/seed.sql，供 wrangler 命令行灌数据

drizzle/migrations/         drizzle-kit 生成的迁移 SQL
tests/                      与 src 同构的测试目录
wrangler.jsonc              绑定配置（D1 / R2 / KV / DO / Cron）
open-next.config.ts         OpenNext Cloudflare 缓存装配
drizzle.config.ts           drizzle-kit 配置
.dev.vars.example           本地环境变量模板
```

**分文件理由**：`config/` 与 `lib/` 是纯函数与常量，不依赖 Cloudflare 运行时，可在普通 Node 环境下快速单测；`db/` 依赖绑定，测试须跑在 Workers 运行时。两者分开可让绝大多数逻辑测试保持毫秒级。schema 按业务域拆四个文件而非按技术层拆，因为一起变更的表在一起。

---

### Task 1: 项目脚手架与工程基线

**Files:**
- Create: 整个项目骨架（由脚手架命令生成）
- Create: `vitest.config.ts`
- Create: `tests/setup.test.ts`
- Modify: `package.json`（补脚本）
- Modify: `next.config.ts`

**Interfaces:**
- Consumes: 无（首个任务）
- Produces: 可运行的 `pnpm dev` / `pnpm test` / `pnpm lint`；`initOpenNextCloudflareForDev()` 已在 `next.config.ts` 生效

- [ ] **Step 1: 生成项目骨架**

在 `/Users/jasonyu/workspace/company/shopcf` 目录下执行。注意当前目录已有 `docs/` 与 `.git/`，脚手架需生成到临时目录再合并，避免覆盖已有文件。

```bash
cd /Users/jasonyu/workspace/company/shopcf
npm create cloudflare@latest -- .shopcf-scaffold --framework=next --platform=workers
```

交互选项按此选择：TypeScript、ESLint、Tailwind CSS、App Router、`src/` 目录、import alias `@/*`。

- [ ] **Step 2: 合并脚手架产物到仓库根目录**

```bash
cd /Users/jasonyu/workspace/company/shopcf
rsync -a --exclude='.git' .shopcf-scaffold/ ./
rm -rf .shopcf-scaffold
git status --short
```

确认 `docs/` 与 `.gitignore` 未被破坏。若脚手架覆盖了 `.gitignore`，把原有内容手工并回去（原文件已在 git 历史中，可用 `git diff .gitignore` 对照）。

- [ ] **Step 3: 确认 `next.config.ts` 已启用本地 Cloudflare 上下文**

文件应包含以下内容，缺失则补上：

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;

import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
```

- [ ] **Step 4: 安装测试与数据层依赖**

```bash
pnpm add drizzle-orm zod
pnpm add -D drizzle-kit vitest @cloudflare/vitest-pool-workers @vitest/coverage-v8
```

- [ ] **Step 5: 配置 Vitest 跑在 Workers 运行时**

创建 `vitest.config.ts`：

```typescript
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          compatibilityFlags: ["nodejs_compat"],
        },
      },
    },
  },
});
```

- [ ] **Step 6: 写一个验证测试基线可用的测试**

创建 `tests/setup.test.ts`：

```typescript
import { describe, expect, it } from "vitest";

describe("test harness", () => {
  it("runs inside a Workers-like runtime with crypto available", () => {
    expect(typeof crypto.randomUUID).toBe("function");
    expect(crypto.randomUUID()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});
```

- [ ] **Step 7: 补 package.json 脚本**

`scripts` 字段应包含：

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "db:generate": "drizzle-kit generate",
    "db:migrate:local": "wrangler d1 migrations apply shopcf --local",
    "db:migrate:remote": "wrangler d1 migrations apply shopcf --remote",
    "preview": "opennextjs-cloudflare build && opennextjs-cloudflare preview",
    "deploy": "opennextjs-cloudflare build && opennextjs-cloudflare deploy"
  }
}
```

- [ ] **Step 8: 跑通全部基线命令**

```bash
pnpm test
pnpm typecheck
pnpm lint
```

三条全部通过才算完成。`pnpm test` 预期输出 1 passed。

- [ ] **Step 9: 提交**

```bash
git add -A
git commit -m "chore: 初始化 Next.js on Cloudflare 项目骨架与测试基线"
```

---

### Task 2: 语言与币种配置层

**Files:**
- Create: `src/config/locales.ts`
- Create: `src/config/currency.ts`
- Test: `tests/config/locales.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `LOCALES: readonly Locale[]`，`Locale = "en" | "de" | "fr" | "es"`
  - `DEFAULT_LOCALE: Locale`（值为 `"en"`）
  - `isLocale(value: string): value is Locale`
  - `defaultCurrencyForLocale(locale: Locale): Currency`
  - `CURRENCIES: readonly Currency[]`，`Currency = "USD" | "EUR" | "GBP"`
  - `BASE_CURRENCY: Currency`（值为 `"USD"`）
  - `CURRENCY_MINOR_UNITS: Record<Currency, number>`
  - `PRICING: { bufferRate: number; recalcThreshold: number; roundingStrategy: "ending99" | "integer" }`

- [ ] **Step 1: 写失败测试**

创建 `tests/config/locales.test.ts`：

```typescript
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  LOCALES,
  defaultCurrencyForLocale,
  isLocale,
} from "@/config/locales";
import { BASE_CURRENCY, CURRENCIES, CURRENCY_MINOR_UNITS, PRICING } from "@/config/currency";

describe("locales config", () => {
  it("ships exactly the four target-market locales", () => {
    expect([...LOCALES]).toEqual(["en", "de", "fr", "es"]);
  });

  it("defaults to English, which also carries x-default", () => {
    expect(DEFAULT_LOCALE).toBe("en");
  });

  it("narrows unknown strings", () => {
    expect(isLocale("de")).toBe(true);
    expect(isLocale("zh")).toBe(false);
  });

  it("maps each locale to a default currency", () => {
    expect(defaultCurrencyForLocale("en")).toBe("USD");
    expect(defaultCurrencyForLocale("de")).toBe("EUR");
    expect(defaultCurrencyForLocale("fr")).toBe("EUR");
    expect(defaultCurrencyForLocale("es")).toBe("EUR");
  });
});

describe("currency config", () => {
  it("ships USD as base plus EUR and GBP", () => {
    expect([...CURRENCIES]).toEqual(["USD", "EUR", "GBP"]);
    expect(BASE_CURRENCY).toBe("USD");
  });

  it("uses two minor-unit decimals for every shipped currency", () => {
    expect(CURRENCY_MINOR_UNITS).toEqual({ USD: 2, EUR: 2, GBP: 2 });
  });

  it("carries the pricing-engine defaults from the spec", () => {
    expect(PRICING.bufferRate).toBe(0.03);
    expect(PRICING.recalcThreshold).toBe(0.02);
    expect(PRICING.roundingStrategy).toBe("ending99");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm vitest run tests/config/locales.test.ts
```

预期：FAIL，报错 `Cannot find module '@/config/locales'`。

- [ ] **Step 3: 实现配置**

创建 `src/config/locales.ts`：

```typescript
import type { Currency } from "./currency";

export const LOCALES = ["en", "de", "fr", "es"] as const;

export type Locale = (typeof LOCALES)[number];

/** 默认语言，同时承担 hreflang 的 x-default */
export const DEFAULT_LOCALE: Locale = "en";

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/**
 * 语言的默认币种。用户可手动切换到任意受支持币种，选择存 cookie。
 * 绝不依据访问者 IP 自动切换——那会让爬虫只看到一个版本。
 */
const LOCALE_DEFAULT_CURRENCY: Record<Locale, Currency> = {
  en: "USD",
  de: "EUR",
  fr: "EUR",
  es: "EUR",
};

export function defaultCurrencyForLocale(locale: Locale): Currency {
  return LOCALE_DEFAULT_CURRENCY[locale];
}
```

创建 `src/config/currency.ts`：

```typescript
export const CURRENCIES = ["USD", "EUR", "GBP"] as const;

export type Currency = (typeof CURRENCIES)[number];

/** 基准币种：运营只手填这个币种的价格，其余由汇率换算生成 */
export const BASE_CURRENCY: Currency = "USD";

/** 各币种最小单位的小数位数，用于金额整数与展示值互转 */
export const CURRENCY_MINOR_UNITS: Record<Currency, number> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
};

export const PRICING = {
  /** 汇率缓冲，覆盖汇率波动与 Stripe 跨境手续费 */
  bufferRate: 0.03,
  /** 汇率偏离超过该比例才重算价格，避免价格每日跳动 */
  recalcThreshold: 0.02,
  /** 换算结果的心理价位取整策略 */
  roundingStrategy: "ending99",
} as const;
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm vitest run tests/config/locales.test.ts
```

预期：PASS，9 个断言全绿。

- [ ] **Step 5: 提交**

```bash
git add src/config tests/config
git commit -m "feat: 新增语言与币种配置层，锁定四语言三币种与定价引擎参数"
```

---

### Task 3: 金额工具（最小货币单位整数）

**Files:**
- Create: `src/lib/money.ts`
- Test: `tests/lib/money.test.ts`

**Interfaces:**
- Consumes: `Currency`、`CURRENCY_MINOR_UNITS`（Task 2）；`Locale`（Task 2）
- Produces:
  - `toMinor(amount: number, currency: Currency): number`
  - `fromMinor(minor: number, currency: Currency): number`
  - `formatMoney(minor: number, currency: Currency, locale: Locale): string`
  - `multiplyMinor(minor: number, factor: number): number`（四舍五入到整数）
  - `sumMinor(values: number[]): number`

- [ ] **Step 1: 写失败测试**

创建 `tests/lib/money.test.ts`：

```typescript
import { describe, expect, it } from "vitest";
import { formatMoney, fromMinor, multiplyMinor, sumMinor, toMinor } from "@/lib/money";

describe("toMinor", () => {
  it("converts a decimal amount to integer minor units", () => {
    expect(toMinor(99, "USD")).toBe(9900);
    expect(toMinor(99.5, "USD")).toBe(9950);
    expect(toMinor(0.01, "USD")).toBe(1);
  });

  it("rounds rather than truncates float artefacts", () => {
    // 1.005 在 IEEE754 下实为 1.00499999...，截断会得到 100
    expect(toMinor(1.005, "USD")).toBe(101);
  });

  it("rejects non-finite input instead of producing NaN money", () => {
    expect(() => toMinor(Number.NaN, "USD")).toThrow(/finite/i);
    expect(() => toMinor(Number.POSITIVE_INFINITY, "USD")).toThrow(/finite/i);
  });
});

describe("fromMinor", () => {
  it("converts integer minor units back to a decimal amount", () => {
    expect(fromMinor(9900, "USD")).toBe(99);
    expect(fromMinor(9199, "EUR")).toBe(91.99);
  });

  it("rejects non-integer minor units", () => {
    expect(() => fromMinor(99.5, "USD")).toThrow(/integer/i);
  });
});

describe("multiplyMinor", () => {
  it("keeps the result an integer", () => {
    expect(multiplyMinor(9900, 0.92)).toBe(9108);
    expect(multiplyMinor(9900, 1.03)).toBe(10197);
  });

  it("rounds half away from zero", () => {
    expect(multiplyMinor(101, 0.5)).toBe(51);
  });
});

describe("sumMinor", () => {
  it("adds integer amounts without float drift", () => {
    expect(sumMinor([1010, 2020, 3030])).toBe(6060);
    expect(sumMinor([])).toBe(0);
  });
});

describe("formatMoney", () => {
  it("formats per locale and currency", () => {
    // 断言只检查关键片段，避免绑定各 ICU 版本的空格与符号位置差异
    const usd = formatMoney(9900, "USD", "en");
    expect(usd).toContain("99");
    expect(usd).toContain("$");

    const eur = formatMoney(9199, "EUR", "de");
    expect(eur).toContain("91,99");
    expect(eur).toContain("€");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm vitest run tests/lib/money.test.ts
```

预期：FAIL，`Cannot find module '@/lib/money'`。

- [ ] **Step 3: 实现金额工具**

创建 `src/lib/money.ts`：

```typescript
import { CURRENCY_MINOR_UNITS, type Currency } from "@/config/currency";
import type { Locale } from "@/config/locales";

function factorFor(currency: Currency): number {
  return 10 ** CURRENCY_MINOR_UNITS[currency];
}

/** 四舍五入且对 .5 一律远离零取整，避免 Math.round 对负数的偏向 */
function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * 把带小数的金额转成最小货币单位整数。
 * 先乘再修正浮点误差：1.005 * 100 在 IEEE754 下是 100.49999999999999，
 * 直接 round 会得到 100，故先用 toFixed 收敛有效位。
 */
export function toMinor(amount: number, currency: Currency): number {
  if (!Number.isFinite(amount)) {
    throw new Error(`Amount must be a finite number, received: ${amount}`);
  }
  const digits = CURRENCY_MINOR_UNITS[currency];
  return roundHalfAwayFromZero(Number((amount * factorFor(currency)).toFixed(digits + 2)));
}

export function fromMinor(minor: number, currency: Currency): number {
  if (!Number.isInteger(minor)) {
    throw new Error(`Minor amount must be an integer, received: ${minor}`);
  }
  return minor / factorFor(currency);
}

/** 最小单位整数乘以系数（汇率、缓冲），结果仍为整数 */
export function multiplyMinor(minor: number, factor: number): number {
  if (!Number.isInteger(minor)) {
    throw new Error(`Minor amount must be an integer, received: ${minor}`);
  }
  if (!Number.isFinite(factor)) {
    throw new Error(`Factor must be a finite number, received: ${factor}`);
  }
  return roundHalfAwayFromZero(minor * factor);
}

export function sumMinor(values: number[]): number {
  return values.reduce((total, value) => {
    if (!Number.isInteger(value)) {
      throw new Error(`Minor amount must be an integer, received: ${value}`);
    }
    return total + value;
  }, 0);
}

export function formatMoney(minor: number, currency: Currency, locale: Locale): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(fromMinor(minor, currency));
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm vitest run tests/lib/money.test.ts
```

预期：PASS。若 `formatMoney` 的 de 断言因运行时 ICU 数据缺失而失败，检查 `vitest.config.ts` 的 `compatibilityFlags` 是否含 `nodejs_compat`，不要改断言去迁就。

- [ ] **Step 5: 提交**

```bash
git add src/lib/money.ts tests/lib/money.test.ts
git commit -m "feat: 新增最小货币单位金额工具，杜绝浮点金额运算"
```

---

### Task 4: 定价引擎纯函数

**Files:**
- Create: `src/lib/pricing.ts`
- Test: `tests/lib/pricing.test.ts`

**Interfaces:**
- Consumes: `multiplyMinor`（Task 3）；`PRICING`、`Currency`、`BASE_CURRENCY`（Task 2）
- Produces:
  - `applyPsychologicalRounding(minor: number, strategy: "ending99" | "integer"): number`
  - `convertPrice(input: { baseMinor: number; rate: number; bufferRate?: number; strategy?: "ending99" | "integer" }): number`
  - `needsRecalculation(input: { rateUsed: number; currentRate: number; threshold?: number }): boolean`

- [ ] **Step 1: 写失败测试**

创建 `tests/lib/pricing.test.ts`：

```typescript
import { describe, expect, it } from "vitest";
import { applyPsychologicalRounding, convertPrice, needsRecalculation } from "@/lib/pricing";

describe("applyPsychologicalRounding", () => {
  it("rounds up to the next .99 ending", () => {
    expect(applyPsychologicalRounding(9108, "ending99")).toBe(9199);
    expect(applyPsychologicalRounding(9200, "ending99")).toBe(9299);
  });

  it("leaves an amount already ending in .99 untouched", () => {
    expect(applyPsychologicalRounding(9199, "ending99")).toBe(9199);
  });

  it("rounds up to a whole unit under the integer strategy", () => {
    expect(applyPsychologicalRounding(9108, "integer")).toBe(9200);
    expect(applyPsychologicalRounding(9200, "integer")).toBe(9200);
  });
});

describe("convertPrice", () => {
  it("applies rate, buffer, then psychological rounding", () => {
    // 9900 * 0.92 = 9108; * 1.03 = 9381.24 → 9381 → .99 取整 → 9399
    expect(convertPrice({ baseMinor: 9900, rate: 0.92 })).toBe(9399);
  });

  it("honours an explicit zero buffer", () => {
    // 9900 * 0.92 = 9108 → 9199
    expect(convertPrice({ baseMinor: 9900, rate: 0.92, bufferRate: 0 })).toBe(9199);
  });

  it("rejects a non-positive rate rather than producing a free product", () => {
    expect(() => convertPrice({ baseMinor: 9900, rate: 0 })).toThrow(/rate/i);
    expect(() => convertPrice({ baseMinor: 9900, rate: -1 })).toThrow(/rate/i);
  });
});

describe("needsRecalculation", () => {
  it("stays put while the rate drifts under the threshold", () => {
    // 0.92 → 0.93 是 1.09% 偏离，低于 2% 阈值
    expect(needsRecalculation({ rateUsed: 0.92, currentRate: 0.93 })).toBe(false);
  });

  it("triggers once the rate drifts beyond the threshold", () => {
    // 0.92 → 0.95 是 3.26% 偏离
    expect(needsRecalculation({ rateUsed: 0.92, currentRate: 0.95 })).toBe(true);
  });

  it("triggers symmetrically when the rate falls", () => {
    // 0.92 → 0.88 是 4.35% 偏离
    expect(needsRecalculation({ rateUsed: 0.92, currentRate: 0.88 })).toBe(true);
  });

  it("always recalculates when no previous rate was recorded", () => {
    expect(needsRecalculation({ rateUsed: 0, currentRate: 0.92 })).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm vitest run tests/lib/pricing.test.ts
```

预期：FAIL，`Cannot find module '@/lib/pricing'`。

- [ ] **Step 3: 实现定价引擎**

创建 `src/lib/pricing.ts`：

```typescript
import { PRICING } from "@/config/currency";
import { multiplyMinor } from "@/lib/money";

type RoundingStrategy = "ending99" | "integer";

/**
 * 心理价位取整，一律向上取整——向下取整会侵蚀已算好的汇率缓冲。
 * ending99：取到不小于原值的、以 99 分结尾的最小金额
 * integer：取到不小于原值的整单位金额
 */
export function applyPsychologicalRounding(
  minor: number,
  strategy: RoundingStrategy,
): number {
  if (!Number.isInteger(minor)) {
    throw new Error(`Minor amount must be an integer, received: ${minor}`);
  }
  const unit = 100;
  if (strategy === "integer") {
    return Math.ceil(minor / unit) * unit;
  }
  const wholeUnits = Math.floor(minor / unit);
  const candidate = wholeUnits * unit + 99;
  return candidate >= minor ? candidate : (wholeUnits + 1) * unit + 99;
}

/** 基准价 → 目标币种价格：汇率 → 缓冲 → 心理价位取整 */
export function convertPrice(input: {
  baseMinor: number;
  rate: number;
  bufferRate?: number;
  strategy?: RoundingStrategy;
}): number {
  const { baseMinor, rate } = input;
  const bufferRate = input.bufferRate ?? PRICING.bufferRate;
  const strategy = input.strategy ?? PRICING.roundingStrategy;

  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`Exchange rate must be a positive finite number, received: ${rate}`);
  }

  const converted = multiplyMinor(baseMinor, rate);
  const buffered = multiplyMinor(converted, 1 + bufferRate);
  return applyPsychologicalRounding(buffered, strategy);
}

/**
 * 判断是否需要按新汇率重算价格。
 * 汇率每日更新，但价格只在偏离超过阈值时才动——否则静态页需每日全量再生成，
 * 且 JSON-LD 价格与结算价格频繁漂移会触发 Google Merchant 警告。
 */
export function needsRecalculation(input: {
  rateUsed: number;
  currentRate: number;
  threshold?: number;
}): boolean {
  const { rateUsed, currentRate } = input;
  const threshold = input.threshold ?? PRICING.recalcThreshold;

  // 从未记录过计算汇率（新价格或历史数据缺失），必须算一次
  if (!rateUsed || rateUsed <= 0) {
    return true;
  }

  const drift = Math.abs(currentRate - rateUsed) / rateUsed;
  return drift > threshold;
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm vitest run tests/lib/pricing.test.ts
```

预期：PASS，11 个断言全绿。

- [ ] **Step 5: 提交**

```bash
git add src/lib/pricing.ts tests/lib/pricing.test.ts
git commit -m "feat: 新增定价引擎纯函数，实现汇率换算、缓冲与心理价位取整"
```

---

### Task 5: D1 表结构与迁移

**Files:**
- Create: `src/db/schema/product.ts`
- Create: `src/db/schema/order.ts`
- Create: `src/db/schema/customer.ts`
- Create: `src/db/schema/pricing.ts`
- Create: `src/db/schema/index.ts`
- Create: `drizzle.config.ts`
- Create: `.dev.vars.example`
- Modify: `wrangler.jsonc`
- Test: `tests/db/schema.test.ts`

**Interfaces:**
- Consumes: 无（schema 为独立定义）
- Produces: 全部表的 Drizzle 定义，供 `src/db/client.ts`（Task 6）与后续所有数据访问使用。导出名：`products`、`productTranslations`、`productFeatures`、`productUseCases`、`productVariants`、`variantPrices`、`productImages`、`exchangeRates`、`orders`、`orderItems`、`stripeEvents`、`inventoryAdjustments`、`customers`、`customerAddresses`、`adminUsers`

> **需要人工介入**：本任务 Step 5 的 `wrangler d1 create` 需要已完成 `wrangler login`。执行者若未获授权，停下来告知项目所有者。

- [ ] **Step 1: 写失败测试**

创建 `tests/db/schema.test.ts`。该测试跑在 Workers 运行时，用真实 D1 验证表结构可用、约束生效：

```typescript
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";

function db() {
  return drizzle(env.DB, { schema });
}

const now = () => Math.floor(Date.now() / 1000);

beforeEach(async () => {
  // 清表顺序遵循外键依赖，先子后父
  await env.DB.exec("DELETE FROM variant_prices");
  await env.DB.exec("DELETE FROM product_variants");
  await env.DB.exec("DELETE FROM product_use_cases");
  await env.DB.exec("DELETE FROM product_translations");
  await env.DB.exec("DELETE FROM products");
});

describe("product schema", () => {
  it("stores a product with per-locale translations", async () => {
    const d = db();
    await d.insert(schema.products).values({
      id: "p1",
      slug: "ball-valve-dn50",
      status: "active",
      createdAt: now(),
      updatedAt: now(),
    });
    await d.insert(schema.productTranslations).values([
      { productId: "p1", locale: "en", name: "Ball Valve DN50" },
      { productId: "p1", locale: "de", name: "Kugelhahn DN50" },
    ]);

    const rows = await d
      .select()
      .from(schema.productTranslations)
      .where(eq(schema.productTranslations.productId, "p1"));

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.locale).sort()).toEqual(["de", "en"]);
  });

  it("rejects a duplicate slug", async () => {
    const d = db();
    const base = { status: "active", createdAt: now(), updatedAt: now() };
    await d.insert(schema.products).values({ id: "p1", slug: "dup", ...base });

    await expect(
      d.insert(schema.products).values({ id: "p2", slug: "dup", ...base }),
    ).rejects.toThrow();
  });

  it("defaults moq to 1 so ordinary products need no configuration", async () => {
    const d = db();
    await d.insert(schema.products).values({
      id: "p1",
      slug: "s",
      status: "active",
      createdAt: now(),
      updatedAt: now(),
    });
    await d.insert(schema.productVariants).values({
      id: "v1",
      productId: "p1",
      sku: "SKU-1",
      stock: 10,
      optionValues: '{"size":"M"}',
    });

    const [variant] = await d
      .select()
      .from(schema.productVariants)
      .where(eq(schema.productVariants.id, "v1"));

    expect(variant.moq).toBe(1);
  });

  it("keeps one price row per variant and currency", async () => {
    const d = db();
    await d.insert(schema.products).values({
      id: "p1",
      slug: "s",
      status: "active",
      createdAt: now(),
      updatedAt: now(),
    });
    await d.insert(schema.productVariants).values({
      id: "v1",
      productId: "p1",
      sku: "SKU-1",
      stock: 10,
      optionValues: "{}",
    });
    await d.insert(schema.variantPrices).values({
      variantId: "v1",
      currency: "USD",
      amountMinor: 9900,
      source: "base",
      updatedAt: now(),
    });

    await expect(
      d.insert(schema.variantPrices).values({
        variantId: "v1",
        currency: "USD",
        amountMinor: 8800,
        source: "manual",
        updatedAt: now(),
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm vitest run tests/db/schema.test.ts
```

预期：FAIL，`Cannot find module '@/db/schema'`。

- [ ] **Step 3: 定义商品域 schema**

创建 `src/db/schema/product.ts`：

```typescript
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/** 商品主表：只放语言无关的数据，翻译内容一律进 productTranslations */
export const products = sqliteTable(
  "products",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    status: text("status").notNull(), // draft | active | archived
    primaryImageKey: text("primary_image_key"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    slugUnique: uniqueIndex("products_slug_unique").on(table.slug),
    statusIdx: index("products_status_idx").on(table.status),
  }),
);

/** 商品翻译：展示内容与 SEO meta，每语言一行 */
export const productTranslations = sqliteTable(
  "product_translations",
  {
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    locale: text("locale").notNull(),
    name: text("name").notNull(),
    summary: text("summary"),
    description: text("description"),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    seoKeywords: text("seo_keywords"),
    ogImageKey: text("og_image_key"),
    canonicalOverride: text("canonical_override"),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.productId, table.locale] }),
  }),
);

/** 产品特性：对应"产品是什么样"类长尾词 */
export const productFeatures = sqliteTable(
  "product_features",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    locale: text("locale").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    title: text("title").notNull(),
    body: text("body"),
    iconKey: text("icon_key"),
  },
  (table) => ({
    productLocaleIdx: index("product_features_product_locale_idx").on(
      table.productId,
      table.locale,
    ),
  }),
);

/** 使用工况：对应"产品用在哪"类长尾词，可提升为独立落地页 */
export const productUseCases = sqliteTable(
  "product_use_cases",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    locale: text("locale").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    scenarioTitle: text("scenario_title").notNull(),
    scenarioSlug: text("scenario_slug"),
    hasOwnPage: integer("has_own_page").notNull().default(0),
    body: text("body"),
    specHighlights: text("spec_highlights"), // JSON
  },
  (table) => ({
    productLocaleIdx: index("product_use_cases_product_locale_idx").on(
      table.productId,
      table.locale,
    ),
    // 同一商品同一语言下，独立落地页的 slug 不得重复
    slugUnique: uniqueIndex("product_use_cases_slug_unique").on(
      table.productId,
      table.locale,
      table.scenarioSlug,
    ),
  }),
);

export const productVariants = sqliteTable(
  "product_variants",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    stock: integer("stock").notNull().default(0),
    weightGrams: integer("weight_grams"),
    optionValues: text("option_values").notNull(), // JSON
    /** 最小起订量，默认 1 表示不设限制 */
    moq: integer("moq").notNull().default(1),
    leadTimeDaysMin: integer("lead_time_days_min"),
    leadTimeDaysMax: integer("lead_time_days_max"),
  },
  (table) => ({
    skuUnique: uniqueIndex("product_variants_sku_unique").on(table.sku),
    productIdx: index("product_variants_product_idx").on(table.productId),
  }),
);

/** 多币种价格：base 手填，auto 由汇率换算，manual 手动覆盖后不再自动重算 */
export const variantPrices = sqliteTable(
  "variant_prices",
  {
    variantId: text("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    currency: text("currency").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    source: text("source").notNull(), // base | auto | manual
    rateUsed: real("rate_used"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.variantId, table.currency] }),
  }),
);

/** 商品图：alt 按语言存，多语言站的 alt 也是排名信号 */
export const productImages = sqliteTable(
  "product_images",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    objectKey: text("object_key").notNull(),
    altLocale: text("alt_locale").notNull(),
    altText: text("alt_text").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => ({
    productIdx: index("product_images_product_idx").on(table.productId),
  }),
);
```

- [ ] **Step 4: 定义其余三个域的 schema**

创建 `src/db/schema/pricing.ts`：

```typescript
import { integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** 汇率快照，由 Cron Trigger 每日拉取（拉取逻辑在阶段 3 实现） */
export const exchangeRates = sqliteTable(
  "exchange_rates",
  {
    baseCurrency: text("base_currency").notNull(),
    quoteCurrency: text("quote_currency").notNull(),
    rate: real("rate").notNull(),
    fetchedAt: integer("fetched_at").notNull(),
    source: text("source").notNull(), // ecb
  },
  (table) => ({
    pk: primaryKey({ columns: [table.baseCurrency, table.quoteCurrency] }),
  }),
);
```

创建 `src/db/schema/order.ts`：

```typescript
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { productVariants } from "./product";

export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
    orderNo: text("order_no").notNull(),
    customerId: text("customer_id"),
    /** pending | paid | shipped | delivered | cancelled | refunded | oversold */
    status: text("status").notNull(),
    currency: text("currency").notNull(),
    subtotalMinor: integer("subtotal_minor").notNull(),
    shippingMinor: integer("shipping_minor").notNull().default(0),
    taxMinor: integer("tax_minor").notNull().default(0),
    totalMinor: integer("total_minor").notNull(),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    shippingAddressJson: text("shipping_address_json").notNull(),
    /** 下单时语言，用于发对应语言的通知邮件 */
    locale: text("locale").notNull(),
    trackingNo: text("tracking_no"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => ({
    orderNoUnique: uniqueIndex("orders_order_no_unique").on(table.orderNo),
    paymentIntentUnique: uniqueIndex("orders_payment_intent_unique").on(
      table.stripePaymentIntentId,
    ),
    statusIdx: index("orders_status_idx").on(table.status),
    customerIdx: index("orders_customer_idx").on(table.customerId),
  }),
);

/** 订单行存快照：商品改名改价下架都不影响历史订单 */
export const orderItems = sqliteTable(
  "order_items",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    variantId: text("variant_id").notNull(),
    skuSnapshot: text("sku_snapshot").notNull(),
    nameSnapshot: text("name_snapshot").notNull(),
    unitPriceMinor: integer("unit_price_minor").notNull(),
    quantity: integer("quantity").notNull(),
  },
  (table) => ({
    orderIdx: index("order_items_order_idx").on(table.orderId),
  }),
);

/** Webhook 幂等表：Stripe 会重投同一事件，重复处理会导致库存重复扣减 */
export const stripeEvents = sqliteTable("stripe_events", {
  eventId: text("event_id").primaryKey(),
  type: text("type").notNull(),
  processedAt: integer("processed_at").notNull(),
});

export const inventoryAdjustments = sqliteTable(
  "inventory_adjustments",
  {
    id: text("id").primaryKey(),
    variantId: text("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    delta: integer("delta").notNull(),
    /** order_paid | manual | refund | oversold_fix */
    reason: text("reason").notNull(),
    refId: text("ref_id"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => ({
    variantIdx: index("inventory_adjustments_variant_idx").on(table.variantId),
  }),
);
```

创建 `src/db/schema/customer.ts`：

```typescript
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const customers = sqliteTable(
  "customers",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    defaultLocale: text("default_locale"),
    defaultCurrency: text("default_currency"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => ({
    emailUnique: uniqueIndex("customers_email_unique").on(table.email),
  }),
);

export const customerAddresses = sqliteTable(
  "customer_addresses",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    recipient: text("recipient").notNull(),
    line1: text("line1").notNull(),
    line2: text("line2"),
    city: text("city").notNull(),
    state: text("state"),
    postalCode: text("postal_code").notNull(),
    country: text("country").notNull(),
    phone: text("phone"),
    isDefault: integer("is_default").notNull().default(0),
  },
  (table) => ({
    customerIdx: index("customer_addresses_customer_idx").on(table.customerId),
  }),
);

export const adminUsers = sqliteTable(
  "admin_users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull(), // owner | staff
    createdAt: integer("created_at").notNull(),
  },
  (table) => ({
    emailUnique: uniqueIndex("admin_users_email_unique").on(table.email),
  }),
);
```

创建 `src/db/schema/index.ts`：

```typescript
export * from "./product";
export * from "./pricing";
export * from "./order";
export * from "./customer";
```

- [ ] **Step 5: 创建 D1 数据库并配置绑定**

需要已完成 `wrangler login`。

```bash
npx wrangler d1 create shopcf
```

把输出的 `database_id` 填入 `wrangler.jsonc`。`wrangler.jsonc` 中新增/确认以下配置（保留脚手架已有字段）：

```jsonc
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "shopcf",
      "database_id": "<把 wrangler d1 create 输出的 id 填这里>",
      "migrations_dir": "drizzle/migrations"
    }
  ]
}
```

- [ ] **Step 6: 配置 drizzle-kit 并生成迁移**

创建 `drizzle.config.ts`：

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle/migrations",
  schema: "./src/db/schema/index.ts",
  dialect: "sqlite",
  driver: "d1-http",
  dbCredentials: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
    databaseId: process.env.CLOUDFLARE_DATABASE_ID!,
    token: process.env.CLOUDFLARE_D1_TOKEN!,
  },
});
```

创建 `.dev.vars.example`（真实值写进 `.dev.vars`，该文件已被 `.gitignore` 排除）：

```
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_DATABASE_ID=
CLOUDFLARE_D1_TOKEN=
```

生成迁移：

```bash
pnpm db:generate
```

检查 `drizzle/migrations/` 下生成的 SQL，确认包含全部 15 张表。

- [ ] **Step 7: 应用迁移到本地 D1 并跑测试**

```bash
pnpm db:migrate:local
pnpm vitest run tests/db/schema.test.ts
```

预期：PASS，4 个用例全绿。若 `beforeEach` 的 `DELETE FROM` 报表不存在，说明迁移未应用到测试用的 miniflare 持久化目录——检查 `vitest.config.ts` 是否正确指向 `wrangler.jsonc`。

- [ ] **Step 8: 提交**

```bash
git add src/db drizzle drizzle.config.ts wrangler.jsonc .dev.vars.example tests/db
git commit -m "feat: 定义 D1 全量表结构与迁移，覆盖商品、订单、客户与汇率四域"
```

---

### Task 6: 数据库客户端封装

**Files:**
- Create: `src/db/client.ts`
- Test: `tests/db/client.test.ts`

**Interfaces:**
- Consumes: `src/db/schema`（Task 5）
- Produces:
  - `getDb(): DrizzleD1Database<typeof schema>` —— 用于动态路由（SSR、API、后台）
  - `getDbAsync(): Promise<DrizzleD1Database<typeof schema>>` —— 用于静态路由（SSG/ISR），因为静态生成期取 Cloudflare 上下文必须异步

- [ ] **Step 1: 写失败测试**

创建 `tests/db/client.test.ts`：

```typescript
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";

describe("getDb", () => {
  it("returns a drizzle client bound to the D1 binding", async () => {
    const d = getDb();
    const rows = await d.select().from(schema.products).limit(1);
    expect(Array.isArray(rows)).toBe(true);
  });

  it("exposes the D1 binding used by the test runtime", () => {
    expect(env.DB).toBeDefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm vitest run tests/db/client.test.ts
```

预期：FAIL，`Cannot find module '@/db/client'`。

- [ ] **Step 3: 实现客户端**

创建 `src/db/client.ts`：

```typescript
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { cache } from "react";
import * as schema from "./schema";

/**
 * 动态路由用（SSR、Route Handler、后台）。
 * 用 React cache 包一层，同一请求内复用同一个客户端实例。
 */
export const getDb = cache(() => {
  const { env } = getCloudflareContext();
  return drizzle(env.DB, { schema });
});

/**
 * 静态路由用（SSG / ISR，如商品页与工况落地页）。
 * 静态生成期间取 Cloudflare 上下文必须走异步形态，用 getDb 会拿不到绑定。
 */
export const getDbAsync = cache(async () => {
  const { env } = await getCloudflareContext({ async: true });
  return drizzle(env.DB, { schema });
});
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm vitest run tests/db/client.test.ts
```

预期：PASS。

- [ ] **Step 5: 提交**

```bash
git add src/db/client.ts tests/db/client.test.ts
git commit -m "feat: 封装 D1 数据库客户端，区分动态与静态路由取绑定方式"
```

---

### Task 7: 种子数据

**Files:**
- Create: `src/scripts/seed.ts`
- Create: `src/scripts/seed-data.ts`
- Create: `src/scripts/build-seed-sql.ts`
- Test: `tests/scripts/seed.test.ts`
- Test: `tests/scripts/build-seed-sql.test.ts`
- Modify: `package.json`（新增 `db:seed:*` 脚本）

**Interfaces:**
- Consumes: `src/db/schema`（Task 5）；`toMinor`（Task 3）；`LOCALES`（Task 2）
- Produces:
  - `SEED_PRODUCTS: ProductSeed[]` —— 种子数据的唯一来源
  - `seedDatabase(db: DrizzleD1Database<typeof schema>): Promise<void>` —— 测试用，直接写库
  - `sqlString(value: string | null): string` —— SQL 字面量转义
  - `buildSeedSql(now: number): string` —— 由 `SEED_PRODUCTS` 生成可交给 wrangler 执行的 SQL

**为什么需要两条写入路径**：测试跑在 Workers 运行时里，可直接用 drizzle 写 D1；而命令行灌数据只能经 `wrangler d1 execute`，拿不到 drizzle 客户端。两条路径共用同一份 `SEED_PRODUCTS`，数据本身仍是单一来源。

- [ ] **Step 1: 写失败测试**

创建 `tests/scripts/seed.test.ts`：

```typescript
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { LOCALES } from "@/config/locales";
import { seedDatabase } from "@/scripts/seed";

function db() {
  return drizzle(env.DB, { schema });
}

beforeEach(async () => {
  await env.DB.exec("DELETE FROM variant_prices");
  await env.DB.exec("DELETE FROM product_variants");
  await env.DB.exec("DELETE FROM product_use_cases");
  await env.DB.exec("DELETE FROM product_features");
  await env.DB.exec("DELETE FROM product_translations");
  await env.DB.exec("DELETE FROM products");
  await env.DB.exec("DELETE FROM admin_users");
});

describe("seedDatabase", () => {
  it("creates at least one active product", async () => {
    const d = db();
    await seedDatabase(d);

    const products = await d.select().from(schema.products);
    expect(products.length).toBeGreaterThan(0);
    expect(products.every((p) => p.status === "active")).toBe(true);
  });

  it("provides a translation in every shipped locale for every product", async () => {
    const d = db();
    await seedDatabase(d);

    const products = await d.select().from(schema.products);
    for (const product of products) {
      const translations = await d
        .select()
        .from(schema.productTranslations)
        .where(eq(schema.productTranslations.productId, product.id));
      expect(translations.map((t) => t.locale).sort()).toEqual([...LOCALES].sort());
    }
  });

  it("seeds features and use cases so the SEO layout has content to render", async () => {
    const d = db();
    await seedDatabase(d);

    const features = await d.select().from(schema.productFeatures);
    const useCases = await d.select().from(schema.productUseCases);
    expect(features.length).toBeGreaterThan(0);
    expect(useCases.length).toBeGreaterThan(0);
  });

  it("gives every use case marked has_own_page a slug to build the URL from", async () => {
    const d = db();
    await seedDatabase(d);

    const useCases = await d.select().from(schema.productUseCases);
    for (const useCase of useCases) {
      if (useCase.hasOwnPage === 1) {
        expect(useCase.scenarioSlug).toBeTruthy();
      }
    }
  });

  it("prices every variant in the base currency with source 'base'", async () => {
    const d = db();
    await seedDatabase(d);

    const variants = await d.select().from(schema.productVariants);
    expect(variants.length).toBeGreaterThan(0);

    for (const variant of variants) {
      const prices = await d
        .select()
        .from(schema.variantPrices)
        .where(eq(schema.variantPrices.variantId, variant.id));
      const base = prices.find((p) => p.currency === "USD");
      expect(base).toBeDefined();
      expect(base!.source).toBe("base");
      expect(Number.isInteger(base!.amountMinor)).toBe(true);
    }
  });

  it("is idempotent so re-running it does not duplicate rows", async () => {
    const d = db();
    await seedDatabase(d);
    const firstCount = (await d.select().from(schema.products)).length;

    await seedDatabase(d);
    const secondCount = (await d.select().from(schema.products)).length;

    expect(secondCount).toBe(firstCount);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm vitest run tests/scripts/seed.test.ts
```

预期：FAIL，`Cannot find module '@/scripts/seed'`。

- [ ] **Step 3: 写种子数据定义**

创建 `src/scripts/seed-data.ts`。示例商品取工业阀门，因为它天然带 MOQ、交期与多工况，能完整演示系统能力：

```typescript
import type { Locale } from "@/config/locales";

type TranslationSeed = {
  name: string;
  summary: string;
  description: string;
  seoTitle: string;
  seoDescription: string;
};

type FeatureSeed = { title: string; body: string };

type UseCaseSeed = {
  scenarioTitle: string;
  scenarioSlug: string;
  hasOwnPage: boolean;
  body: string;
};

export type ProductSeed = {
  id: string;
  slug: string;
  translations: Record<Locale, TranslationSeed>;
  features: Record<Locale, FeatureSeed[]>;
  useCases: Record<Locale, UseCaseSeed[]>;
  variants: {
    id: string;
    sku: string;
    stock: number;
    optionValues: Record<string, string>;
    moq: number;
    leadTimeDaysMin: number;
    leadTimeDaysMax: number;
    basePriceUsd: number;
  }[];
};

export const SEED_PRODUCTS: ProductSeed[] = [
  {
    id: "seed-ball-valve-dn50",
    slug: "stainless-ball-valve-dn50",
    translations: {
      en: {
        name: "Stainless Steel Ball Valve DN50",
        summary: "Full-bore 316L ball valve rated to 1000 PSI for corrosive media.",
        description:
          "A full-bore two-piece ball valve machined from 316L stainless steel. Rated to 1000 PSI at ambient temperature with a PTFE seat, it handles corrosive and food-grade media without contamination. Supplied with ISO 5211 mounting for direct actuator fitting.",
        seoTitle: "Stainless Steel Ball Valve DN50 (316L, 1000 PSI) | Manufacturer Direct",
        seoDescription:
          "316L stainless ball valve DN50, full bore, 1000 PSI, PTFE seat, ISO 5211 pad. Manufacturer direct pricing with 15-20 day lead time.",
      },
      de: {
        name: "Edelstahl-Kugelhahn DN50",
        summary: "Vollbohrung-Kugelhahn aus 316L, bis 69 bar für korrosive Medien.",
        description:
          "Zweiteiliger Kugelhahn mit Vollbohrung aus Edelstahl 316L. Ausgelegt bis 69 bar bei Umgebungstemperatur mit PTFE-Sitz, geeignet für korrosive und lebensmittelechte Medien. Mit ISO-5211-Anschluss zur direkten Antriebsmontage.",
        seoTitle: "Edelstahl-Kugelhahn DN50 (316L, 69 bar) | Direkt vom Hersteller",
        seoDescription:
          "Kugelhahn DN50 aus 316L, Vollbohrung, 69 bar, PTFE-Sitz, ISO-5211-Flansch. Herstellerpreise, Lieferzeit 15-20 Tage.",
      },
      fr: {
        name: "Vanne à bille inox DN50",
        summary: "Vanne à bille passage intégral 316L, 69 bar, pour fluides corrosifs.",
        description:
          "Vanne à bille deux pièces à passage intégral usinée en acier inoxydable 316L. Pression nominale 69 bar à température ambiante avec siège PTFE, adaptée aux fluides corrosifs et de qualité alimentaire. Platine ISO 5211 pour montage direct d'actionneur.",
        seoTitle: "Vanne à bille inox DN50 (316L, 69 bar) | Vente directe usine",
        seoDescription:
          "Vanne à bille DN50 en 316L, passage intégral, 69 bar, siège PTFE, platine ISO 5211. Prix usine, délai 15-20 jours.",
      },
      es: {
        name: "Válvula de bola de acero inoxidable DN50",
        summary: "Válvula de bola de paso total 316L, 69 bar, para fluidos corrosivos.",
        description:
          "Válvula de bola de dos piezas y paso total mecanizada en acero inoxidable 316L. Presión nominal de 69 bar a temperatura ambiente con asiento de PTFE, apta para fluidos corrosivos y de grado alimentario. Incluye brida ISO 5211 para montaje directo de actuador.",
        seoTitle: "Válvula de bola inoxidable DN50 (316L, 69 bar) | Venta directa de fábrica",
        seoDescription:
          "Válvula de bola DN50 en 316L, paso total, 69 bar, asiento PTFE, brida ISO 5211. Precio de fábrica, plazo de 15-20 días.",
      },
    },
    features: {
      en: [
        {
          title: "316L stainless body",
          body: "Resists chloride pitting in seawater and chemical service where 304 fails.",
        },
        {
          title: "Full bore, zero flow restriction",
          body: "The bore matches the pipe ID, so pressure drop across the valve is negligible.",
        },
      ],
      de: [
        {
          title: "Gehäuse aus Edelstahl 316L",
          body: "Beständig gegen Lochfraß durch Chloride in Meerwasser und Chemieanwendungen, wo 304 versagt.",
        },
        {
          title: "Vollbohrung ohne Querschnittsverengung",
          body: "Die Bohrung entspricht dem Rohrinnendurchmesser, der Druckverlust ist vernachlässigbar.",
        },
      ],
      fr: [
        {
          title: "Corps en inox 316L",
          body: "Résiste à la corrosion par piqûres due aux chlorures en eau de mer, là où le 304 cède.",
        },
        {
          title: "Passage intégral, sans perte de charge",
          body: "L'alésage correspond au diamètre intérieur du tube : la perte de charge est négligeable.",
        },
      ],
      es: [
        {
          title: "Cuerpo de acero inoxidable 316L",
          body: "Resiste la corrosión por picadura de cloruros en agua de mar, donde el 304 falla.",
        },
        {
          title: "Paso total, sin restricción de caudal",
          body: "El diámetro interior coincide con el del tubo, por lo que la pérdida de carga es insignificante.",
        },
      ],
    },
    useCases: {
      en: [
        {
          scenarioTitle: "Ball valves for offshore platform seawater lines",
          scenarioSlug: "offshore-seawater-lines",
          hasOwnPage: true,
          body: "Offshore seawater service combines chloride attack with constant vibration. The 316L body resists pitting that would perforate a 304 valve within a season, while the two-piece bolted construction allows seat replacement in place rather than cutting the valve out of the line. Specify the ISO 5211 pad option if the line will later be actuated for remote shutdown.",
        },
        {
          scenarioTitle: "Food-grade dosing and CIP circuits",
          scenarioSlug: "food-grade-dosing",
          hasOwnPage: false,
          body: "The PTFE seat carries no plasticiser migration risk, and the full bore leaves no dead volume where product can stagnate between CIP cycles.",
        },
      ],
      de: [
        {
          scenarioTitle: "Kugelhähne für Seewasserleitungen auf Offshore-Plattformen",
          scenarioSlug: "offshore-seewasserleitungen",
          hasOwnPage: true,
          body: "Der Seewasserbetrieb offshore verbindet Chloridangriff mit dauernder Vibration. Das 316L-Gehäuse widersteht dem Lochfraß, der einen 304-Hahn binnen einer Saison durchschlägt, und die zweiteilige Verschraubung erlaubt den Sitzwechsel vor Ort, ohne den Hahn aus der Leitung zu trennen.",
        },
        {
          scenarioTitle: "Dosier- und CIP-Kreisläufe in der Lebensmittelindustrie",
          scenarioSlug: "lebensmittel-dosierung",
          hasOwnPage: false,
          body: "Der PTFE-Sitz birgt kein Risiko der Weichmachermigration, und die Vollbohrung lässt kein Totvolumen, in dem Produkt zwischen CIP-Zyklen stehen bleibt.",
        },
      ],
      fr: [
        {
          scenarioTitle: "Vannes à bille pour circuits d'eau de mer en plateforme offshore",
          scenarioSlug: "circuits-eau-de-mer-offshore",
          hasOwnPage: true,
          body: "En service eau de mer offshore, l'attaque par les chlorures s'ajoute aux vibrations permanentes. Le corps 316L résiste aux piqûres qui perforeraient une vanne 304 en une saison, et la construction deux pièces boulonnée permet de remplacer le siège en ligne sans découper la vanne.",
        },
        {
          scenarioTitle: "Circuits de dosage alimentaire et NEP",
          scenarioSlug: "dosage-alimentaire",
          hasOwnPage: false,
          body: "Le siège PTFE n'entraîne aucun risque de migration de plastifiant, et le passage intégral ne laisse aucun volume mort où le produit stagnerait entre deux cycles NEP.",
        },
      ],
      es: [
        {
          scenarioTitle: "Válvulas de bola para líneas de agua de mar en plataformas offshore",
          scenarioSlug: "lineas-agua-de-mar-offshore",
          hasOwnPage: true,
          body: "El servicio con agua de mar en alta mar combina el ataque por cloruros con vibración constante. El cuerpo de 316L resiste la corrosión por picadura que perforaría una válvula de 304 en una temporada, y la construcción atornillada de dos piezas permite sustituir el asiento en línea sin cortar la válvula.",
        },
        {
          scenarioTitle: "Circuitos de dosificación alimentaria y CIP",
          scenarioSlug: "dosificacion-alimentaria",
          hasOwnPage: false,
          body: "El asiento de PTFE no presenta riesgo de migración de plastificantes, y el paso total no deja volumen muerto donde el producto quede estancado entre ciclos CIP.",
        },
      ],
    },
    variants: [
      {
        id: "seed-variant-dn50-threaded",
        sku: "BV-316L-DN50-NPT",
        stock: 120,
        optionValues: { connection: "NPT threaded" },
        moq: 10,
        leadTimeDaysMin: 15,
        leadTimeDaysMax: 20,
        basePriceUsd: 99,
      },
      {
        id: "seed-variant-dn50-flanged",
        sku: "BV-316L-DN50-FLG",
        stock: 40,
        optionValues: { connection: "ANSI 150 flanged" },
        moq: 5,
        leadTimeDaysMin: 25,
        leadTimeDaysMax: 35,
        basePriceUsd: 168,
      },
    ],
  },
];
```

- [ ] **Step 4: 实现种子脚本**

创建 `src/scripts/seed.ts`：

```typescript
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { LOCALES } from "@/config/locales";
import { toMinor } from "@/lib/money";
import * as schema from "@/db/schema";
import { SEED_PRODUCTS } from "./seed-data";

/**
 * 写入种子数据。幂等：所有写入走 onConflictDoNothing，
 * 重复执行不会产生重复行，便于本地反复重置环境。
 */
export async function seedDatabase(
  db: DrizzleD1Database<typeof schema>,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  for (const product of SEED_PRODUCTS) {
    await db
      .insert(schema.products)
      .values({
        id: product.id,
        slug: product.slug,
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();

    for (const locale of LOCALES) {
      const translation = product.translations[locale];
      await db
        .insert(schema.productTranslations)
        .values({
          productId: product.id,
          locale,
          name: translation.name,
          summary: translation.summary,
          description: translation.description,
          seoTitle: translation.seoTitle,
          seoDescription: translation.seoDescription,
        })
        .onConflictDoNothing();

      const features = product.features[locale];
      for (const [index, feature] of features.entries()) {
        await db
          .insert(schema.productFeatures)
          .values({
            id: `${product.id}-feature-${locale}-${index}`,
            productId: product.id,
            locale,
            sortOrder: index,
            title: feature.title,
            body: feature.body,
          })
          .onConflictDoNothing();
      }

      const useCases = product.useCases[locale];
      for (const [index, useCase] of useCases.entries()) {
        await db
          .insert(schema.productUseCases)
          .values({
            id: `${product.id}-usecase-${locale}-${index}`,
            productId: product.id,
            locale,
            sortOrder: index,
            scenarioTitle: useCase.scenarioTitle,
            scenarioSlug: useCase.scenarioSlug,
            hasOwnPage: useCase.hasOwnPage ? 1 : 0,
            body: useCase.body,
          })
          .onConflictDoNothing();
      }
    }

    for (const variant of product.variants) {
      await db
        .insert(schema.productVariants)
        .values({
          id: variant.id,
          productId: product.id,
          sku: variant.sku,
          stock: variant.stock,
          optionValues: JSON.stringify(variant.optionValues),
          moq: variant.moq,
          leadTimeDaysMin: variant.leadTimeDaysMin,
          leadTimeDaysMax: variant.leadTimeDaysMax,
        })
        .onConflictDoNothing();

      // 只写基准币种，EUR/GBP 由阶段 3 的定价引擎按汇率生成
      await db
        .insert(schema.variantPrices)
        .values({
          variantId: variant.id,
          currency: "USD",
          amountMinor: toMinor(variant.basePriceUsd, "USD"),
          source: "base",
          updatedAt: now,
        })
        .onConflictDoNothing();
    }
  }
}
```

- [ ] **Step 5: 跑测试确认通过**

```bash
pnpm vitest run tests/scripts/seed.test.ts
```

预期：PASS，6 个用例全绿。

- [ ] **Step 6: 写 SQL 生成器的失败测试**

创建 `tests/scripts/build-seed-sql.test.ts`。转义是安全要害——种子文案里含撇号（如法语 `d'actionneur`），转义写错会生成语法错误的 SQL，写漏则是注入模式：

```typescript
import { describe, expect, it } from "vitest";
import { buildSeedSql, sqlString } from "@/scripts/build-seed-sql";

describe("sqlString", () => {
  it("wraps a plain string in single quotes", () => {
    expect(sqlString("hello")).toBe("'hello'");
  });

  it("doubles embedded single quotes", () => {
    expect(sqlString("d'actionneur")).toBe("'d''actionneur'");
  });

  it("emits NULL for null rather than the string 'null'", () => {
    expect(sqlString(null)).toBe("NULL");
  });

  it("neutralises a statement-terminating payload", () => {
    expect(sqlString("'; DROP TABLE products; --")).toBe(
      "'''; DROP TABLE products; --'",
    );
  });
});

describe("buildSeedSql", () => {
  const sql = buildSeedSql(1_700_000_000);

  it("emits inserts for every seeded table", () => {
    expect(sql).toContain("INSERT OR IGNORE INTO products");
    expect(sql).toContain("INSERT OR IGNORE INTO product_translations");
    expect(sql).toContain("INSERT OR IGNORE INTO product_features");
    expect(sql).toContain("INSERT OR IGNORE INTO product_use_cases");
    expect(sql).toContain("INSERT OR IGNORE INTO product_variants");
    expect(sql).toContain("INSERT OR IGNORE INTO variant_prices");
  });

  it("is re-runnable, so it must not use bare INSERT", () => {
    expect(sql).not.toMatch(/INSERT INTO/);
  });

  it("carries content for all four locales", () => {
    expect(sql).toContain("Stainless Steel Ball Valve DN50");
    expect(sql).toContain("Edelstahl-Kugelhahn DN50");
    expect(sql).toContain("Vanne à bille inox DN50");
    expect(sql).toContain("Válvula de bola de acero inoxidable DN50");
  });

  it("writes prices as integer minor units", () => {
    expect(sql).toContain("9900");
    expect(sql).not.toMatch(/,\s*99\.0*,/);
  });
});
```

- [ ] **Step 7: 跑测试确认失败**

```bash
pnpm vitest run tests/scripts/build-seed-sql.test.ts
```

预期：FAIL，`Cannot find module '@/scripts/build-seed-sql'`。

- [ ] **Step 8: 实现 SQL 生成器**

```bash
pnpm add -D tsx
```

创建 `src/scripts/build-seed-sql.ts`：

```typescript
import { writeFileSync } from "node:fs";
import { LOCALES } from "@/config/locales";
import { toMinor } from "@/lib/money";
import { SEED_PRODUCTS } from "./seed-data";

/** SQL 字符串字面量转义：单引号翻倍，null 转 NULL */
export function sqlString(value: string | null): string {
  if (value === null) {
    return "NULL";
  }
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * 由 SEED_PRODUCTS 生成种子 SQL。
 * 一律用 INSERT OR IGNORE，重复执行不产生重复行，与 seedDatabase 的幂等语义一致。
 */
export function buildSeedSql(now: number): string {
  const statements: string[] = [];

  for (const product of SEED_PRODUCTS) {
    statements.push(
      `INSERT OR IGNORE INTO products (id, slug, status, created_at, updated_at) VALUES (${sqlString(product.id)}, ${sqlString(product.slug)}, 'active', ${now}, ${now});`,
    );

    for (const locale of LOCALES) {
      const t = product.translations[locale];
      statements.push(
        `INSERT OR IGNORE INTO product_translations (product_id, locale, name, summary, description, seo_title, seo_description) VALUES (${sqlString(product.id)}, ${sqlString(locale)}, ${sqlString(t.name)}, ${sqlString(t.summary)}, ${sqlString(t.description)}, ${sqlString(t.seoTitle)}, ${sqlString(t.seoDescription)});`,
      );

      product.features[locale].forEach((feature, index) => {
        statements.push(
          `INSERT OR IGNORE INTO product_features (id, product_id, locale, sort_order, title, body) VALUES (${sqlString(`${product.id}-feature-${locale}-${index}`)}, ${sqlString(product.id)}, ${sqlString(locale)}, ${index}, ${sqlString(feature.title)}, ${sqlString(feature.body)});`,
        );
      });

      product.useCases[locale].forEach((useCase, index) => {
        statements.push(
          `INSERT OR IGNORE INTO product_use_cases (id, product_id, locale, sort_order, scenario_title, scenario_slug, has_own_page, body) VALUES (${sqlString(`${product.id}-usecase-${locale}-${index}`)}, ${sqlString(product.id)}, ${sqlString(locale)}, ${index}, ${sqlString(useCase.scenarioTitle)}, ${sqlString(useCase.scenarioSlug)}, ${useCase.hasOwnPage ? 1 : 0}, ${sqlString(useCase.body)});`,
        );
      });
    }

    for (const variant of product.variants) {
      statements.push(
        `INSERT OR IGNORE INTO product_variants (id, product_id, sku, stock, option_values, moq, lead_time_days_min, lead_time_days_max) VALUES (${sqlString(variant.id)}, ${sqlString(product.id)}, ${sqlString(variant.sku)}, ${variant.stock}, ${sqlString(JSON.stringify(variant.optionValues))}, ${variant.moq}, ${variant.leadTimeDaysMin}, ${variant.leadTimeDaysMax});`,
      );
      statements.push(
        `INSERT OR IGNORE INTO variant_prices (variant_id, currency, amount_minor, source, updated_at) VALUES (${sqlString(variant.id)}, 'USD', ${toMinor(variant.basePriceUsd, "USD")}, 'base', ${now});`,
      );
    }
  }

  return `${statements.join("\n")}\n`;
}

// 作为脚本直接执行时，把 SQL 写到 drizzle/seed.sql
if (process.argv[1]?.endsWith("build-seed-sql.ts")) {
  const sql = buildSeedSql(Math.floor(Date.now() / 1000));
  writeFileSync("drizzle/seed.sql", sql, "utf8");
  console.log(`Wrote drizzle/seed.sql (${sql.split("\n").length - 1} statements)`);
}
```

- [ ] **Step 9: 跑测试确认通过**

```bash
pnpm vitest run tests/scripts/build-seed-sql.test.ts
```

预期：PASS，9 个用例全绿。

- [ ] **Step 10: 补 package.json 脚本并实际灌一次本地库**

`scripts` 中新增三条：

```json
{
  "db:seed:build": "tsx src/scripts/build-seed-sql.ts",
  "db:seed:local": "pnpm db:seed:build && wrangler d1 execute shopcf --local --file=./drizzle/seed.sql",
  "db:seed:remote": "pnpm db:seed:build && wrangler d1 execute shopcf --remote --file=./drizzle/seed.sql"
}
```

`drizzle/seed.sql` 为生成产物，加入 `.gitignore`：

```bash
echo "drizzle/seed.sql" >> .gitignore
```

执行并验证：

```bash
pnpm db:seed:local
npx wrangler d1 execute shopcf --local --command "SELECT slug FROM products"
```

预期输出含 `stainless-ball-valve-dn50`。再跑一次 `pnpm db:seed:local`，商品数不应增加（幂等验证）：

```bash
npx wrangler d1 execute shopcf --local --command "SELECT COUNT(*) AS n FROM products"
```

预期 `n` 为 1。

- [ ] **Step 11: 提交**

```bash
git add src/scripts tests/scripts package.json .gitignore
git commit -m "feat: 新增幂等种子数据与 SQL 生成器，支持本地与远端一键灌数据"
```

---

### Task 8: OpenNext 缓存装配与绑定配置

**Files:**
- Create: `open-next.config.ts`
- Modify: `wrangler.jsonc`
- Test: `tests/config/bindings.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: 可用的 ISR 缓存链路（R2 增量缓存 + DO 队列 + DO 分片 tag cache），以及 `DB` / `IMAGES` / `SESSIONS` 三个业务绑定

> **需要人工介入**：Step 2 的 `wrangler r2 bucket create` 与 `wrangler kv namespace create` 需要 Cloudflare 账号授权。

- [ ] **Step 1: 写失败测试**

创建 `tests/config/bindings.test.ts`。该测试断言绑定在测试运行时确实存在，防止 `wrangler.jsonc` 配错名字到部署时才发现：

```typescript
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("cloudflare bindings", () => {
  it("exposes the D1 database as DB", () => {
    expect(env.DB).toBeDefined();
    expect(typeof env.DB.prepare).toBe("function");
  });

  it("exposes the R2 bucket for product images as IMAGES", () => {
    expect(env.IMAGES).toBeDefined();
    expect(typeof env.IMAGES.put).toBe("function");
  });

  it("exposes the KV namespace for sessions and carts as SESSIONS", () => {
    expect(env.SESSIONS).toBeDefined();
    expect(typeof env.SESSIONS.get).toBe("function");
  });
});
```

- [ ] **Step 2: 创建 R2 bucket 与 KV namespace**

```bash
npx wrangler r2 bucket create shopcf-images
npx wrangler r2 bucket create shopcf-inc-cache
npx wrangler kv namespace create SESSIONS
```

记录 `wrangler kv namespace create` 输出的 namespace id。

- [ ] **Step 3: 补全 wrangler.jsonc 绑定**

在 `wrangler.jsonc` 中补上以下配置（与 Task 5 已加的 `d1_databases` 并列，保留脚手架原有字段）：

```jsonc
{
  "compatibility_flags": ["nodejs_compat"],

  "r2_buckets": [
    {
      "binding": "IMAGES",
      "bucket_name": "shopcf-images"
    },
    {
      "binding": "NEXT_INC_CACHE_R2_BUCKET",
      "bucket_name": "shopcf-inc-cache"
    }
  ],

  "kv_namespaces": [
    {
      "binding": "SESSIONS",
      "id": "<把 wrangler kv namespace create 输出的 id 填这里>"
    }
  ],

  "services": [
    {
      "binding": "WORKER_SELF_REFERENCE",
      "service": "shopcf"
    }
  ],

  "durable_objects": {
    "bindings": [
      { "name": "NEXT_CACHE_DO_QUEUE", "class_name": "DOQueueHandler" },
      { "name": "NEXT_TAG_CACHE_DO_SHARDED", "class_name": "DOShardedTagCache" },
      { "name": "NEXT_CACHE_DO_PURGE", "class_name": "BucketCachePurge" }
    ]
  },

  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["DOQueueHandler", "DOShardedTagCache", "BucketCachePurge"]
    }
  ],

  "triggers": {
    "crons": ["0 6 * * *"]
  }
}
```

`services.service` 的值必须与 `wrangler.jsonc` 顶层 `name` 一致。Cron 定为每日 06:00 UTC，用于阶段 3 的汇率拉取；本阶段只占位，尚无 handler。

- [ ] **Step 4: 配置 OpenNext 缓存**

创建 `open-next.config.ts`：

```typescript
import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
import { withRegionalCache } from "@opennextjs/cloudflare/overrides/incremental-cache/regional-cache";
import doShardedTagCache from "@opennextjs/cloudflare/overrides/tag-cache/do-sharded-tag-cache";
import doQueue from "@opennextjs/cloudflare/overrides/queue/do-queue";
import { purgeCache } from "@opennextjs/cloudflare/overrides/cache-purge/index";

export default defineCloudflareConfig({
  // 商品页与工况页为 ISR，增量缓存放 R2 并叠加区域缓存降低回源
  incrementalCache: withRegionalCache(r2IncrementalCache, {
    mode: "long-lived",
    bypassTagCacheOnCacheHit: true,
  }),
  // 去重时间型重验证，避免同一页面被并发重复再生成
  queue: doQueue,
  // 支撑后台改内容后按需 revalidate 对应商品页
  tagCache: doShardedTagCache({ baseShardSize: 12, regionalCache: true }),
  enableCacheInterception: true,
  cachePurge: purgeCache({ type: "direct" }),
});
```

- [ ] **Step 5: 跑测试确认通过**

```bash
pnpm vitest run tests/config/bindings.test.ts
```

预期：PASS，3 个绑定全部就位。若 `env.SESSIONS` 未定义，检查 `wrangler.jsonc` 中 KV 的 `id` 是否填写。

- [ ] **Step 6: 本地构建验证配置无误**

```bash
pnpm exec opennextjs-cloudflare build
```

预期：构建成功，无缓存组件相关报错。

- [ ] **Step 7: 提交**

```bash
git add open-next.config.ts wrangler.jsonc tests/config/bindings.test.ts
git commit -m "feat: 装配 OpenNext ISR 缓存链路与 R2/KV/DO 绑定"
```

---

### Task 9: 部署跑通与开源文档

**Files:**
- Create: `README.md`
- Create: `LICENSE`
- Create: `src/lib/queries/products.ts`
- Create: `src/app/[locale]/page.tsx`
- Test: `tests/lib/queries/products.test.ts`

**Interfaces:**
- Consumes: `getDbAsync`（Task 6）；`LOCALES`、`DEFAULT_LOCALE`（Task 2）；`formatMoney`（Task 3）
- Produces: 一个能证明"数据库 → 页面 → 部署"整条链路打通的最小首页

> **需要人工介入**：Step 5 的部署需要 Cloudflare 账号具备 Workers 与 R2 权限。

- [ ] **Step 1: 写失败测试**

创建 `tests/lib/queries/products.test.ts`。测试数据取用逻辑而非渲染细节——渲染留给阶段 2：

```typescript
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { seedDatabase } from "@/scripts/seed";
import { listActiveProducts } from "@/lib/queries/products";

beforeEach(async () => {
  await env.DB.exec("DELETE FROM variant_prices");
  await env.DB.exec("DELETE FROM product_variants");
  await env.DB.exec("DELETE FROM product_use_cases");
  await env.DB.exec("DELETE FROM product_features");
  await env.DB.exec("DELETE FROM product_translations");
  await env.DB.exec("DELETE FROM products");
  await seedDatabase(drizzle(env.DB, { schema }));
});

describe("listActiveProducts", () => {
  it("returns active products with the requested locale's name", async () => {
    const db = drizzle(env.DB, { schema });
    const products = await listActiveProducts(db, "de");

    expect(products.length).toBeGreaterThan(0);
    expect(products[0].name).toBe("Edelstahl-Kugelhahn DN50");
    expect(products[0].slug).toBe("stainless-ball-valve-dn50");
  });

  it("returns the base-currency price in minor units", async () => {
    const db = drizzle(env.DB, { schema });
    const products = await listActiveProducts(db, "en");

    expect(products[0].fromPriceMinor).toBe(9900);
  });

  it("excludes archived products", async () => {
    const db = drizzle(env.DB, { schema });
    await env.DB.exec("UPDATE products SET status = 'archived'");

    const products = await listActiveProducts(db, "en");
    expect(products).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm vitest run tests/lib/queries/products.test.ts
```

预期：FAIL，`Cannot find module '@/lib/queries/products'`。

- [ ] **Step 3: 实现查询与最小首页**

创建 `src/lib/queries/products.ts`：

```typescript
import { and, asc, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { BASE_CURRENCY } from "@/config/currency";
import type { Locale } from "@/config/locales";
import * as schema from "@/db/schema";

export type ProductListItem = {
  id: string;
  slug: string;
  name: string;
  summary: string | null;
  fromPriceMinor: number | null;
};

/** 列出在售商品及其指定语言的名称与最低基准价 */
export async function listActiveProducts(
  db: DrizzleD1Database<typeof schema>,
  locale: Locale,
): Promise<ProductListItem[]> {
  const rows = await db
    .select({
      id: schema.products.id,
      slug: schema.products.slug,
      name: schema.productTranslations.name,
      summary: schema.productTranslations.summary,
      amountMinor: schema.variantPrices.amountMinor,
    })
    .from(schema.products)
    .innerJoin(
      schema.productTranslations,
      and(
        eq(schema.productTranslations.productId, schema.products.id),
        eq(schema.productTranslations.locale, locale),
      ),
    )
    .leftJoin(
      schema.productVariants,
      eq(schema.productVariants.productId, schema.products.id),
    )
    .leftJoin(
      schema.variantPrices,
      and(
        eq(schema.variantPrices.variantId, schema.productVariants.id),
        eq(schema.variantPrices.currency, BASE_CURRENCY),
      ),
    )
    .where(eq(schema.products.status, "active"))
    .orderBy(asc(schema.products.slug));

  // 一个商品有多个 SKU 会产生多行，收敛为每商品一行并取最低价
  const byProduct = new Map<string, ProductListItem>();
  for (const row of rows) {
    const existing = byProduct.get(row.id);
    if (!existing) {
      byProduct.set(row.id, {
        id: row.id,
        slug: row.slug,
        name: row.name,
        summary: row.summary,
        fromPriceMinor: row.amountMinor ?? null,
      });
      continue;
    }
    if (
      row.amountMinor !== null &&
      (existing.fromPriceMinor === null || row.amountMinor < existing.fromPriceMinor)
    ) {
      existing.fromPriceMinor = row.amountMinor;
    }
  }

  return [...byProduct.values()];
}
```

创建 `src/app/[locale]/page.tsx`：

```tsx
import { notFound } from "next/navigation";
import { defaultCurrencyForLocale, isLocale } from "@/config/locales";
import { getDbAsync } from "@/db/client";
import { formatMoney } from "@/lib/money";
import { listActiveProducts } from "@/lib/queries/products";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }

  const db = await getDbAsync();
  const products = await listActiveProducts(db, locale);
  const currency = defaultCurrencyForLocale(locale);

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">shopcf</h1>
      <ul className="mt-10 space-y-6">
        {products.map((product) => (
          <li key={product.id} className="border-b border-neutral-200 pb-6">
            <h2 className="text-lg font-medium">{product.name}</h2>
            {product.summary ? (
              <p className="mt-1 text-sm text-neutral-600">{product.summary}</p>
            ) : null}
            {product.fromPriceMinor !== null ? (
              <p className="mt-2 text-sm">
                {formatMoney(product.fromPriceMinor, currency, locale)}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </main>
  );
}
```

若脚手架生成了 `src/app/page.tsx`，删除它——首页统一走 `/[locale]`，根路径的重定向在阶段 2 随 hreflang 一起处理。

- [ ] **Step 4: 跑测试并本地验证**

```bash
pnpm vitest run tests/lib/queries/products.test.ts
pnpm db:migrate:local
pnpm db:seed:local
pnpm dev
```

浏览器访问 `http://localhost:3000/de`，应看到德语商品名 "Edelstahl-Kugelhahn DN50" 与欧元价格；访问 `/en` 应看到英文名与美元价格；访问 `/zh`（未支持的语言）应返回 404。

三条都符合预期才算通过。若 `/de` 显示的是英文名，说明 `listActiveProducts` 的 locale 过滤没生效，回到 Step 3 检查 `innerJoin` 的条件。

- [ ] **Step 5: 部署到 Cloudflare**

```bash
pnpm exec opennextjs-cloudflare build
pnpm exec opennextjs-cloudflare deploy
npx wrangler d1 migrations apply shopcf --remote
```

部署完成后访问输出的 `*.workers.dev` 地址加语言前缀（如 `/en`），确认页面可访问。远端库尚无数据时列表为空属正常。

- [ ] **Step 6: 写 README 与协议**

创建 `LICENSE`，采用 MIT 协议，版权行填写项目所有者姓名与年份 2026。

创建 `README.md`：

````markdown
# shopcf

一套跑在 Cloudflare 上的外贸独立站商城系统。以 SEO 长尾词获客为第一性目标：每个商品是内容完整的静态页面，携带多语言 SEO 字段、产品特性与使用工况内容块。

单租户自部署——一份代码对应一个站点。

## 技术栈

Next.js (App Router) · TypeScript · Tailwind CSS · `@opennextjs/cloudflare` · Cloudflare D1 / R2 / KV / Cron · Drizzle ORM · Stripe

## 从零部署

前置：Node.js 20+、pnpm、一个 Cloudflare 账号。

```bash
git clone <your-fork-url> && cd shopcf
pnpm install
npx wrangler login
```

创建云端资源，把各命令输出的 id 填入 `wrangler.jsonc`：

```bash
npx wrangler d1 create shopcf
npx wrangler r2 bucket create shopcf-images
npx wrangler r2 bucket create shopcf-inc-cache
npx wrangler kv namespace create SESSIONS
```

配置本地环境变量：

```bash
cp .dev.vars.example .dev.vars
```

填入 `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_DATABASE_ID`、`CLOUDFLARE_D1_TOKEN`（在 Cloudflare 控制台创建具备 D1 编辑权限的 API Token）。

建表、灌示例数据并启动：

```bash
pnpm db:generate
pnpm db:migrate:local
pnpm db:seed:local
pnpm dev
```

访问 http://localhost:3000/en 应看到示例商品。

部署：

```bash
pnpm deploy
pnpm db:migrate:remote
```

## 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 本地开发服务器 |
| `pnpm test` | 跑测试（在真实 Workers 运行时中） |
| `pnpm typecheck` | 类型检查 |
| `pnpm db:generate` | 由 schema 生成迁移 SQL |
| `pnpm db:migrate:local` | 应用迁移到本地 D1 |
| `pnpm db:seed:local` | 向本地 D1 灌示例数据（可重复执行） |
| `pnpm deploy` | 构建并部署到 Cloudflare |

## 设计文档

架构、数据模型与各项取舍的理由见 `docs/superpowers/specs/`。

## 协议

MIT
````

- [ ] **Step 7: 跑全量检查**

```bash
pnpm test
pnpm typecheck
pnpm lint
```

三条全绿才算阶段 1 完成。

- [ ] **Step 8: 提交**

```bash
git add -A
git commit -m "feat: 打通数据库到页面到部署的完整链路，补齐 README 与 MIT 协议"
```

---

## 阶段 1 完成标准

全部满足才算完成：

- [ ] `pnpm test` 全绿，覆盖配置层、金额工具、定价引擎、schema、客户端、种子数据、SQL 生成器、绑定、商品查询
- [ ] `pnpm typecheck` 与 `pnpm lint` 通过
- [ ] 本地 `/en` 与 `/de` 能看到对应语言的商品名与对应币种价格，`/zh` 返回 404
- [ ] `pnpm db:seed:local` 可重复执行且不产生重复数据
- [ ] 已成功部署到 Cloudflare，远端地址可访问
- [ ] 仓库无硬编码密钥，`.dev.vars.example` 齐备
- [ ] README 中的部署步骤经过实际执行验证

## 本阶段刻意不做的事

以下均为后续阶段内容，本阶段出现即为范围蔓延：

- 商品详情页、工况落地页、分类页（阶段 2）
- hreflang、sitemap、JSON-LD、robots.txt（阶段 2）
- 后台任何页面与鉴权（阶段 3）
- 汇率拉取 Cron handler 与自动换算落库（阶段 3，本阶段只建表与占位 cron 配置）
- 购物车、结账、Stripe（阶段 4）
