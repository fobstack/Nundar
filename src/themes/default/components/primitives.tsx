import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

/** A section heading with a note on the right; several pages share this rhythm */
export function SectionHead({
  title,
  aside,
  bordered = true,
}: {
  title: string;
  aside?: ReactNode;
  bordered?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: "var(--space-4)",
        borderTop: bordered ? "1px solid var(--line)" : undefined,
        paddingTop: bordered ? "var(--space-8)" : undefined,
      }}
    >
      <h2
        style={{
          margin: 0,
          fontSize: "var(--text-h2)",
          fontWeight: 600,
          letterSpacing: "-0.015em",
        }}
      >
        {title}
      </h2>
      {aside ? (
        <span style={{ fontSize: "var(--text-xs)", color: "var(--ink-3)" }}>{aside}</span>
      ) : null}
    </div>
  );
}

export function Eyebrow({
  children,
  muted = false,
}: {
  children: ReactNode;
  muted?: boolean;
}) {
  return (
    <span
      style={{
        fontSize: "var(--text-eyebrow)",
        fontWeight: 600,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: muted ? "var(--ink-3)" : "var(--accent)",
      }}
    >
      {children}
    </span>
  );
}

export function Panel({
  children,
  padded = true,
  style,
}: {
  children: ReactNode;
  padded?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--line)",
        background: "var(--surface)",
        padding: padded ? "var(--space-6)" : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** The link form of the primary button. Form submit buttons are their own
 * elements but share these values. */
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
        padding: "13px 26px",
        fontSize: 15,
        fontWeight: 600,
        borderRadius: "var(--radius)",
        background: primary ? "var(--accent)" : "var(--surface)",
        color: primary ? "var(--ink-inverse)" : "var(--ink)",
        border: primary ? "1px solid var(--accent)" : "1px solid var(--line-strong)",
        textDecoration: "none",
      }}
    >
      {children}
    </Link>
  );
}

/** The stock indicator dot. In stock, low and out are distinguished by colour,
 * with the text still saying so on its own. */
export function StockDot({ stock }: { stock: number }) {
  const color =
    stock <= 0 ? "var(--ink-3)" : stock < 20 ? "#b8860b" : "var(--ok)";

  return (
    <span
      aria-hidden="true"
      style={{
        width: 7,
        height: 7,
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
 * Draws a blueprint-style outline rather than a grey rectangle when no real
 * image exists yet. In an industrial catalogue a placeholder with structure
 * says "a product photo belongs here" far better than a blank box does.
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
      <path d="M60 100h140M78 78h104v44H78z" stroke="var(--line-strong)" strokeWidth="2" />
      <circle cx="130" cy="100" r="24" stroke="var(--accent)" strokeWidth="2" fill="none" />
    </svg>
  );
}
