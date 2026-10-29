/**
 * Everything the site says about itself in one place, so a fork only has to
 * edit this file.
 *
 * The publisher is here rather than in the environment. French law requires a
 * published site to name it, so these values are on the live page either way,
 * and a company's registered office and number are public record. Keeping them
 * in a variable only bought a site that said "to be set" when a deploy forgot
 * one. A fork replaces this block with its own.
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
  repo: 'https://github.com/sairalabs/pockey',
  contact: process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? 'hello@saira.xyz',
  /* Who publishes it, as opposed to who is liable for the site, which is in
     `legal` and comes from the environment. */
  author: 'Saira Labs',
  authorUrl: 'https://saira.xyz',
} as const;

/** Who answers for this site, as its registration says it. */
export const legal = {
  publisher: 'Saira',
  status: 'A French société par actions simplifiée with a sole shareholder, share capital €1,000',
  address: '173 rue de Courcelles, 75017 Paris, France',
  registration: 'RCS Paris 130 728 926',
  siret: '130 728 926 00010',
  vat: 'FR76130728926',
  director: 'Médhy Chabour, President',
  email: site.contact,
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
