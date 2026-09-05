/**
 * Theme name resolution.
 *
 * Kept out of the registry, which has to import each theme's React components.
 * This logic is pure, and separating it is what makes it testable without
 * loading the entire component tree.
 */
export function resolveThemeName(
  requested: string | undefined,
  registered: readonly string[],
  fallback: string,
): { name: string; fellBack: boolean } {
  if (!requested) {
    return { name: fallback, fellBack: false };
  }

  if (registered.includes(requested)) {
    return { name: requested, fellBack: false };
  }

  // A whole site blank in production because a theme name was misspelled is far
  // worse than the same site rendered with the default theme
  return { name: fallback, fellBack: true };
}
