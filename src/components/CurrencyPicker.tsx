"use client";

import { useSyncExternalStore } from "react";
import { CURRENCIES, type Currency } from "@/config/currency";
import {
  CURRENCY_COOKIE,
  CURRENCY_COOKIE_MAX_AGE,
  readCurrencyCookieFromDocument,
} from "@/lib/currency-preference";

/**
 * Currency switcher.
 *
 * Writes the cookie and reloads. Dynamic pages are re-rendered by the server
 * from that cookie; static pages have their prices replaced by LiveStock after
 * hydration. Neither path requires generating a static page per currency.
 */
/** The cookie only changes across a full reload, so there is nothing to subscribe to */
function subscribeToNothing(): () => void {
  return () => {};
}

export function CurrencyPicker({ currency }: { currency: Currency }) {
  // Static pages are generated in each language's default currency, and the
  // server cannot read the cookie. useSyncExternalStore permits the server and
  // client snapshots to differ, so the buyer's actual choice shows without a
  // hydration warning.
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
