import type { ReactNode } from "react";

/**
 * The admin's shared vocabulary.
 *
 * Kept small on purpose. Every component here exists because the same shape
 * appears on three or more pages; anything used once stays where it is used.
 */

export function PageHead({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="admin-page-head">
      <div>
        <h1>{title}</h1>
        {description ? (
          <p style={{ color: "var(--a-ink-2)", margin: "6px 0 0" }}>{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function Card({
  children,
  padded = true,
  style,
}: {
  children: ReactNode;
  padded?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div className={padded ? "admin-card admin-card-pad" : "admin-card"} style={style}>
      {children}
    </div>
  );
}

export type ChipTone = "ok" | "attention" | "danger" | "idle";

/**
 * A state chip.
 *
 * The label always states the condition, so the colour is reinforcement rather
 * than the only carrier — the interface still works in greyscale, and for the
 * eight percent of men who would otherwise be reading red and green as the same
 * chip.
 */
export function Chip({ tone, children }: { tone: ChipTone; children: ReactNode }) {
  return <span className={`admin-chip admin-chip-${tone}`}>{children}</span>;
}

/** How each order state reads. Anything unrecognised shows as idle rather than blank. */
const ORDER_TONES: Record<string, ChipTone> = {
  pending: "attention",
  paid: "ok",
  shipped: "ok",
  delivered: "ok",
  cancelled: "idle",
  refunded: "idle",
  // Paid, unfulfillable, and needs a person. The one state that is genuinely wrong.
  oversold: "danger",
};

export function OrderStatusChip({ status, label }: { status: string; label?: string }) {
  return <Chip tone={ORDER_TONES[status] ?? "idle"}>{label ?? status}</Chip>;
}

export function ProductStatusChip({ status, label }: { status: string; label?: string }) {
  const tone: ChipTone =
    status === "active" ? "ok" : status === "draft" ? "attention" : "idle";
  return <Chip tone={tone}>{label ?? status}</Chip>;
}

/**
 * A labelled figure.
 *
 * Deliberately not a card. Four identical bordered boxes is the reflex layout
 * for a dashboard and it flattens everything to equal importance, which is the
 * opposite of what someone opening an admin needs.
 */
export function Figure({
  label,
  value,
  note,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div>
      <div style={{ color: "var(--a-ink-3)", fontSize: "var(--a-text-sm)" }}>{label}</div>
      <div
        className="figure"
        style={{
          fontSize: "var(--a-text-figure)",
          fontWeight: 600,
          letterSpacing: "-0.02em",
          lineHeight: 1.15,
          marginTop: 2,
        }}
      >
        {value}
      </div>
      {note ? <div className="admin-hint">{note}</div> : null}
    </div>
  );
}

export function TableEmpty({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td className="admin-empty" colSpan={colSpan}>
        {children}
      </td>
    </tr>
  );
}
