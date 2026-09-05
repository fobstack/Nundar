/**
 * Product image storage, on R2.
 *
 * R2 only, deliberately not Cloudflare Images: R2 has a free tier and charges
 * nothing for egress, while Images is a separate paid product. The cost of that
 * choice is handling variants ourselves — the current approach uploads the
 * original and crops at display time, which is worth revisiting once image
 * volume or traffic grows.
 *
 * Object keys are built from the product slug rather than a random hash,
 * because the filename is one of the ranking signals for image search.
 * `stainless-ball-valve-dn50-01.jpg` says considerably more than `a3f9c2.jpg`.
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Only formats browsers support widely and can render safely as images */
export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
] as const;

export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

const EXTENSION: Record<AllowedImageType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

export function isAllowedImageType(value: string): value is AllowedImageType {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(value);
}

export type ImageValidation =
  | { ok: true; contentType: AllowedImageType }
  | { ok: false; reason: string };

/**
 * Validate an uploaded file.
 *
 * Trusts the magic bytes and nothing else — not the client's Content-Type, not
 * the extension, since both can be set to anything. A file stored as an image
 * that is really HTML becomes an XSS vector the moment it is served from our
 * own origin.
 */
export function validateImage(
  bytes: Uint8Array,
  declaredType: string,
): ImageValidation {
  if (bytes.byteLength === 0) {
    return { ok: false, reason: "File is empty" };
  }
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      reason: `File exceeds ${MAX_IMAGE_BYTES / 1024 / 1024} MB`,
    };
  }

  const sniffed = sniffImageType(bytes);
  if (!sniffed) {
    return { ok: false, reason: "File is not a supported image" };
  }

  // When the declaration disagrees with the bytes, believe the bytes and refuse
  // anyway: the mismatch usually means someone is probing
  if (isAllowedImageType(declaredType) && declaredType !== sniffed) {
    return {
      ok: false,
      reason: `Declared ${declaredType} but the file is ${sniffed}`,
    };
  }

  return { ok: true, contentType: sniffed };
}

/** Determine the real format from the leading bytes */
export function sniffImageType(bytes: Uint8Array): AllowedImageType | null {
  const at = (index: number) => bytes[index];

  // JPEG: FF D8 FF
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) {
    return "image/jpeg";
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    at(0) === 0x89 &&
    at(1) === 0x50 &&
    at(2) === 0x4e &&
    at(3) === 0x47 &&
    at(4) === 0x0d &&
    at(5) === 0x0a &&
    at(6) === 0x1a &&
    at(7) === 0x0a
  ) {
    return "image/png";
  }

  // RIFF....WEBP
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...bytes.slice(start, start + length));

  if (bytes.byteLength >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    return "image/webp";
  }

  // AVIF: ....ftypavif
  if (bytes.byteLength >= 12 && ascii(4, 4) === "ftyp" && ascii(8, 4) === "avif") {
    return "image/avif";
  }

  return null;
}

/**
 * Build an object key.
 *
 * Product slug plus an index rather than a random hash, because the filename
 * counts towards image SEO. The slug is already URL-safe (the admin validates
 * it); this strips separators again as a second line of defence against path
 * traversal.
 */
export function buildImageKey(
  productSlug: string,
  index: number,
  contentType: AllowedImageType,
): string {
  const safeSlug = productSlug.replace(/[^a-z0-9-]/g, "").slice(0, 80);

  if (!safeSlug) {
    throw new Error("Product slug is required to build an image key");
  }

  const sequence = String(index).padStart(2, "0");
  return `products/${safeSlug}/${safeSlug}-${sequence}.${EXTENSION[contentType]}`;
}

/** Map an object key back to its public path */
export function imageUrl(objectKey: string): string {
  return `/api/images/${objectKey}`;
}
