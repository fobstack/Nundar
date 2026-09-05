"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CURRENCIES, BASE_CURRENCY } from "@/config/currency";
import { LOCALES } from "@/config/locales";
import { getDb } from "@/db/client";
import { requireAdmin } from "@/lib/auth/guard";
import {
  clearManualPrice,
  saveProductTranslation,
  setManualPrice,
  updateBasePrice,
  updateUseCasePage,
  updateVariantLogistics,
} from "@/lib/admin/mutations";
import { toMinor } from "@/lib/money";

/**
 * An admin edit has to regenerate the storefront's static pages, or the change
 * is invisible in production. The product page, its use-case pages, the listing,
 * the home page and the sitemap are all affected.
 */
function revalidateProduct(slug: string) {
  for (const locale of LOCALES) {
    revalidatePath(`/${locale}`);
    revalidatePath(`/${locale}/products`);
    revalidatePath(`/${locale}/products/${slug}`, "layout");
  }
  revalidatePath("/sitemap.xml");
}

const translationSchema = z.object({
  productId: z.string().min(1),
  slug: z.string().min(1),
  locale: z.enum(LOCALES),
  name: z.string(),
  summary: z.string(),
  description: z.string(),
  seoTitle: z.string(),
  seoDescription: z.string(),
});

export async function saveTranslationAction(formData: FormData) {
  await requireAdmin();

  const input = translationSchema.parse({
    productId: formData.get("productId"),
    slug: formData.get("slug"),
    locale: formData.get("locale"),
    name: formData.get("name") ?? "",
    summary: formData.get("summary") ?? "",
    description: formData.get("description") ?? "",
    seoTitle: formData.get("seoTitle") ?? "",
    seoDescription: formData.get("seoDescription") ?? "",
  });

  await saveProductTranslation(getDb(), input.productId, input.locale, {
    name: input.name,
    summary: input.summary,
    description: input.description,
    seoTitle: input.seoTitle,
    seoDescription: input.seoDescription,
  });

  revalidateProduct(input.slug);
}

const logisticsSchema = z.object({
  slug: z.string().min(1),
  variantId: z.string().min(1),
  stock: z.coerce.number().int().min(0),
  moq: z.coerce.number().int().min(1),
  leadTimeDaysMin: z.string(),
  leadTimeDaysMax: z.string(),
  basePrice: z.string(),
});

export async function saveVariantAction(formData: FormData) {
  await requireAdmin();

  const input = logisticsSchema.parse({
    slug: formData.get("slug"),
    variantId: formData.get("variantId"),
    stock: formData.get("stock"),
    moq: formData.get("moq"),
    leadTimeDaysMin: formData.get("leadTimeDaysMin") ?? "",
    leadTimeDaysMax: formData.get("leadTimeDaysMax") ?? "",
    basePrice: formData.get("basePrice") ?? "",
  });

  const db = getDb();

  await updateVariantLogistics(db, input.variantId, {
    stock: input.stock,
    moq: input.moq,
    leadTimeDaysMin: input.leadTimeDaysMin ? Number(input.leadTimeDaysMin) : null,
    leadTimeDaysMax: input.leadTimeDaysMax ? Number(input.leadTimeDaysMax) : null,
  });

  if (input.basePrice) {
    await updateBasePrice(
      db,
      input.variantId,
      toMinor(Number(input.basePrice), BASE_CURRENCY),
    );
  }

  revalidateProduct(input.slug);
}

const priceOverrideSchema = z.object({
  slug: z.string().min(1),
  variantId: z.string().min(1),
  currency: z.enum(CURRENCIES),
  amount: z.string(),
  intent: z.enum(["override", "clear"]),
});

export async function priceOverrideAction(formData: FormData) {
  await requireAdmin();

  const input = priceOverrideSchema.parse({
    slug: formData.get("slug"),
    variantId: formData.get("variantId"),
    currency: formData.get("currency"),
    amount: formData.get("amount") ?? "",
    intent: formData.get("intent"),
  });

  const db = getDb();

  if (input.intent === "clear") {
    await clearManualPrice(db, input.variantId, input.currency);
  } else {
    await setManualPrice(
      db,
      input.variantId,
      input.currency,
      toMinor(Number(input.amount), input.currency),
    );
  }

  revalidateProduct(input.slug);
}

const useCaseSchema = z.object({
  slug: z.string().min(1),
  useCaseId: z.string().min(1),
  scenarioSlug: z.string(),
  hasOwnPage: z.string().optional(),
});

export async function saveUseCaseAction(formData: FormData) {
  await requireAdmin();

  const input = useCaseSchema.parse({
    slug: formData.get("slug"),
    useCaseId: formData.get("useCaseId"),
    scenarioSlug: formData.get("scenarioSlug") ?? "",
    hasOwnPage: formData.get("hasOwnPage") ?? undefined,
  });

  await updateUseCasePage(getDb(), input.useCaseId, {
    hasOwnPage: input.hasOwnPage === "on",
    scenarioSlug: input.scenarioSlug,
  });

  revalidateProduct(input.slug);
}
