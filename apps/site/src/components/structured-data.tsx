/**
 * Structured data, for search engines and for the assistants that read this
 * site instead of visiting it. Everything here restates what the page already
 * says in prose: nothing is described to a machine that a reader cannot see.
 */

/** `<` is escaped so a string can never close the script tag early. */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  );
}
