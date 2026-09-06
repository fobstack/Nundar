import * as React from "react";

const MOBILE_BREAKPOINT = 768;
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

/**
 * Whether the viewport is narrow enough for the rail to become a sheet.
 *
 * Rewritten from the version shadcn ships, which set state inside an effect and
 * so cascaded a render on every mount. `useSyncExternalStore` is the same
 * pattern `CurrencyPicker` already uses in this codebase: it subscribes to a
 * browser-only value, and it lets the server and client return different
 * snapshots without a hydration warning.
 *
 * The server snapshot is `false`. There is no viewport during rendering, and
 * assuming desktop matches what the previous implementation resolved to before
 * its effect ran.
 */
function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function useIsMobile(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
