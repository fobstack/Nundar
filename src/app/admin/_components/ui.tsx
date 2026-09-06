import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "cn";

/**
 * The admin's shared vocabulary, built on shadcn primitives.
 *
 * Everything here is either a composition shadcn does not ship (a page header, a
 * labelled figure) or a semantic wrapper that keeps a meaning consistent across
 * pages (which colour an order state gets). Anything used once stays where it is
 * used.
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
    <div className="mb-8 flex items-start justify-between gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-1.5 text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export type ChipTone = "ok" | "attention" | "danger" | "idle";

const TONE_CLASS: Record<ChipTone, string> = {
  ok: "badge-ok",
  attention: "badge-attention",
  danger: "badge-danger",
  idle: "badge-idle",
};

/**
 * A state chip.
 *
 * The label always states the condition, so colour is reinforcement rather than
 * the only carrier — the interface still works in greyscale, and for the eight
 * percent of men who would otherwise read the red and green chips as the same.
 */
export function Chip({ tone, children }: { tone: ChipTone; children: ReactNode }) {
  return (
    <Badge className={cn("gap-1.5", TONE_CLASS[tone])} variant="ghost">
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {children}
    </Badge>
  );
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
 * Deliberately not a card of its own. Four identical bordered boxes is the
 * reflex dashboard layout and it flattens everything to equal importance, which
 * is the opposite of what someone opening an admin needs.
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
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="tabular mt-0.5 text-3xl leading-tight font-semibold tracking-tight">
        {value}
      </div>
      {note ? <div className="mt-1 text-xs text-muted-foreground">{note}</div> : null}
    </div>
  );
}
