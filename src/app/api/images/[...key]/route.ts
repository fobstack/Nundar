import { getCloudflareContext } from "@opennextjs/cloudflare";
import { isAllowedImageType } from "@/lib/media/images";

/**
 * Serve product images.
 *
 * Proxied through the application rather than exposing the R2 bucket directly.
 * A private bucket means object keys cannot be enumerated, and it lets us set
 * the Content-Type and security headers ourselves instead of leaving them to
 * the storage layer.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const { key } = await params;
  const objectKey = key.join("/");

  // Path traversal guard: the key is assembled from the URL and is not trusted
  if (objectKey.includes("..") || !objectKey.startsWith("products/")) {
    return new Response("Not found", { status: 404 });
  }

  const { env } = getCloudflareContext();
  const object = await env.MEDIA.get(objectKey);

  if (!object) {
    return new Response("Not found", { status: 404 });
  }

  const stored = object.httpMetadata?.contentType ?? "";
  // Checked again on the way out even though upload validated it: no object is
  // ever served as text/html
  const contentType = isAllowedImageType(stored) ? stored : "application/octet-stream";

  return new Response(object.body, {
    headers: {
      "Content-Type": contentType,
      // An image's content never changes for a given key — a new image gets a new
      // key — so it can be cached indefinitely
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      ETag: object.httpEtag,
    },
  });
}
