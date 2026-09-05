import { getCloudflareContext } from "@opennextjs/cloudflare";
import { isAllowedImageType } from "@/lib/media/images";

/**
 * 提供商品图。
 *
 * 经应用转发而不是把 R2 桶直接公开：桶保持私有意味着 object key 不可枚举，
 * 也让我们能强制设置 Content-Type 与安全响应头，而不是任由存储层决定。
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const { key } = await params;
  const objectKey = key.join("/");

  // 路径穿越防护：key 由 URL 拼出，不能信
  if (objectKey.includes("..") || !objectKey.startsWith("products/")) {
    return new Response("Not found", { status: 404 });
  }

  const { env } = getCloudflareContext();
  const object = await env.MEDIA.get(objectKey);

  if (!object) {
    return new Response("Not found", { status: 404 });
  }

  const stored = object.httpMetadata?.contentType ?? "";
  // 即便存的时候校验过，出站再确认一次：绝不以 text/html 提供任何对象
  const contentType = isAllowedImageType(stored) ? stored : "application/octet-stream";

  return new Response(object.body, {
    headers: {
      "Content-Type": contentType,
      // 图片内容按 key 不变，key 变了才是新图，可以长期缓存
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      ETag: object.httpEtag,
    },
  });
}
