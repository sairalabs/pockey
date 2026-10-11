'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

interface Indicator {
  left: number;
  width: number;
}

/**
 * Section tabs of one app. A single bar slides from the old tab to the new one
 * rather than blinking out of one and into the other, so the eye follows the
 * move. It is measured from the active link, so it survives a label change.
 */
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

  const nav = useRef<HTMLElement>(null);
  const [bar, setBar] = useState<Indicator | null>(null);

  useLayoutEffect(() => {
    const root = nav.current;
    const active = root?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!root || !active) {
      setBar(null);
      return;
    }
    const measure = () => {
      setBar({ left: active.offsetLeft, width: active.offsetWidth });
    };
    measure();
    // Fonts land after first paint and the row rewraps on resize.
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => {
      observer.disconnect();
    };
  }, [pathname]);

  return (
    <nav ref={nav} aria-label="App sections" className="relative mb-8 flex gap-5">
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
              active && 'text-fg',
            )}
          >
            {item.label}
          </Link>
        );
      })}
      {bar ? (
        <span
          aria-hidden="true"
          className="absolute bottom-0 left-0 h-0.5 rounded-full bg-fg transition-[transform,width] duration-250 ease-out motion-reduce:transition-none"
          style={{ width: bar.width, transform: `translateX(${String(bar.left)}px)` }}
        />
      ) : null}
    </nav>
  );
}
