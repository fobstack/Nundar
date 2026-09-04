import { describe, expect, it } from "vitest";

describe("test harness", () => {
  it("runs inside a Workers-like runtime with crypto available", () => {
    expect(typeof crypto.randomUUID).toBe("function");
    expect(crypto.randomUUID()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});
