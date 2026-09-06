"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BASE_CURRENCY } from "@/config/currency";
import { DEFAULT_LOCALE } from "@/config/locales";
import { getDb } from "@/db/client";
import { requireAdmin } from "@/lib/auth/guard";
import { createProduct } from "@/lib/admin/mutations";
import { toMinor } from "@/lib/money";

const schema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  sku: z.string().min(1),
  basePrice: z.coerce.number().min(0),
  stock: z.coerce.number().int().min(0),
  moq: z.coerce.number().int().min(1),
});

export async function createProductAction(formData: FormData) {
  await requireAdmin();

  const input = schema.parse({
    slug: formData.get("slug"),
    name: formData.get("name"),
    sku: formData.get("sku"),
    basePrice: formData.get("basePrice"),
    stock: formData.get("stock"),
    moq: formData.get("moq"),
  });

  const created = await createProduct(getDb(), {
    slug: input.slug,
    name: input.name,
    locale: DEFAULT_LOCALE,
    sku: input.sku,
    basePriceMinor: toMinor(input.basePrice, BASE_CURRENCY),
    stock: input.stock,
    moq: input.moq,
  });

  revalidatePath("/admin/products");
  // Straight into the edit page: translations, use cases and images still need
  // filling in, and stopping at the list only costs another click
  redirect(`/admin/products/${created.slug}`);
}
