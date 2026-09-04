import { PRICING } from "@/config/currency";
import { multiplyMinor } from "@/lib/money";

export type RoundingStrategy = "ending99" | "integer";

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
    throw new Error(
      `Exchange rate must be a positive finite number, received: ${rate}`,
    );
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
