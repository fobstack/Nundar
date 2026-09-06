import Link from "next/link";
import { BASE_CURRENCY } from "@/config/currency";
import { DEFAULT_LOCALE } from "@/config/locales";
import { requireAdmin } from "@/lib/auth/guard";
import { getAdminT } from "@/lib/admin/locale";
import { createProductAction } from "./actions";

const field = "mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm";

export default async function NewProductPage() {
  await requireAdmin();
  const { t } = await getAdminT();

  return (
    <>
      <Link href="/admin/products" className="text-sm underline underline-offset-4">
        ← {t.products.title}
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight">
        {t.products.newProduct}
      </h1>
      <p className="mt-2 text-sm text-neutral-500">
        Only the minimum is required here. Translations, applications, images and
        other currencies are filled in on the edit page afterwards.
      </p>

      <form
        action={createProductAction}
        className="admin-card admin-card-pad"
        style={{ display: "grid", gap: "var(--a-4)" }}
      >
        <label className="admin-label">
          {t.products.slug}
          <input
            name="slug"
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            placeholder="stainless-ball-valve-dn50"
            className={`${field} font-mono`}
          />
          <span className="mt-1 block text-xs text-neutral-500">
            Goes straight into the URL and never changes per language. Lowercase
            letters, digits and hyphens only.
          </span>
        </label>

        <label className="admin-label">
          {t.products.name} ({DEFAULT_LOCALE.toUpperCase()})
          <input name="name" required className={field} />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="admin-label">
            SKU
            <input name="sku" required className={`${field} font-mono`} />
          </label>
          <label className="admin-label">
            {t.products.basePrice} ({BASE_CURRENCY})
            <input
              name="basePrice"
              type="number"
              step="0.01"
              min="0"
              required
              className={field}
            />
          </label>
          <label className="admin-label">
            {t.products.stock}
            <input name="stock" type="number" min="0" defaultValue={0} required className={field} />
          </label>
          <label className="admin-label">
            {t.products.moq}
            <input name="moq" type="number" min="1" defaultValue={1} required className={field} />
          </label>
        </div>

        <button
          type="submit"
          className="admin-btn admin-btn-primary" style={{ width: "100%" }}
        >
          {t.common.create}
        </button>
        <p style={{ color: "var(--a-ink-3)", fontSize: "var(--a-text-xs)" }}>
          The product is created as a draft. Publish it from the edit page once it
          has images and content — an incomplete page is worse than no page.
        </p>
      </form>
    </>
  );
}
