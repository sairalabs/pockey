import type { MetadataRoute } from 'next';
import updated from '../../content/updated.json';
import { DOCS } from '@/lib/doc-list';
import { docPath } from '@/lib/doc-meta';
import { site } from '@/lib/site';

/** Written by `scripts/collect-docs.mjs`, keyed by path from the repository root. */
const CHANGED: Record<string, string> = updated;

export default function sitemap(): MetadataRoute.Sitemap {
  const docs = DOCS.map((doc) => ({
    url: new URL(docPath(doc), site.url).toString(),
    lastModified: CHANGED[doc.file],
  }));

  const pages = ['/', '/legal/notice', '/legal/privacy'].map((page) => ({
    url: new URL(page, site.url).toString(),
  }));

  return [...pages, ...docs];
}
