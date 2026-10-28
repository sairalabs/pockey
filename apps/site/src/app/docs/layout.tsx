import type { ReactNode } from 'react';
import { DocsNav } from '@/components/docs-nav';

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[1200px] gap-12 px-6 py-12 lg:flex">
      <DocsNav />
      <div className="min-w-0 flex-1 lg:max-w-[900px]">{children}</div>
    </div>
  );
}
