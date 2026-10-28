import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Marked } from 'marked';
import { highlightToHtml } from './highlight';
import { site } from './site';
import type { DocPage } from './doc-list';

/**
 * The documentation is the repository's own markdown, read at build time. There
 * is no second copy to keep in sync: if a file here goes stale, so does the one
 * a contributor reads on GitHub, and someone will notice.
 */

/** Markdown paths that have a page here, in every spelling the repository uses. */
const INTERNAL: Record<string, string> = {
  'README.md': '/docs',
  'SECURITY.md': '/docs/security',
  'TURNKEY.md': '/docs/turnkey',
  'CONTRIBUTING.md': '/docs/contributing',
  'docs/self-hosting.md': '/docs/self-hosting',
  'self-hosting.md': '/docs/self-hosting',
  'docs/decisions.md': '/docs/decisions',
  'decisions.md': '/docs/decisions',
};

const REPO_BLOB = `${site.repo}/blob/main/`;

function resolveHref(href: string): string {
  if (/^(https?:|mailto:|#)/.test(href)) return href;
  const clean = href.replace(/^\.\//, '').replace(/^(\.\.\/)+/, '');
  const [pathPart = '', hash] = clean.split('#');
  const internal = INTERNAL[pathPart];
  if (internal) return hash ? `${internal}#${hash}` : internal;
  // Anything else points at the source: send the reader to the repository.
  return REPO_BLOB + clean;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function buildMarked(): Marked {
  const marked = new Marked({ gfm: true });

  marked.use({
    renderer: {
      link(token) {
        const href = resolveHref(token.href);
        const text = this.parser.parseInline(token.tokens);
        const external = /^https?:/.test(href);
        const attrs = external ? ' target="_blank" rel="noreferrer noopener"' : '';
        return `<a href="${href}"${attrs}>${text}</a>`;
      },
      heading(token) {
        const text = this.parser.parseInline(token.tokens);
        const id = slugify(token.text);
        return `<h${token.depth} id="${id}">${text}</h${token.depth}>\n`;
      },
      code(token) {
        const lang = (token.lang ?? '').split(/\s+/)[0];
        return `<pre><code>${highlightToHtml(token.text, lang)}</code></pre>\n`;
      },
    },
  });

  return marked;
}

/**
 * `content/` is filled by `scripts/collect-docs.mjs` before every build. The
 * path stays inside this app on purpose: reading across the monorepo makes Next
 * trace the whole repository into the server output.
 */
function source(doc: DocPage): string {
  return path.join(process.cwd(), 'content', path.basename(doc.file));
}

export async function renderDoc(doc: DocPage): Promise<string> {
  const markdown = await readFile(source(doc), 'utf8');
  return buildMarked().parse(markdown, { async: false });
}

/** The second level headings of a page, for the list beside it. */
export async function docHeadings(doc: DocPage): Promise<{ id: string; text: string }[]> {
  const markdown = await readFile(source(doc), 'utf8');
  const headings: { id: string; text: string }[] = [];
  let inFence = false;

  for (const line of markdown.split('\n')) {
    if (line.startsWith('```')) inFence = !inFence;
    if (inFence) continue;
    const match = /^##\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const text = (match[1] ?? '').replace(/[*`]/g, '');
    headings.push({ id: slugify(text), text });
  }

  return headings;
}
