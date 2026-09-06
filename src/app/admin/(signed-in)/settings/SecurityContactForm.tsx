"use client";

import { useActionState } from "react";
import { saveSecurityContactAction } from "./actions";

/**
 * The one editable setting on this page.
 *
 * A client component because it reports the result of the save inline. The rest
 * of the settings page is read-only build-time configuration, so it stays a
 * server component.
 */
export function SecurityContactForm({
  initialValue,
  labels,
}: {
  initialValue: string;
  labels: {
    email: string;
    hint: string;
    inbound: string;
    invalid: string;
    save: string;
    saved: string;
  };
}) {
  const [state, action, pending] = useActionState(saveSecurityContactAction, null);

  return (
    <form action={action} style={{ maxWidth: 520 }}>
      <label className="text-sm font-medium">
        {labels.email}
        <input
          type="email"
          name="securityContactEmail"
          defaultValue={initialValue}
          placeholder="security@yourdomain.com"
          className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
        />
      </label>

      <p className="mt-1 text-xs text-muted-foreground">{labels.hint}</p>

      {/* Stated here rather than in the docs, because this is where someone
          forms the belief that the address works. The Worker binding sends;
          receiving is Email Routing, configured in the Cloudflare dashboard. */}
      <p
        style={{
          background: "var(--state-attention-soft)",
          borderRadius: "var(--radius)",
          color: "var(--state-attention)",
          fontSize: "0.75rem",
          margin: "0.75rem 0 0",
          padding: "0.75rem 1rem",
        }}
      >
        {labels.inbound}
      </p>

      {state?.error ? (
        <p
          className="mt-3 rounded-md px-4 py-3 text-sm"
          role="alert"
          style={{
            background: "var(--state-danger-soft)",
            color: "var(--state-danger)",
          }}
        >
          {labels.invalid}
        </p>
      ) : null}

      {state?.saved ? (
        <p className="mt-3 text-sm" style={{ color: "var(--state-ok)" }}>
          {labels.saved}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-8 items-center justify-center rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/80"
        style={{ marginTop: "1rem" }}
      >
        {labels.save}
      </button>
    </form>
  );
}
