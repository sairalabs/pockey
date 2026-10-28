'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { DOCS } from '@/lib/doc-list';

function href(slug: string) {
  return slug ? `/docs/${slug}` : '/docs';
}

export function DocsNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Documentation"
      className="mb-10 w-full shrink-0 lg:mb-0 lg:w-[200px] lg:self-start"
    >
      <div className="lg:sticky lg:top-24">
        <p className="px-3 text-[13px] font-semibold text-fg">Documentation</p>
        <ul className="mt-3 flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
          {DOCS.map((doc) => {
            const path = href(doc.slug);
            const active = pathname === path;
            return (
              <li key={doc.slug || 'index'}>
                <Link
                  href={path}
                  aria-current={active ? 'page' : undefined}
                  className={`block whitespace-nowrap rounded-control px-3 py-2 text-[14px] transition-colors ${
                    active ? 'bg-surface-2 text-fg' : 'text-fg-2 hover:bg-surface hover:text-fg'
                  }`}
                >
                  {doc.title}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
