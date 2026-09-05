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
 * 上传商品图。
 *
 * alt 文本强制必填：它既是无障碍要求，也是图片排名信号。
 * 允许上传无 alt 的图，等于默认放弃这部分流量。
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

  // 第一张图自动成为主图，省掉一次多余操作
  if (existing.length === 0) {
    await db
      .update(schema.products)
      .set({ primaryImageKey: objectKey })
      .where(eq(schema.products.id, parsed.data.productId));
  }

  return Response.json({ objectKey });
}
