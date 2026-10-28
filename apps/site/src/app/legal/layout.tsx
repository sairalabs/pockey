import Link from 'next/link';
import type { ReactNode } from 'react';

const pages = [
  { href: '/legal/notice', label: 'Legal notice' },
  { href: '/legal/privacy', label: 'Privacy' },
];

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[760px] px-6 py-12">
      <nav aria-label="Legal" className="mb-10 flex gap-2">
        {pages.map((page) => (
          <Link
            key={page.href}
            href={page.href}
            className="rounded-pill bg-surface px-4 py-2 text-[14px] text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg"
          >
            {page.label}
          </Link>
        ))}
      </nav>
      <div className="prose">{children}</div>
    </div>
  );
}
