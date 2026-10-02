/**
 * Files imported as text.
 *
 * `wrangler.jsonc` declares a Text rule for these extensions, so an import of
 * one is its contents as a string. TypeScript has to be told the same thing,
 * or every such import is an unresolved module.
 */

declare module '*.sql' {
  const text: string;
  export default text;
}

declare module '*.liquid' {
  const text: string;
  export default text;
}

declare module '*.css' {
  const text: string;
  export default text;
}

declare module '*.md' {
  const text: string;
  export default text;
}
