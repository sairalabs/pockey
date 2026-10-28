import Link from 'next/link';
import { Mark } from './logo';
import { GitHubIcon } from './icons';
import { site } from '@/lib/site';

const columns = [
  {
    title: 'Documentation',
    links: [
      { href: '/docs', label: 'Overview' },
      { href: '/docs/security', label: 'Security model' },
      { href: '/docs/self-hosting', label: 'Self hosting' },
      { href: '/docs/turnkey', label: 'Turnkey integration' },
      { href: '/docs/decisions', label: 'Decisions' },
    ],
  },
  {
    title: 'Project',
    links: [
      { href: site.repo, label: 'Source', external: true },
      { href: `${site.repo}/issues`, label: 'Issues', external: true },
      { href: '/docs/contributing', label: 'Contributing' },
      { href: `${site.repo}/blob/main/LICENSE`, label: 'MIT licence', external: true },
    ],
  },
  {
    title: 'Legal',
    links: [
      { href: '/legal/notice', label: 'Legal notice' },
      { href: '/legal/privacy', label: 'Privacy' },
      { href: `mailto:${site.contact}`, label: 'Contact' },
    ],
  },
];

export function Footer() {
  return (
    <footer className="mt-28 bg-surface">
      <div className="mx-auto w-full max-w-[1120px] px-6 py-16">
        <div className="flex flex-col gap-12 md:flex-row md:justify-between">
          <div className="max-w-[300px]">
            <Mark height={26} className="text-fg" />
            <p className="mt-4 text-[14px] text-fg-2">
              Embedded wallets and auth you host yourself. Open source, MIT.
            </p>
            <a
              href={site.repo}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-5 inline-flex items-center gap-2 rounded-pill bg-surface-2 px-4 py-2 text-[14px] text-fg transition-colors hover:bg-surface-3"
            >
              <GitHubIcon size={15} />
              View the source
            </a>
          </div>

          <div className="grid grid-cols-2 gap-10 sm:grid-cols-3 md:gap-16">
            {columns.map((column) => (
              <div key={column.title}>
                <h2 className="text-[13px] font-semibold text-fg">{column.title}</h2>
                <ul className="mt-4 space-y-2.5">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      {'external' in link && link.external ? (
                        <a
                          href={link.href}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-[14px] text-fg-2 transition-colors hover:text-fg"
                        >
                          {link.label}
                        </a>
                      ) : (
                        <Link
                          href={link.href}
                          className="text-[14px] text-fg-2 transition-colors hover:text-fg"
                        >
                          {link.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <p className="mt-16 text-[13px] text-fg-3">
          Free software under the MIT licence. Not a custodian, and nobody operates it for you.
        </p>
      </div>
    </footer>
  );
}
