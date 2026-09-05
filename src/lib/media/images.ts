/**
 * 商品图存储（R2）。
 *
 * 只用 R2、不接 Cloudflare Images：R2 有免费额度且出口流量免费，而 Images 是
 * 独立付费产品。代价是变体（缩略图等）要自己处理——当前策略是原图直传、
 * 展示端按需裁切，图片量或流量增长后再评估是否升级。
 *
 * object key 用商品 slug 而非随机哈希：文件名是图片 SEO 的排名信号之一，
 * `stainless-ball-valve-dn50-01.jpg` 比 `a3f9c2.jpg` 有意义得多。
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** 只接受浏览器广泛支持、且能被安全地当作图片渲染的格式 */
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
 * 校验上传的文件。
 *
 * 只信 magic bytes，不信客户端声明的 Content-Type 和扩展名——两者都可任意伪造，
 * 而一个被当作图片存下、实际是 HTML 的文件，在同源提供时就是 XSS 载体。
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

  // 声明与实际不符时以实际为准，但要拒绝——这通常意味着有人在试探
  if (isAllowedImageType(declaredType) && declaredType !== sniffed) {
    return {
      ok: false,
      reason: `Declared ${declaredType} but the file is ${sniffed}`,
    };
  }

  return { ok: true, contentType: sniffed };
}

/** 按文件头字节判断真实格式 */
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
 * 生成 object key。
 *
 * 用商品 slug + 序号，不用随机哈希——文件名参与图片 SEO。
 * slug 已经是 URL 安全的（后台校验过），这里再兜一层防止路径穿越。
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

/** 从 object key 反推公开访问路径 */
export function imageUrl(objectKey: string): string {
  return `/api/images/${objectKey}`;
}
