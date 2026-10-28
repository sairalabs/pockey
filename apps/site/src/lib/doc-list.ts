/**
 * The documentation index, free of any Node import so the navigation can be a
 * client component. The rendering lives in `docs.ts`, which is server only.
 */

export interface DocPage {
  /** Empty for the index, which lives at /docs. */
  slug: string;
  title: string;
  summary: string;
  /** Path from the repository root. */
  file: string;
}

export const DOCS: DocPage[] = [
  {
    slug: '',
    title: 'Overview',
    summary: 'What it is, what is in the box, and how to run it on your machine.',
    file: 'README.md',
  },
  {
    slug: 'security',
    title: 'Security model',
    summary: 'The three authorities, what they guarantee, and what they do not.',
    file: 'SECURITY.md',
  },
  {
    slug: 'self-hosting',
    title: 'Self hosting',
    summary: 'Domains, Turnkey keys, the database, secrets, deploying, checking it.',
    file: 'docs/self-hosting.md',
  },
  {
    slug: 'turnkey',
    title: 'Turnkey integration',
    summary: 'How the key provider works and what was verified against the real API.',
    file: 'TURNKEY.md',
  },
  {
    slug: 'decisions',
    title: 'Decisions',
    summary: 'Why the code is shaped the way it is, before you change something.',
    file: 'docs/decisions.md',
  },
  {
    slug: 'contributing',
    title: 'Contributing',
    summary: 'What to expect if you open an issue or a pull request.',
    file: 'CONTRIBUTING.md',
  },
];

export function findDoc(slug: string): DocPage | undefined {
  return DOCS.find((doc) => doc.slug === slug);
}
