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
      <label className="admin-label">
        {labels.email}
        <input
          type="email"
          name="securityContactEmail"
          defaultValue={initialValue}
          placeholder="security@yourdomain.com"
          className="admin-input"
        />
      </label>

      <p className="admin-hint">{labels.hint}</p>

      {/* Stated here rather than in the docs, because this is where someone
          forms the belief that the address works. The Worker binding sends;
          receiving is Email Routing, configured in the Cloudflare dashboard. */}
      <p
        style={{
          background: "var(--a-attention-soft)",
          borderRadius: "var(--a-radius-sm)",
          color: "var(--a-attention)",
          fontSize: "var(--a-text-xs)",
          margin: "var(--a-3) 0 0",
          padding: "var(--a-3) var(--a-4)",
        }}
      >
        {labels.inbound}
      </p>

      {state?.error ? (
        <p role="alert" className="admin-error" style={{ marginTop: "var(--a-3)" }}>
          {labels.invalid}
        </p>
      ) : null}

      {state?.saved ? (
        <p className="admin-note-ok" style={{ marginTop: "var(--a-3)" }}>{labels.saved}</p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="admin-btn admin-btn-primary"
        style={{ marginTop: "var(--a-4)" }}
      >
        {labels.save}
      </button>
    </form>
  );
}
