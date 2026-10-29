import { DOCS } from '@/lib/doc-list';
import { docPath } from '@/lib/doc-meta';
import { rawDoc } from '@/lib/docs';
import { site } from '@/lib/site';

/**
 * The whole documentation as one markdown file, which is the cheapest thing to
 * give a reader that cannot follow links. It is the repository's own markdown,
 * not a retelling of it.
 */
export const dynamic = 'force-static';

export async function GET(): Promise<Response> {
  const parts = await Promise.all(
    DOCS.map(async (doc) => {
      const markdown = await rawDoc(doc);
      return [
        `<!-- ${site.url}${docPath(doc)} (source: ${doc.file}) -->`,
        '',
        markdown.trim(),
        '',
      ].join('\n');
    }),
  );

  const body = [
    `# ${site.name}`,
    '',
    `> ${site.summary}`,
    '',
    `Source: ${site.repo}, MIT licensed. Every section below is a file of that`,
    'repository, rendered on the site at the address in the comment above it.',
    '',
    '---',
    '',
    parts.join('\n---\n\n'),
  ].join('\n');

  return new Response(body, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
