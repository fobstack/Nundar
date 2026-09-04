import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

// 绑定名写错到部署时才发现的成本很高，这里在测试运行时里提前拦住
describe("cloudflare bindings", () => {
  it("exposes the D1 database as DB", () => {
    expect(env.DB).toBeDefined();
    expect(typeof env.DB.prepare).toBe("function");
  });

  it("exposes the R2 bucket for product images as IMAGES", () => {
    expect(env.IMAGES).toBeDefined();
    expect(typeof env.IMAGES.put).toBe("function");
  });

  it("exposes the KV namespace for sessions and carts as SESSIONS", () => {
    expect(env.SESSIONS).toBeDefined();
    expect(typeof env.SESSIONS.get).toBe("function");
  });
});
