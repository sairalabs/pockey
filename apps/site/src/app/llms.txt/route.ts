import { DOCS } from '@/lib/doc-list';
import { docPath } from '@/lib/doc-meta';
import { site } from '@/lib/site';

/**
 * A map of this site for the assistants that read it instead of visiting it,
 * in the form llmstxt.org describes: a title, a summary, then the pages worth
 * reading with a line each. The whole documentation, as markdown, is one file
 * further along at /llms-full.txt.
 */
export const dynamic = 'force-static';

export function GET(): Response {
  const lines = [
    `# ${site.name}`,
    '',
    `> ${site.summary}`,
    '',
    'Pockey is self hosted. There is no hosted version and no account to open:',
    'you run the API, the database and the iframe yourself, and the keys live in',
    'a Turnkey sub-organization whose only root user is your end user, so no',
    'server of yours can sign for them.',
    '',
    '## Documentation',
    '',
    ...DOCS.map((doc) => `- [${doc.title}](${site.url}${docPath(doc)}): ${doc.summary}`),
    '',
    '## Elsewhere',
    '',
    `- [Source](${site.repo}): the repository, MIT licensed.`,
    `- [Everything as one file](${site.url}/llms-full.txt): the documentation, in markdown.`,
    '',
  ];

  return new Response(lines.join('\n'), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
