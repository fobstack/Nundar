import Link from "next/link";
import { DEFAULT_LOCALE, LOCALES, isLocale } from "@/config/locales";
import { getDb } from "@/db/client";
import { requireAdmin } from "@/lib/auth/guard";
import {
  getLocaleCoverage,
  getTranslationStatus,
} from "@/lib/admin/translations";

function bar(percent: number) {
  const tone =
    percent === 100
      ? "bg-green-600"
      : percent >= 60
        ? "bg-amber-500"
        : "bg-red-500";

  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-2 w-24 overflow-hidden rounded bg-neutral-200">
        <span
          className={`block h-full ${tone}`}
          style={{ width: `${percent}%` }}
        />
      </span>
      <span className="text-xs tabular-nums text-neutral-600">{percent}%</span>
    </span>
  );
}

export default async function TranslationWorkbench({
  searchParams,
}: {
  searchParams: Promise<{ locale?: string }>;
}) {
  await requireAdmin();
  const { locale: requested } = await searchParams;

  const target =
    requested && isLocale(requested) && requested !== DEFAULT_LOCALE
      ? requested
      : LOCALES.find((locale) => locale !== DEFAULT_LOCALE)!;

  const db = getDb();
  const [coverage, statuses] = await Promise.all([
    getLocaleCoverage(db),
    getTranslationStatus(db, target),
  ]);

  return (
    <>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 650, letterSpacing: "-0.02em", margin: 0 }}>Translations</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Compared against {DEFAULT_LOCALE.toUpperCase()}, the source language.
      </p>

      <section className="mt-8">
        <h2 className="text-sm font-medium text-neutral-500">Coverage</h2>
        <ul className="mt-3 space-y-2">
          {coverage.map((item) => (
            <li key={item.locale} className="flex items-center gap-4 text-sm">
              <span className="w-8 uppercase">{item.locale}</span>
              {bar(item.completeness)}
              {item.locale === DEFAULT_LOCALE ? (
                <span className="text-xs text-neutral-400">source</span>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <nav className="mt-10 flex gap-4 text-sm">
        {LOCALES.filter((locale) => locale !== DEFAULT_LOCALE).map((locale) => (
          <Link
            key={locale}
            href={`/admin/translations?locale=${locale}`}
            className={
              locale === target ? "font-medium" : "underline underline-offset-4"
            }
          >
            {locale.toUpperCase()}
          </Link>
        ))}
      </nav>

      <section className="mt-6 space-y-6">
        {statuses.map((status) => {
          const missingFields = status.fields.filter(
            (field) => field.sourceFilled && !field.targetFilled,
          );
          const missingFeatures = status.features.filter((f) => f.missing);
          const missingUseCases = status.useCases.filter((u) => u.missing);
          const nothingMissing =
            missingFields.length === 0 &&
            missingFeatures.length === 0 &&
            missingUseCases.length === 0;

          return (
            <article
              key={status.productId}
              className="rounded-xl border bg-card p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium">
                  <Link
                    href={`/admin/products/${status.slug}`}
                    className="underline underline-offset-4"
                  >
                    {status.sourceName ?? status.slug}
                  </Link>
                </h3>
                {bar(status.completeness)}
              </div>

              {nothingMissing ? (
                <p className="mt-2 text-sm text-green-700">
                  Fully translated into {target.toUpperCase()}.
                </p>
              ) : (
                <div className="mt-3 space-y-2 text-sm">
                  {missingFields.length > 0 ? (
                    <p>
                      <span className="text-neutral-500">Missing fields: </span>
                      {missingFields.map((field) => field.field).join(", ")}
                    </p>
                  ) : null}

                  {missingFeatures.length > 0 ? (
                    <div>
                      <p className="text-neutral-500">Untranslated features:</p>
                      <ul className="ml-4 list-disc">
                        {missingFeatures.map((feature) => (
                          <li key={feature.groupKey}>{feature.sourceTitle}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {missingUseCases.length > 0 ? (
                    <div>
                      <p className="text-neutral-500">
                        Untranslated applications:
                      </p>
                      <ul className="ml-4 list-disc">
                        {missingUseCases.map((useCase) => (
                          <li key={useCase.groupKey}>{useCase.sourceTitle}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              )}
            </article>
          );
        })}
      </section>

      {statuses.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-500">No active products yet.</p>
      ) : null}
    </>
  );
}
