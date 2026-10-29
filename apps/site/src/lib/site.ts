/**
 * Everything the site says about itself in one place, so a fork only has to
 * edit this file and its environment.
 *
 * The legal identity is read from the environment on purpose: this repository
 * is public, and a publisher's address does not belong in it. Set the variables
 * in the hosting provider, see `.env.example`.
 */

export const site = {
  name: 'Pockey',
  tagline: 'Embedded wallets and auth you host yourself.',
  /* Under 160 characters: past that a search result cuts it mid-sentence. */
  description:
    'Open source embedded wallets and auth you host yourself. Email, social or passkey login, an EVM and a Solana wallet per user, behind a few React hooks.',
  /* The long form, for the places that have room for it. */
  summary:
    'Open source embedded wallets and auth. Email, Google, Apple, passkeys or an existing wallet, an EVM and a Solana wallet per user, signing and sessions behind a few React hooks. Keys live at Turnkey, and no server of yours can sign for a user.',
  url: process.env.NEXT_PUBLIC_SITE_URL ?? 'https://pockey.xyz',
  repo: 'https://github.com/medhychabour/pockey',
  contact: process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? 'hello@saira.xyz',
  /* Who publishes it, as opposed to who is liable for the site, which is in
     `legal` and comes from the environment. */
  author: 'Saira Labs',
  authorUrl: 'https://saira.xyz',
} as const;

/** Set these in the hosting provider. Missing values are shown as missing. */
export const legal = {
  publisher: process.env.NEXT_PUBLIC_LEGAL_PUBLISHER ?? '',
  status: process.env.NEXT_PUBLIC_LEGAL_STATUS ?? '',
  address: process.env.NEXT_PUBLIC_LEGAL_ADDRESS ?? '',
  registration: process.env.NEXT_PUBLIC_LEGAL_REGISTRATION ?? '',
  director: process.env.NEXT_PUBLIC_LEGAL_DIRECTOR ?? '',
  email: process.env.NEXT_PUBLIC_LEGAL_EMAIL ?? site.contact,
} as const;

export const host = {
  name: 'Vercel Inc.',
  address: '440 N Barranca Ave #4133, Covina, CA 91723, United States',
  url: 'https://vercel.com',
} as const;

export const nav = [
  { href: '/#how', label: 'How it works' },
  { href: '/#self-hosting', label: 'Self hosting' },
  { href: '/docs', label: 'Docs' },
] as const;
