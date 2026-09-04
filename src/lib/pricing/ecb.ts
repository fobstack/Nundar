/**
 * 欧洲央行每日参考汇率。
 *
 * 选它而非商业汇率 API 的决定性理由：免费、无需 API key、权威——开源使用者
 * fork 后无需注册任何第三方服务即可运行。
 *
 * 数据以 EUR 为基准报价；本项目基准币种是 USD，需经 EUR 交叉换算。
 * ECB 周末与欧洲节假日不更新，届时返回的是最近一个工作日的数据，这对
 * 「偏离阈值才重算」的策略无影响。
 */
export const ECB_DAILY_URL =
  "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

export type EcbRates = {
  /** ECB 的参考日期，格式 YYYY-MM-DD */
  date: string;
  /** 以 EUR 为基准的报价，含 EUR 自身（值为 1） */
  ratesFromEur: Record<string, number>;
};

/**
 * 解析 ECB 的 XML。
 * Workers 运行时没有 DOMParser，且该 XML 结构固定简单，用正则提取即可。
 */
export function parseEcbRates(xml: string): EcbRates {
  const ratesFromEur: Record<string, number> = { EUR: 1 };

  const ratePattern =
    /<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]/g;
  for (const match of xml.matchAll(ratePattern)) {
    const value = Number(match[2]);
    if (Number.isFinite(value) && value > 0) {
      ratesFromEur[match[1]] = value;
    }
  }

  if (Object.keys(ratesFromEur).length <= 1) {
    throw new Error("ECB response contained no rates");
  }

  const dateMatch = xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/);
  if (!dateMatch) {
    throw new Error("ECB response contained no reference date");
  }

  return { date: dateMatch[1], ratesFromEur };
}

/**
 * 把 EUR 基准的报价换算成任意基准币种的报价。
 * 结果含义：1 单位 base 等于多少单位 quote。
 */
export function ratesFromBase(
  ratesFromEur: Record<string, number>,
  base: string,
  quotes: readonly string[],
): Record<string, number> {
  const baseFromEur = ratesFromEur[base];
  if (!baseFromEur) {
    throw new Error(`ECB rates do not include the base currency ${base}`);
  }

  const result: Record<string, number> = {};
  for (const quote of quotes) {
    if (quote === base) {
      continue;
    }
    const quoteFromEur = ratesFromEur[quote];
    // 源数据没有的币种直接跳过，不猜测、不填 0
    if (quoteFromEur) {
      result[quote] = quoteFromEur / baseFromEur;
    }
  }

  return result;
}

/** 拉取并解析当前 ECB 汇率 */
export async function fetchEcbRates(
  fetchImpl: typeof fetch = fetch,
): Promise<EcbRates> {
  const response = await fetchImpl(ECB_DAILY_URL);
  if (!response.ok) {
    throw new Error(
      `ECB request failed with status ${response.status} ${response.statusText}`,
    );
  }
  return parseEcbRates(await response.text());
}
