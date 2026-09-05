import { describe, expect, it } from "vitest";
import {
  applyPsychologicalRounding,
  convertPrice,
  needsRecalculation,
} from "@/lib/pricing";

describe("applyPsychologicalRounding", () => {
  it("rounds up to the next .99 ending", () => {
    expect(applyPsychologicalRounding(9108, "ending99")).toBe(9199);
    expect(applyPsychologicalRounding(9200, "ending99")).toBe(9299);
  });

  it("leaves an amount already ending in .99 untouched", () => {
    expect(applyPsychologicalRounding(9199, "ending99")).toBe(9199);
  });

  it("rounds up to a whole unit under the integer strategy", () => {
    expect(applyPsychologicalRounding(9108, "integer")).toBe(9200);
    expect(applyPsychologicalRounding(9200, "integer")).toBe(9200);
  });
});

describe("convertPrice", () => {
  it("applies rate, buffer, then psychological rounding", () => {
    // 9900 * 0.92 = 9108; * 1.03 = 9381.24 -> 9381 -> rounded to .99 -> 9399
    expect(convertPrice({ baseMinor: 9900, rate: 0.92 })).toBe(9399);
  });

  it("honours an explicit zero buffer", () => {
    // 9900 * 0.92 = 9108 → 9199
    expect(convertPrice({ baseMinor: 9900, rate: 0.92, bufferRate: 0 })).toBe(
      9199,
    );
  });

  it("rejects a non-positive rate rather than producing a free product", () => {
    expect(() => convertPrice({ baseMinor: 9900, rate: 0 })).toThrow(/rate/i);
    expect(() => convertPrice({ baseMinor: 9900, rate: -1 })).toThrow(/rate/i);
  });
});

describe("needsRecalculation", () => {
  it("stays put while the rate drifts under the threshold", () => {
    // 0.92 -> 0.93 is 1.09% of drift, under the 2% threshold
    expect(needsRecalculation({ rateUsed: 0.92, currentRate: 0.93 })).toBe(
      false,
    );
  });

  it("triggers once the rate drifts beyond the threshold", () => {
    // 0.92 -> 0.95 is 3.26% of drift
    expect(needsRecalculation({ rateUsed: 0.92, currentRate: 0.95 })).toBe(true);
  });

  it("triggers symmetrically when the rate falls", () => {
    // 0.92 -> 0.88 is 4.35% of drift
    expect(needsRecalculation({ rateUsed: 0.92, currentRate: 0.88 })).toBe(true);
  });

  it("always recalculates when no previous rate was recorded", () => {
    expect(needsRecalculation({ rateUsed: 0, currentRate: 0.92 })).toBe(true);
  });
});
