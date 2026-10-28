import Link from 'next/link';
import { Lockup } from './logo';
import { GitHubIcon } from './icons';
import { nav, site } from '@/lib/site';

export function Nav() {
  return (
    <header className="sticky top-0 z-50 bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-[1120px] items-center gap-8 px-6">
        <Link href="/" aria-label="Pockey, home" className="shrink-0 text-fg">
          <Lockup height={17} />
        </Link>

        <nav className="hidden items-center gap-6 sm:flex">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-[14px] text-fg-2 transition-colors hover:text-fg"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/docs/self-hosting"
            className="hidden rounded-pill px-4 py-2 text-[14px] text-fg-2 transition-colors hover:bg-surface hover:text-fg md:block"
          >
            Self host it
          </Link>
          <a
            href={site.repo}
            target="_blank"
            rel="noreferrer noopener"
            className="flex items-center gap-2 rounded-pill bg-white px-4 py-2 text-[14px] font-medium text-black transition-transform duration-150 active:scale-[0.96]"
          >
            <GitHubIcon className="size-[15px]" />
            GitHub
          </a>
        </div>
      </div>
    </header>
  );
}
