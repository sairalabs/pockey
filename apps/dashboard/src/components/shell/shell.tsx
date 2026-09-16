import type { ReactNode } from 'react';
import { Footer } from '@/components/shell/footer';
import { TopBar } from '@/components/shell/top-bar';

/** Top bar, centered 660px content column with 24px padding, footer. */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar />
      <main className="mx-auto w-full max-w-[708px] flex-1 px-6 pb-16 pt-8">{children}</main>
      <Footer />
    </div>
  );
}
