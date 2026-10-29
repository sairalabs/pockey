import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { MetadataRoute } from 'next';
import { DOCS } from '@/lib/doc-list';
import { docPath } from '@/lib/doc-meta';
import { site } from '@/lib/site';

/**
 * When each documentation file last changed, written by
 * `scripts/collect-docs.mjs` and keyed by path from the repository root.
 *
 * Read rather than imported: `content/` is generated, so a checkout that has
 * not built anything yet does not have it, and an import would stop the whole
 * app from typechecking over a date.
 */
function changed(): Record<string, string> {
  try {
    const file = path.join(process.cwd(), 'content', 'updated.json');
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

export default function sitemap(): MetadataRoute.Sitemap {
  const dates = changed();

  const docs = DOCS.map((doc) => ({
    url: new URL(docPath(doc), site.url).toString(),
    lastModified: dates[doc.file],
  }));

  const pages = ['/', '/legal/notice', '/legal/privacy'].map((page) => ({
    url: new URL(page, site.url).toString(),
  }));

  return [...pages, ...docs];
}
