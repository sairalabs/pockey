import type { Metadata } from 'next';
import type { DocPage } from './doc-list';
import { site } from './site';

/** The path a doc page lives at, with no trailing slash. */
export function docPath(doc: DocPage): string {
  return doc.slug ? `/docs/${doc.slug}` : '/docs';
}

/**
 * Without this a doc page would inherit the home page's Open Graph card, title
 * and all, because Next takes the parent's object whole when a route does not
 * give its own.
 */
export function docMetadata(doc: DocPage): Metadata {
  const path = docPath(doc);
  return {
    title: doc.title,
    description: doc.summary,
    alternates: { canonical: path },
    openGraph: {
      type: 'article',
      siteName: site.name,
      title: `${doc.title} | ${site.name}`,
      description: doc.summary,
      url: new URL(path, site.url).toString(),
      locale: 'en',
    },
  };
}

/** The page as a piece of documentation, for anything reading the markup. */
export function docGraph(doc: DocPage): Record<string, unknown> {
  const url = new URL(docPath(doc), site.url).toString();
  return {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    '@id': `${url}#article`,
    headline: doc.title,
    description: doc.summary,
    url,
    inLanguage: 'en',
    isPartOf: { '@id': `${site.url}/#website` },
    publisher: { '@id': `${site.url}/#publisher` },
    license: 'https://opensource.org/licenses/MIT',
    isAccessibleForFree: true,
  };
}
