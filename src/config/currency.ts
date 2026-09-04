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

export function isCurrency(value: string): value is Currency {
  return (CURRENCIES as readonly string[]).includes(value);
}

export const PRICING = {
  /** 汇率缓冲，覆盖汇率波动与 Stripe 跨境手续费 */
  bufferRate: 0.03,
  /** 汇率偏离超过该比例才重算价格，避免价格每日跳动 */
  recalcThreshold: 0.02,
  /** 换算结果的心理价位取整策略 */
  roundingStrategy: "ending99",
} as const;
