import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import { DevFeedback } from './DevFeedback';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'Pockey', template: '%s | Pockey' },
  description: 'Embedded wallets dashboard.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-dvh bg-bg text-fg antialiased">
        {children}
        <DevFeedback appName="Pockey dashboard" />
      </body>
    </html>
  );
}
