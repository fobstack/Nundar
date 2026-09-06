import Link from "next/link";
import { notFound } from "next/navigation";
import { BASE_CURRENCY, CURRENCIES } from "@/config/currency";
import { getDb } from "@/db/client";
import { requireAdmin } from "@/lib/auth/guard";
import { getAdminProduct } from "@/lib/admin/queries";
import { ImageUploader } from "@/components/ImageUploader";
import { imageUrl } from "@/lib/media/images";
import { DEFAULT_LOCALE } from "@/config/locales";
import { fromMinor } from "@/lib/money";
import {
  priceOverrideAction,
  saveTranslationAction,
  saveUseCaseAction,
  saveVariantAction,
} from "./actions";

const field =
  "mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm";
const button = "admin-btn admin-btn-primary";

export default async function AdminProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  await requireAdmin();
  const { slug } = await params;

  const product = await getAdminProduct(getDb(), slug);
  if (!product) {
    notFound();
  }

  return (
    <>
      <Link href="/admin/products" className="text-sm underline underline-offset-4">
        ← All products
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight">
        {product.translations.find((t) => t.locale === "en")?.name ?? product.slug}
      </h1>
      <p className="mt-1 font-mono text-xs text-neutral-500">
        {product.slug} · {product.status}
      </p>

      {/* ── Multilingual content and SEO ───────────────── */}
      <section className="mt-10">
        <h2 className="admin-section-title">Content &amp; SEO</h2>

        {product.translations.map((translation) => (
          <form
            key={translation.locale}
            action={saveTranslationAction}
            className="admin-card admin-card-pad" style={{ marginTop: "var(--a-6)" }}
          >
            <input type="hidden" name="productId" value={product.id} />
            <input type="hidden" name="slug" value={product.slug} />
            <input type="hidden" name="locale" value={translation.locale} />

            <div className="flex items-center justify-between">
              <h3 className="font-medium uppercase">{translation.locale}</h3>
              {translation.name ? null : (
                <span className="text-xs text-amber-700">not translated yet</span>
              )}
            </div>

            <label className="mt-3 block text-sm">
              Name
              <input
                name="name"
                defaultValue={translation.name ?? ""}
                required
                className={field}
              />
            </label>

            <label className="mt-3 block text-sm">
              Summary
              <input
                name="summary"
                defaultValue={translation.summary ?? ""}
                className={field}
              />
            </label>

            <label className="mt-3 block text-sm">
              Description
              <textarea
                name="description"
                rows={4}
                defaultValue={translation.description ?? ""}
                className={field}
              />
            </label>

            <label className="mt-3 block text-sm">
              SEO title
              <input
                name="seoTitle"
                defaultValue={translation.seoTitle ?? ""}
                maxLength={70}
                className={field}
              />
              <span className="mt-1 block text-xs text-neutral-500">
                Aim for under 60 characters so Google does not truncate it.
              </span>
            </label>

            <label className="mt-3 block text-sm">
              SEO description
              <textarea
                name="seoDescription"
                rows={2}
                defaultValue={translation.seoDescription ?? ""}
                maxLength={180}
                className={field}
              />
              <span className="mt-1 block text-xs text-neutral-500">
                Aim for 150–160 characters.
              </span>
            </label>

            <button type="submit" className={`${button} mt-4`}>
              Save {translation.locale.toUpperCase()}
            </button>
          </form>
        ))}
      </section>

      {/* ── Images ─────────────────────────────────────── */}
      <section className="mt-12">
        <h2 className="admin-section-title">Images</h2>
        <p className="mt-1 text-sm text-neutral-500">
          The first upload becomes the primary image. File names are derived from
          the product slug because they are an image-SEO signal.
        </p>

        {product.images.length > 0 ? (
          <div className="mt-4 grid grid-cols-4 gap-4">
            {product.images.map((image) => (
              <figure key={image.id} className="admin-card" style={{ padding: "var(--a-2)" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrl(image.objectKey)}
                  alt={image.altText}
                  className="aspect-square w-full object-contain"
                />
                <figcaption className="mt-2 truncate text-xs text-neutral-500" title={image.altText}>
                  {image.altText}
                </figcaption>
              </figure>
            ))}
          </div>
        ) : null}

        <div className="mt-4 rounded border border-neutral-200 bg-white p-4">
          <ImageUploader
            productId={product.id}
            productSlug={product.slug}
            altLocale={DEFAULT_LOCALE}
          />
        </div>
      </section>

      {/* ── SKUs: stock, MOQ, lead time and pricing ────── */}
      <section className="mt-12">
        <h2 className="admin-section-title">SKUs, stock &amp; pricing</h2>

        {product.variants.map((variant) => {
          const base = variant.prices.find((p) => p.currency === BASE_CURRENCY);

          return (
            <div
              key={variant.id}
              className="admin-card admin-card-pad" style={{ marginTop: "var(--a-6)" }}
            >
              <h3 className="font-mono text-sm font-medium">{variant.sku}</h3>

              <form action={saveVariantAction} className="mt-3">
                <input type="hidden" name="slug" value={product.slug} />
                <input type="hidden" name="variantId" value={variant.id} />

                <div className="grid gap-3 sm:grid-cols-5">
                  <label className="admin-label">
                    Base price ({BASE_CURRENCY})
                    <input
                      name="basePrice"
                      type="number"
                      step="0.01"
                      min="0"
                      defaultValue={
                        base ? fromMinor(base.amountMinor, BASE_CURRENCY) : ""
                      }
                      className={field}
                    />
                  </label>
                  <label className="admin-label">
                    Stock
                    <input
                      name="stock"
                      type="number"
                      min="0"
                      defaultValue={variant.stock}
                      className={field}
                    />
                  </label>
                  <label className="admin-label">
                    MOQ
                    <input
                      name="moq"
                      type="number"
                      min="1"
                      defaultValue={variant.moq}
                      className={field}
                    />
                  </label>
                  <label className="admin-label">
                    Lead time min
                    <input
                      name="leadTimeDaysMin"
                      type="number"
                      min="0"
                      defaultValue={variant.leadTimeDaysMin ?? ""}
                      className={field}
                    />
                  </label>
                  <label className="admin-label">
                    Lead time max
                    <input
                      name="leadTimeDaysMax"
                      type="number"
                      min="0"
                      defaultValue={variant.leadTimeDaysMax ?? ""}
                      className={field}
                    />
                  </label>
                </div>

                <button type="submit" className={`${button} mt-3`}>
                  Save SKU
                </button>
              </form>

              {/* Converted prices at a glance: which are derived, which were set
                  by hand, and how old the rate behind them is */}
              <table className="mt-4 w-full text-sm">
                <thead>
                  <tr >
                    <th className="py-1">Currency</th>
                    <th className="py-1">Price</th>
                    <th className="py-1">Source</th>
                    <th className="py-1">Rate</th>
                    <th className="py-1">Override</th>
                  </tr>
                </thead>
                <tbody>
                  {CURRENCIES.filter((c) => c !== BASE_CURRENCY).map((currency) => {
                    const price = variant.prices.find(
                      (p) => p.currency === currency,
                    );

                    return (
                      <tr key={currency} >
                        <td className="py-2">{currency}</td>
                        <td className="py-2">
                          {price ? fromMinor(price.amountMinor, currency) : "—"}
                        </td>
                        <td className="py-2">
                          {price?.source === "manual" ? (
                            <span className="text-blue-700">manual</span>
                          ) : price?.source === "auto" ? (
                            <span className="text-neutral-500">auto</span>
                          ) : (
                            <span className="text-neutral-400">
                              awaiting rate
                            </span>
                          )}
                        </td>
                        <td className="py-2 text-xs text-neutral-500">
                          {price?.rateUsed ?? "—"}
                        </td>
                        <td className="py-2">
                          <form
                            action={priceOverrideAction}
                            className="flex items-center gap-2"
                          >
                            <input type="hidden" name="slug" value={product.slug} />
                            <input
                              type="hidden"
                              name="variantId"
                              value={variant.id}
                            />
                            <input
                              type="hidden"
                              name="currency"
                              value={currency}
                            />
                            <input
                              name="amount"
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder={
                                price ? String(fromMinor(price.amountMinor, currency)) : ""
                              }
                              className="w-24 rounded border border-neutral-300 px-2 py-1"
                            />
                            <button
                              type="submit"
                              name="intent"
                              value="override"
                              className="rounded border border-neutral-300 px-2 py-1 text-xs"
                            >
                              Set
                            </button>
                            {price?.source === "manual" ? (
                              <button
                                type="submit"
                                name="intent"
                                value="clear"
                                className="rounded border border-neutral-300 px-2 py-1 text-xs"
                              >
                                Auto
                              </button>
                            ) : null}
                          </form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </section>

      {/* ── Use cases: which get promoted to landing pages ─ */}
      <section className="mt-12">
        <h2 className="admin-section-title">Applications</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Give a use case its own landing page once it has enough substance to
          stand alone. Thin pages hurt the whole site.
        </p>

        {product.useCases.map((useCase) => (
          <form
            key={useCase.id}
            action={saveUseCaseAction}
            className="mt-4 flex flex-wrap items-end gap-3 rounded border border-neutral-200 bg-white p-4"
          >
            <input type="hidden" name="slug" value={product.slug} />
            <input type="hidden" name="useCaseId" value={useCase.id} />

            <div className="min-w-0 flex-1">
              <p className="text-xs uppercase text-neutral-500">
                {useCase.locale} · {useCase.groupKey}
              </p>
              <p className="truncate text-sm font-medium">
                {useCase.scenarioTitle}
              </p>
            </div>

            <label className="admin-label">
              URL slug
              <input
                name="scenarioSlug"
                defaultValue={useCase.scenarioSlug ?? ""}
                className="mt-1 w-56 rounded border border-neutral-300 px-2 py-1 font-mono text-xs"
              />
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="hasOwnPage"
                defaultChecked={useCase.hasOwnPage}
              />
              Own page
            </label>

            <button type="submit" className="rounded border border-neutral-300 px-3 py-1 text-sm">
              Save
            </button>
          </form>
        ))}
      </section>
    </>
  );
}
