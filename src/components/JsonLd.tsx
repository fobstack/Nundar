/**
 * Emit a JSON-LD script block.
 * Escapes </script so a string in the data cannot close the tag early and turn
 * into XSS.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  const json = JSON.stringify(data).replace(/<\/script/gi, "<\\/script");

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
