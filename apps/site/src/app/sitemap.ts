import type { MetadataRoute } from 'next';
import { DOCS } from '@/lib/doc-list';
import { site } from '@/lib/site';

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = [
    '/',
    '/docs',
    ...DOCS.filter((doc) => doc.slug).map((doc) => `/docs/${doc.slug}`),
    '/legal/notice',
    '/legal/privacy',
  ];

  return pages.map((page) => ({
    url: new URL(page, site.url).toString(),
    lastModified: new Date(),
  }));
}
