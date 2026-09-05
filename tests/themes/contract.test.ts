import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

/**
 * Theme stylesheets must not collide.
 *
 * The registry imports every registered theme statically, so every theme's
 * stylesheet lands in the same bundle no matter which one THEME selects. A
 * build with both themes registered puts `.theme-default` and
 * `.theme-editorial` rules in one chunk. If either declared its tokens on
 * `:root`, the last stylesheet loaded would win and THEME would silently stop
 * meaning anything.
 *
 * This is not hypothetical: the default theme shipped exactly that way until a
 * second theme existed to expose it.
 */
const STYLESHEETS: { name: string; css: string }[] = Object.entries(
  env.THEME_STYLESHEETS,
).map(([name, css]) => ({ name, css }));

/** Top-level selectors, with comments and nested media blocks accounted for. */
function topLevelSelectors(css: string): string[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors: string[] = [];
  let depth = 0;
  let buffer = "";

  for (const char of withoutComments) {
    if (char === "{") {
      if (depth === 0 || buffer.trim().startsWith("@")) {
        const text = buffer.trim();
        if (text && !text.startsWith("@")) {
          selectors.push(text);
        }
      } else {
        const text = buffer.trim();
        if (text) selectors.push(text);
      }
      depth += 1;
      buffer = "";
    } else if (char === "}") {
      depth -= 1;
      buffer = "";
    } else {
      buffer += char;
    }
  }

  return selectors;
}

describe.each(STYLESHEETS)("$name theme stylesheet", ({ name, css }) => {
  it("declares nothing on :root, which would leak across themes", () => {
    const selectors = topLevelSelectors(css);
    expect(selectors.filter((selector) => selector.includes(":root"))).toEqual([]);
  });

  it("scopes every rule to its own theme class", () => {
    const selectors = topLevelSelectors(css);

    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      // Every comma-separated part must sit under this theme's root class
      for (const part of selector.split(",")) {
        expect(part.trim(), `"${part.trim()}" escapes .theme-${name}`).toMatch(
          new RegExp(`^\\.theme-${name}\\b`),
        );
      }
    }
  });

  it("defines the tokens the shared components read", () => {
    for (const token of ["--bg", "--ink", "--accent", "--space-4", "--shell-max"]) {
      expect(css, `${name} is missing ${token}`).toContain(`${token}:`);
    }
  });
});

describe("themes do not share a root class", () => {
  it("finds every theme on disk", () => {
    expect(STYLESHEETS.length).toBeGreaterThanOrEqual(2);
    expect(STYLESHEETS.map(({ name }) => name).sort()).toContain("editorial");
  });

  it("gives each theme a distinct scope", () => {
    const scopes = STYLESHEETS.map(({ name }) => `.theme-${name}`);
    expect(new Set(scopes).size).toBe(scopes.length);
  });

  it("keeps one theme's rules out of another's stylesheet", () => {
    for (const { name, css } of STYLESHEETS) {
      for (const other of STYLESHEETS) {
        if (other.name === name) continue;
        expect(css, `${name} reaches into .theme-${other.name}`).not.toContain(
          `.theme-${other.name}`,
        );
      }
    }
  });
});

describe("a theme's Shell applies its own scope", () => {
  /**
   * The scope class is written by hand in each Shell. Copying a theme and
   * renaming the directory without renaming that class would put two themes
   * back on one scope — the exact collision the scoping fix removed, and one
   * that no type error would catch.
   */
  it.each(Object.keys(env.THEME_SHELLS))("%s applies .theme-%s", (name) => {
    expect(env.THEME_SHELLS[name]).toContain(`className="theme-${name}"`);
  });

  it("never applies another theme's scope", () => {
    for (const [name, source] of Object.entries(env.THEME_SHELLS)) {
      for (const other of Object.keys(env.THEME_SHELLS)) {
        if (other === name) continue;
        expect(source, `${name}'s Shell applies .theme-${other}`).not.toContain(
          `className="theme-${other}"`,
        );
      }
    }
  });
});
