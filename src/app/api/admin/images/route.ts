import { getCloudflareContext } from "@opennextjs/cloudflare";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { requireAdmin } from "@/lib/auth/guard";
import { buildImageKey, validateImage } from "@/lib/media/images";

const metaSchema = z.object({
  productId: z.string().min(1),
  productSlug: z.string().min(1),
  altLocale: z.string().min(2).max(5),
  altText: z.string().min(1, "Alt text is required"),
});

/**
 * Upload a product image.
 *
 * Alt text is mandatory: it is both an accessibility requirement and an image
 * ranking signal. Allowing an upload without it means giving that traffic away
 * by default.
 */
export async function POST(request: Request) {
  await requireAdmin();

  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return Response.json({ error: "No file provided" }, { status: 400 });
  }

  const parsed = metaSchema.safeParse({
    productId: form.get("productId"),
    productSlug: form.get("productSlug"),
    altLocale: form.get("altLocale"),
    altText: form.get("altText"),
  });

  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const validation = validateImage(bytes, file.type);

  if (!validation.ok) {
    return Response.json({ error: validation.reason }, { status: 400 });
  }

  const db = getDb();
  const existing = await db
    .select({ id: schema.productImages.id })
    .from(schema.productImages)
    .where(eq(schema.productImages.productId, parsed.data.productId));

  const objectKey = buildImageKey(
    parsed.data.productSlug,
    existing.length + 1,
    validation.contentType,
  );

  const { env } = getCloudflareContext();
  await env.MEDIA.put(objectKey, bytes, {
    httpMetadata: { contentType: validation.contentType },
  });

  await db.insert(schema.productImages).values({
    id: crypto.randomUUID(),
    productId: parsed.data.productId,
    objectKey,
    altLocale: parsed.data.altLocale,
    altText: parsed.data.altText,
    sortOrder: existing.length,
  });

  // The first image becomes the primary one, saving a redundant step
  if (existing.length === 0) {
    await db
      .update(schema.products)
      .set({ primaryImageKey: objectKey })
      .where(eq(schema.products.id, parsed.data.productId));
  }

  return Response.json({ objectKey });
}
