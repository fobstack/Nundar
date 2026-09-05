import { renderMarkdown } from "@/lib/markdown";

/**
 * Render Markdown body copy.
 *
 * dangerouslySetInnerHTML is safe here: renderMarkdown escapes every HTML
 * special character before applying any syntax, so the set of tags produced is
 * decided entirely by the renderer and never by the input.
 */
export function Markdown({
  source,
  className = "prose",
}: {
  source: string;
  className?: string;
}) {
  const html = renderMarkdown(source);

  if (!html) {
    return null;
  }

  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
