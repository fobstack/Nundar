import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

// A mistyped binding name discovered at deploy time is expensive; this catches it
// in the test runtime instead
describe("cloudflare bindings", () => {
  it("exposes the D1 database as DB", () => {
    expect(env.DB).toBeDefined();
    expect(typeof env.DB.prepare).toBe("function");
  });

  it("exposes the R2 bucket for product media as MEDIA", () => {
    // Deliberately not called IMAGES: that name is reserved by Cloudflare Images,
    // and using it makes the generated type ImagesBinding rather than R2Bucket
    expect(env.MEDIA).toBeDefined();
    expect(typeof env.MEDIA.put).toBe("function");
  });

  it("exposes the KV namespace for sessions and carts as SESSIONS", () => {
    expect(env.SESSIONS).toBeDefined();
    expect(typeof env.SESSIONS.get).toBe("function");
  });
});
