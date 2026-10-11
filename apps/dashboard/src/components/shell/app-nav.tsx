'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

/** Section tabs of one app: same underline language as the Tabs primitive. */
export function AppNav({ appId }: { appId: string }) {
  const pathname = usePathname();
  const base = `/apps/${appId}`;
  const items = [
    { label: 'Home', href: base },
    { label: 'API keys', href: `${base}/keys` },
    { label: 'Users', href: `${base}/users` },
    { label: 'Usage', href: `${base}/usage` },
    { label: 'Sponsoring', href: `${base}/sponsoring` },
  ];

  return (
    <nav aria-label="App sections" className="mb-8 flex gap-5">
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative flex h-10 items-center text-[13px] font-medium text-fg-2',
              'transition-[color] duration-150 ease-out hover:text-fg',
              'after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-transparent',
              active && 'text-fg after:bg-fg',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
