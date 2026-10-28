import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import { Footer } from '@/components/footer';
import { Nav } from '@/components/nav';
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
  openGraph: {
    type: 'website',
    siteName: site.name,
    title: `${site.name}, ${site.tagline}`,
    description: site.description,
    url: site.url,
  },
  twitter: { card: 'summary_large_image' },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-dvh bg-bg text-fg antialiased">
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
