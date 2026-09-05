import { describe, expect, it } from "vitest";
import {
  assertTransition,
  canTransition,
  ORDER_STATUSES,
  type OrderStatus,
} from "@/lib/orders/state";

describe("canTransition", () => {
  it("walks the happy path", () => {
    expect(canTransition("pending", "paid")).toBe(true);
    expect(canTransition("paid", "shipped")).toBe(true);
    expect(canTransition("shipped", "delivered")).toBe(true);
  });

  it("allows refunds from paid, shipped and delivered", () => {
    expect(canTransition("paid", "refunded")).toBe(true);
    expect(canTransition("shipped", "refunded")).toBe(true);
    expect(canTransition("delivered", "refunded")).toBe(true);
  });

  it("allows cancelling only while unpaid", () => {
    expect(canTransition("pending", "cancelled")).toBe(true);
    expect(canTransition("paid", "cancelled")).toBe(false);
  });

  it("routes an oversold order out of pending", () => {
    expect(canTransition("pending", "oversold")).toBe(true);
    // An oversold order can only be refunded or cancelled by hand; it must never
    // pretend to be paid and ship
    expect(canTransition("oversold", "refunded")).toBe(true);
    expect(canTransition("oversold", "cancelled")).toBe(true);
    expect(canTransition("oversold", "shipped")).toBe(false);
  });

  it("refuses to skip payment", () => {
    expect(canTransition("pending", "shipped")).toBe(false);
    expect(canTransition("pending", "delivered")).toBe(false);
  });

  it("refuses to move backwards", () => {
    expect(canTransition("shipped", "paid")).toBe(false);
    expect(canTransition("paid", "pending")).toBe(false);
  });

  it("treats terminal states as terminal", () => {
    for (const status of ORDER_STATUSES) {
      expect(canTransition("refunded", status)).toBe(false);
      expect(canTransition("cancelled", status)).toBe(false);
    }
  });

  it("rejects a transition to the same state", () => {
    expect(canTransition("paid", "paid")).toBe(false);
  });

  it("rejects an unknown status string", () => {
    expect(canTransition("bogus" as OrderStatus, "paid")).toBe(false);
  });
});

describe("assertTransition", () => {
  it("passes a legal transition through", () => {
    expect(() => assertTransition("pending", "paid")).not.toThrow();
  });

  it("names both states when refusing", () => {
    expect(() => assertTransition("shipped", "pending")).toThrow(
      /shipped.*pending/,
    );
  });
});
