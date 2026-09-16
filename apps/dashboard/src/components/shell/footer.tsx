import { AtSign, Globe, MessageCircle } from 'lucide-react';
import Link from 'next/link';
import { IconButton } from '@/components/ui/icon-button';

const links = [
  { label: 'Home', href: '/apps' },
  { label: 'Docs', href: 'https://docs.pocketkey.dev' },
  { label: 'Terms', href: 'https://pocketkey.dev/terms' },
  { label: 'Privacy', href: 'https://pocketkey.dev/privacy' },
  { label: 'Preferences', href: '/billing' },
  { label: 'Help', href: 'https://pocketkey.dev/help' },
] as const;

export function Footer() {
  return (
    <footer className="mt-auto border-t border-border">
      <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-4 px-6 py-6">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="text-sm font-semibold tracking-tight text-fg">Pocketkey</span>
          <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {links.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="text-[13px] text-fg-2 transition-[color] duration-150 ease-out hover:text-fg"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-1">
          <IconButton aria-label="Website" size="sm">
            <Globe strokeWidth={1.5} />
          </IconButton>
          <IconButton aria-label="Community" size="sm">
            <MessageCircle strokeWidth={1.5} />
          </IconButton>
          <IconButton aria-label="Follow on X" size="sm">
            <AtSign strokeWidth={1.5} />
          </IconButton>
        </div>
      </div>
    </footer>
  );
}
