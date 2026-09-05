import type { Theme } from "./contract";
import { defaultTheme } from "./default";
import { resolveThemeName } from "./resolve";

/**
 * The theme registry.
 *
 * Themes are chosen at build time: set `THEME=<directory>` in `.dev.vars` or in
 * the deployment environment and rebuild.
 *
 * There is deliberately no runtime switching. In a single-tenant self-hosted
 * shop the theme is chosen once and rarely changed, whereas switching at
 * runtime would mean bundling every theme into the Worker and invalidating the
 * static page cache — far more cost than the flexibility is worth.
 *
 * To add a theme: copy src/themes/default under a new name, implement the Theme
 * interface from contract.ts (TypeScript will insist on every view), and
 * register it here.
 */
const THEMES: Record<string, Theme> = {
  default: defaultTheme,
};

export const DEFAULT_THEME_NAME = "default";

export function listThemes(): Theme[] {
  return Object.values(THEMES);
}

export function getTheme(name = process.env.THEME): Theme {
  const { name: resolved, fellBack } = resolveThemeName(
    name,
    Object.keys(THEMES),
    DEFAULT_THEME_NAME,
  );

  if (fellBack) {
    console.warn(
      `[theme] unknown theme "${name}", falling back to "${DEFAULT_THEME_NAME}". Registered: ${Object.keys(THEMES).join(", ")}`,
    );
  }

  return THEMES[resolved];
}
