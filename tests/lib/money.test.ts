import { describe, expect, it } from "vitest";
import {
  formatMoney,
  fromMinor,
  multiplyMinor,
  sumMinor,
  toMinor,
} from "@/lib/money";

describe("toMinor", () => {
  it("converts a decimal amount to integer minor units", () => {
    expect(toMinor(99, "USD")).toBe(9900);
    expect(toMinor(99.5, "USD")).toBe(9950);
    expect(toMinor(0.01, "USD")).toBe(1);
  });

  it("rounds rather than truncates float artefacts", () => {
    // 1.005 在 IEEE754 下实为 1.00499999...，截断会得到 100
    expect(toMinor(1.005, "USD")).toBe(101);
  });

  it("rejects non-finite input instead of producing NaN money", () => {
    expect(() => toMinor(Number.NaN, "USD")).toThrow(/finite/i);
    expect(() => toMinor(Number.POSITIVE_INFINITY, "USD")).toThrow(/finite/i);
  });
});

describe("fromMinor", () => {
  it("converts integer minor units back to a decimal amount", () => {
    expect(fromMinor(9900, "USD")).toBe(99);
    expect(fromMinor(9199, "EUR")).toBe(91.99);
  });

  it("rejects non-integer minor units", () => {
    expect(() => fromMinor(99.5, "USD")).toThrow(/integer/i);
  });
});

describe("multiplyMinor", () => {
  it("keeps the result an integer", () => {
    expect(multiplyMinor(9900, 0.92)).toBe(9108);
    expect(multiplyMinor(9900, 1.03)).toBe(10197);
  });

  it("rounds half away from zero", () => {
    expect(multiplyMinor(101, 0.5)).toBe(51);
  });
});

describe("sumMinor", () => {
  it("adds integer amounts without float drift", () => {
    expect(sumMinor([1010, 2020, 3030])).toBe(6060);
    expect(sumMinor([])).toBe(0);
  });
});

describe("formatMoney", () => {
  it("formats per locale and currency", () => {
    // 只断言关键片段，避免绑定各 ICU 版本的空格与符号位置差异
    const usd = formatMoney(9900, "USD", "en");
    expect(usd).toContain("99");
    expect(usd).toContain("$");

    const eur = formatMoney(9199, "EUR", "de");
    expect(eur).toContain("91,99");
    expect(eur).toContain("€");
  });
});
