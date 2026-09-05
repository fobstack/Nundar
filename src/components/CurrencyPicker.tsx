"use client";

import { useSyncExternalStore } from "react";
import { CURRENCIES, type Currency } from "@/config/currency";
import {
  CURRENCY_COOKIE,
  CURRENCY_COOKIE_MAX_AGE,
  readCurrencyCookieFromDocument,
} from "@/lib/currency-preference";

/**
 * 币种切换。
 *
 * 写 cookie 后整页重载：动态页由服务端读 cookie 渲染，静态页由 LiveStock
 * 在 hydration 后按新币种拉价格覆盖。两条路径都不需要为币种额外生成静态页。
 */
/** cookie 只在整页重载时变化，无需订阅变更 */
function subscribeToNothing(): () => void {
  return () => {};
}

export function CurrencyPicker({ currency }: { currency: Currency }) {
  // 静态页按语言默认币种生成，服务端读不到 cookie。useSyncExternalStore 允许
  // 服务端与客户端给出不同快照，既显示用户的真实选择又不产生 hydration 警告。
  const selected = useSyncExternalStore(
    subscribeToNothing,
    () => readCurrencyCookieFromDocument() ?? currency,
    () => currency,
  );

  function choose(next: Currency) {
    document.cookie = `${CURRENCY_COOKIE}=${next}; path=/; max-age=${CURRENCY_COOKIE_MAX_AGE}; samesite=lax`;
    window.location.reload();
  }

  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span className="sr-only-label">Currency</span>
      <select
        value={selected}
        onChange={(event) => choose(event.target.value as Currency)}
        style={{
          background: "transparent",
          color: "inherit",
          border: "none",
          font: "inherit",
          cursor: "pointer",
          padding: 0,
        }}
      >
        {CURRENCIES.map((option) => (
          <option key={option} value={option} style={{ color: "#16181c" }}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}
