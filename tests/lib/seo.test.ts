import { describe, expect, it } from "vitest";
import { SITE } from "@/config/site";
import { absoluteUrl, buildAlternates, localePath } from "@/lib/seo";

describe("localePath", () => {
  it("prefixes the locale and joins segments", () => {
    expect(localePath("de", "products", "ball-valve")).toBe(
      "/de/products/ball-valve",
    );
  });

  it("returns the locale root when given no segments", () => {
    expect(localePath("en")).toBe("/en");
  });

  it("never produces duplicate slashes", () => {
    expect(localePath("fr", "/products/", "/x/")).toBe("/fr/products/x");
  });
});

describe("absoluteUrl", () => {
  it("prepends the configured site origin", () => {
    expect(absoluteUrl("/en/products")).toBe(`${SITE.url}/en/products`);
  });

  it("tolerates a path without a leading slash", () => {
    expect(absoluteUrl("en")).toBe(`${SITE.url}/en`);
  });
});

describe("buildAlternates", () => {
  const alternates = buildAlternates("de", (locale) =>
    localePath(locale, "products", "ball-valve"),
  );

  it("points canonical at the current locale's absolute URL", () => {
    expect(alternates.canonical).toBe(
      `${SITE.url}/de/products/ball-valve`,
    );
  });

  it("lists every shipped locale", () => {
    expect(Object.keys(alternates.languages).sort()).toEqual(
      ["de", "en", "es", "fr", "x-default"].sort(),
    );
  });

  it("maps x-default to the default locale", () => {
    expect(alternates.languages["x-default"]).toBe(
      `${SITE.url}/en/products/ball-valve`,
    );
  });

  it("emits absolute URLs for every language", () => {
    for (const url of Object.values(alternates.languages)) {
      expect(url.startsWith(SITE.url)).toBe(true);
    }
  });
});
