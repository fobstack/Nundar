import { BASE_CURRENCY, CURRENCIES } from "@/config/currency";
import type { Db } from "@/db/client";
import { fetchEcbRates, ratesFromBase } from "./ecb";
import {
  recalculatePrices,
  refreshExchangeRates,
  type RecalculationResult,
} from "./recalculate";

export type CronOutcome =
  | { ok: true; date: string; result: RecalculationResult }
  | { ok: false; reason: string };

/**
 * 每日汇率任务：拉 ECB 汇率 → 落库 → 按阈值重算自动价。
 *
 * 拉取失败不抛出，而是返回失败结果并保留上一次快照——汇率取不到是常态
 * （ECB 周末与节假日不更新、网络抖动），绝不能因此让价格异常或整个 Worker 崩溃。
 */
export async function runExchangeRateCron(
  db: Db,
  fetchImpl: typeof fetch = fetch,
): Promise<CronOutcome> {
  try {
    const { date, ratesFromEur } = await fetchEcbRates(fetchImpl);
    const rates = ratesFromBase(ratesFromEur, BASE_CURRENCY, CURRENCIES);

    await refreshExchangeRates(db, rates);
    const result = await recalculatePrices(db);

    return { ok: true, date, result };
  } catch (error) {
    return {
      ok: false,
      // 只保留错误信息本身，不带任何请求上下文，避免 PII 进日志
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
