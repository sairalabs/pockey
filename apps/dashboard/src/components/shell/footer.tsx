import { AtSign, Globe, MessageCircle } from '../ui/icons';
import Link from 'next/link';
import { IconButton } from '@/components/ui/icon-button';

/** Only addresses the site actually serves, so none of these dead-ends. */
const links = [
  { label: 'Home', href: '/apps' },
  { label: 'Docs', href: 'https://pockey.xyz/docs' },
  { label: 'Legal', href: 'https://pockey.xyz/legal/notice' },
  { label: 'Privacy', href: 'https://pockey.xyz/legal/privacy' },
  { label: 'Preferences', href: '/billing' },
  { label: 'Source', href: 'https://github.com/medhychabour/pockey' },
] as const;

export function Footer() {
  return (
    <footer className="mt-auto">
      <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-4 px-6 py-6">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="text-sm font-semibold tracking-tight text-fg">Pockey</span>
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
            <Globe />
          </IconButton>
          <IconButton aria-label="Community" size="sm">
            <MessageCircle />
          </IconButton>
          <IconButton aria-label="Follow on X" size="sm">
            <AtSign />
          </IconButton>
        </div>
      </div>
    </footer>
  );
}
