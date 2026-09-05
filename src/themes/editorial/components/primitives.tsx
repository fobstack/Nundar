import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

/**
 * A section heading. Where the default theme rules a hairline above each
 * section, this one leads with a small caps eyebrow and lets whitespace do the
 * separating.
 */
export function SectionHead({
  title,
  aside,
}: {
  title: string;
  aside?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: "var(--space-4)",
        flexWrap: "wrap",
      }}
    >
      <h2
        className="serif"
        style={{
          margin: 0,
          fontSize: "var(--text-h2)",
          fontWeight: 600,
          letterSpacing: "-0.01em",
        }}
      >
        {title}
      </h2>
      {aside ? (
        <span style={{ fontSize: "var(--text-sm)", color: "var(--ink-3)" }}>{aside}</span>
      ) : null}
    </div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        fontSize: "var(--text-eyebrow)",
        fontWeight: 700,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: "var(--accent)",
      }}
    >
      {children}
    </span>
  );
}

/** A raised card. The default theme uses a 1px border here; this one uses lift. */
export function Card({
  children,
  padded = true,
  lifted = false,
  style,
}: {
  children: ReactNode;
  padded?: boolean;
  lifted?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        background: "var(--surface)",
        borderRadius: "var(--radius)",
        boxShadow: lifted ? "var(--shadow-lift)" : "var(--shadow)",
        padding: padded ? "var(--space-6)" : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function ButtonLink({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary";
}) {
  const primary = variant === "primary";

  return (
    <Link
      href={href}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "14px 28px",
        fontSize: 16,
        fontWeight: 600,
        borderRadius: 999,
        background: primary ? "var(--accent)" : "transparent",
        color: primary ? "var(--ink-inverse)" : "var(--accent)",
        border: primary ? "1px solid var(--accent)" : "1px solid var(--line-strong)",
        textDecoration: "none",
      }}
    >
      {children}
    </Link>
  );
}

/** Stock indicator. Colour alone never carries the meaning; text always accompanies it. */
export function StockDot({ stock }: { stock: number }) {
  const color = stock <= 0 ? "var(--ink-3)" : stock < 20 ? "var(--warn)" : "var(--ok)";

  return (
    <span
      aria-hidden="true"
      style={{
        width: 8,
        height: 8,
        borderRadius: 999,
        background: color,
        display: "inline-block",
        flexShrink: 0,
      }}
    />
  );
}

/**
 * Product image placeholder.
 *
 * A soft tonal panel rather than the default theme's blueprint linework — the
 * editorial register treats a missing photograph as a quiet gap, not as a
 * technical drawing.
 */
export function ProductPlaceholder({ size = 200 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size * 0.75}
      viewBox="0 0 260 200"
      fill="none"
      role="img"
      aria-label="Product image placeholder"
    >
      <rect x="0" y="0" width="260" height="200" rx="10" fill="var(--surface-sunken)" />
      <circle cx="130" cy="94" r="34" fill="none" stroke="var(--line-strong)" strokeWidth="1.5" />
      <path d="M104 128h52" stroke="var(--line-strong)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** A labelled figure, used for MOQ / lead time / stock in the spec rail. */
export function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontSize: "var(--text-xs)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--ink-3)",
        }}
      >
        {label}
      </div>
      <div style={{ marginTop: 2, fontSize: "var(--text-lg)" }}>{children}</div>
    </div>
  );
}
