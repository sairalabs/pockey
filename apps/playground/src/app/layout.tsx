import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { DevFeedback } from './DevFeedback';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Pockey playground',
  description: 'Exercises every @pockey/react hook against a local API and embed.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
        <DevFeedback appName="Pockey playground" />
      </body>
    </html>
  );
}
