import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import { Footer } from '@/components/footer';
import { Nav } from '@/components/nav';
import { JsonLd } from '@/components/structured-data';
import { site } from '@/lib/site';
import { DevFeedback } from './DevFeedback';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: `${site.name}, ${site.tagline}`, template: `%s | ${site.name}` },
  description: site.description,
  applicationName: site.name,
  authors: [{ name: site.author, url: site.authorUrl }],
  creator: site.author,
  publisher: site.author,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: site.name,
    title: `${site.name}, ${site.tagline}`,
    description: site.description,
    url: site.url,
    locale: 'en',
  },
  twitter: { card: 'summary_large_image' },
};

/* What the site is and who stands behind it, said once for the whole site. */
const SITE_GRAPH = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': `${site.url}/#website`,
      url: site.url,
      name: site.name,
      description: site.description,
      inLanguage: 'en',
      publisher: { '@id': `${site.url}/#publisher` },
    },
    {
      '@type': 'Organization',
      '@id': `${site.url}/#publisher`,
      name: site.author,
      url: site.authorUrl,
      email: site.contact,
    },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-dvh bg-bg text-fg antialiased">
        <JsonLd data={SITE_GRAPH} />
        <a
          href="#content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-6 focus:top-4 focus:z-[60] focus:rounded-pill focus:bg-white focus:px-4 focus:py-2 focus:text-[14px] focus:text-black"
        >
          Skip to content
        </a>
        <Nav />
        <main id="content">{children}</main>
        <Footer />
        <DevFeedback appName="Pockey site" />
      </body>
    </html>
  );
}
