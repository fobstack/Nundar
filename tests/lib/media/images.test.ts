import { describe, expect, it } from "vitest";
import {
  ALLOWED_IMAGE_TYPES,
  buildImageKey,
  imageUrl,
  isAllowedImageType,
  MAX_IMAGE_BYTES,
  sniffImageType,
  validateImage,
} from "@/lib/media/images";

function bytesOf(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function withAscii(prefix: number[], text: string, at: number): Uint8Array {
  const bytes = new Uint8Array(Math.max(prefix.length, at + text.length, 12));
  bytes.set(prefix, 0);
  for (let i = 0; i < text.length; i += 1) {
    bytes[at + i] = text.charCodeAt(i);
  }
  return bytes;
}

const JPEG = bytesOf(0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0);
const PNG = bytesOf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0);

describe("sniffImageType", () => {
  it("recognises JPEG", () => {
    expect(sniffImageType(JPEG)).toBe("image/jpeg");
  });

  it("recognises PNG", () => {
    expect(sniffImageType(PNG)).toBe("image/png");
  });

  it("recognises WebP", () => {
    const webp = withAscii([], "RIFF", 0);
    webp.set(new TextEncoder().encode("WEBP"), 8);
    expect(sniffImageType(webp)).toBe("image/webp");
  });

  it("recognises AVIF", () => {
    const avif = new Uint8Array(12);
    avif.set(new TextEncoder().encode("ftyp"), 4);
    avif.set(new TextEncoder().encode("avif"), 8);
    expect(sniffImageType(avif)).toBe("image/avif");
  });

  it("returns null for something that is not an image", () => {
    const html = new TextEncoder().encode("<html><script>alert(1)</script>");
    expect(sniffImageType(html)).toBeNull();
  });

  it("returns null for an SVG, which can carry script", () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">');
    expect(sniffImageType(svg)).toBeNull();
  });
});

describe("validateImage", () => {
  it("accepts a real JPEG", () => {
    const result = validateImage(JPEG, "image/jpeg");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.contentType).toBe("image/jpeg");
  });

  it("rejects an empty file", () => {
    const result = validateImage(new Uint8Array(0), "image/png");
    expect(result.ok).toBe(false);
  });

  it("rejects a file over the size limit", () => {
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set([0xff, 0xd8, 0xff]);

    const result = validateImage(big, "image/jpeg");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/exceeds/i);
  });

  it("rejects HTML disguised as an image, whatever it claims to be", () => {
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");

    // 客户端声明的 Content-Type 可任意伪造；一个被当图片存下、实际是 HTML
    // 的文件在同源提供时就是 XSS 载体
    const result = validateImage(html, "image/png");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/not a supported image/i);
  });

  it("rejects a file whose declared type contradicts its actual bytes", () => {
    const result = validateImage(PNG, "image/jpeg");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/declared/i);
  });

  it("trusts the sniffed type when the declaration is missing or odd", () => {
    const result = validateImage(JPEG, "application/octet-stream");
    expect(result.ok).toBe(true);
  });
});

describe("buildImageKey", () => {
  it("uses the product slug so the filename carries meaning for image SEO", () => {
    const key = buildImageKey("stainless-ball-valve-dn50", 1, "image/jpeg");
    expect(key).toBe(
      "products/stainless-ball-valve-dn50/stainless-ball-valve-dn50-01.jpg",
    );
  });

  it("pads the sequence so keys sort correctly", () => {
    expect(buildImageKey("valve", 2, "image/png")).toContain("valve-02.png");
    expect(buildImageKey("valve", 12, "image/png")).toContain("valve-12.png");
  });

  it("strips characters that could escape the intended prefix", () => {
    const key = buildImageKey("../../etc/passwd", 1, "image/png");

    expect(key).not.toContain("..");
    expect(key).not.toContain("etc/passwd");
    expect(key.startsWith("products/")).toBe(true);
  });

  it("refuses a slug that sanitises down to nothing", () => {
    expect(() => buildImageKey("../..", 1, "image/png")).toThrow(/slug/i);
  });

  it("maps every allowed type to an extension", () => {
    for (const type of ALLOWED_IMAGE_TYPES) {
      expect(buildImageKey("valve", 1, type)).toMatch(/\.(jpg|png|webp|avif)$/);
    }
  });
});

describe("isAllowedImageType", () => {
  it("rejects SVG, which can execute script when served inline", () => {
    expect(isAllowedImageType("image/svg+xml")).toBe(false);
  });

  it("accepts the four shipped raster formats", () => {
    for (const type of ALLOWED_IMAGE_TYPES) {
      expect(isAllowedImageType(type)).toBe(true);
    }
  });
});

describe("imageUrl", () => {
  it("serves through the app rather than exposing the bucket", () => {
    expect(imageUrl("products/valve/valve-01.jpg")).toBe(
      "/api/images/products/valve/valve-01.jpg",
    );
  });
});
