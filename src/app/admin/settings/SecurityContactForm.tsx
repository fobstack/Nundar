"use client";

import { useActionState } from "react";
import { saveSecurityContactAction } from "./actions";

const field = "mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm";

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
    <form action={action} className="mt-4 max-w-xl">
      <label className="text-sm">
        {labels.email}
        <input
          type="email"
          name="securityContactEmail"
          defaultValue={initialValue}
          placeholder="security@yourdomain.com"
          className={field}
        />
      </label>

      <p className="mt-2 text-xs text-neutral-500">{labels.hint}</p>

      {/* Stated here rather than in the docs, because this is where someone
          forms the belief that the address works. The Worker binding sends;
          receiving is Email Routing, configured in the Cloudflare dashboard. */}
      <p className="mt-2 text-xs text-amber-700">{labels.inbound}</p>

      {state?.error ? (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {labels.invalid}
        </p>
      ) : null}

      {state?.saved ? (
        <p className="mt-2 text-xs text-green-700">{labels.saved}</p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-4 rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-40"
      >
        {labels.save}
      </button>
    </form>
  );
}
