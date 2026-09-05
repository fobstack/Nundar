"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES } from "@/lib/media/images";

/**
 * Product image upload.
 *
 * Alt text is required rather than optional: it is both an accessibility
 * requirement and an image ranking signal. Made optional, the real-world
 * outcome is that nobody ever fills it in.
 */
export function ImageUploader({
  productId,
  productSlug,
  altLocale,
}: {
  productId: string;
  productSlug: string;
  altLocale: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");

    if (!(file instanceof File) || file.size === 0) {
      setError("Choose an image first");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError(`File exceeds ${MAX_IMAGE_BYTES / 1024 / 1024} MB`);
      return;
    }

    data.set("productId", productId);
    data.set("productSlug", productSlug);
    data.set("altLocale", altLocale);

    setBusy(true);
    try {
      const response = await fetch("/api/admin/images", {
        method: "POST",
        body: data,
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? `Upload failed (${response.status})`);
      }

      form.reset();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={upload} className="flex flex-wrap items-end gap-3">
      <label className="text-sm">
        <span className="block">Image</span>
        <input
          type="file"
          name="file"
          accept={ALLOWED_IMAGE_TYPES.join(",")}
          required
          className="mt-1 text-sm"
        />
      </label>

      <label className="min-w-64 flex-1 text-sm">
        <span className="block">Alt text ({altLocale})</span>
        <input
          name="altText"
          required
          placeholder="316L stainless ball valve, full bore, NPT threaded"
          className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
        />
      </label>

      <button
        type="submit"
        disabled={busy}
        className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-40"
      >
        {busy ? "Uploading…" : "Upload"}
      </button>

      {error ? (
        <p role="alert" className="w-full text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </form>
  );
}
