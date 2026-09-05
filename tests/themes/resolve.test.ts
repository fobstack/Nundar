import { describe, expect, it } from "vitest";
import { resolveThemeName } from "@/themes/resolve";

const REGISTERED = ["default", "minimal"] as const;

describe("resolveThemeName", () => {
  it("uses the fallback when nothing is configured", () => {
    expect(resolveThemeName(undefined, REGISTERED, "default")).toEqual({
      name: "default",
      fellBack: false,
    });
  });

  it("resolves a registered name", () => {
    expect(resolveThemeName("minimal", REGISTERED, "default")).toEqual({
      name: "minimal",
      fellBack: false,
    });
  });

  it("falls back and reports it for an unknown name", () => {
    // A blank site because a theme name was misspelled is far worse than the same
    // site rendered with the default theme
    expect(resolveThemeName("typo", REGISTERED, "default")).toEqual({
      name: "default",
      fellBack: true,
    });
  });

  it("treats an empty string as not configured", () => {
    expect(resolveThemeName("", REGISTERED, "default").fellBack).toBe(false);
  });

  it("is case sensitive, matching the directory name exactly", () => {
    expect(resolveThemeName("Default", REGISTERED, "default").fellBack).toBe(true);
  });
});
