import type { AdminApp, Developer } from '@pocketkey/types';
import type { ReactNode } from 'react';
import { Footer } from '@/components/shell/footer';
import { TopBar } from '@/components/shell/top-bar';

export interface ShellProps {
  developer: Developer;
  apps: readonly AdminApp[];
  children: ReactNode;
}

/** Top bar, centered 708px content column with 24px padding, footer. */
export function Shell({ developer, apps, children }: ShellProps) {
  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar developer={developer} apps={apps} />
      <main className="mx-auto w-full max-w-[708px] flex-1 px-6 pb-16 pt-8">{children}</main>
      <Footer />
    </div>
  );
}
