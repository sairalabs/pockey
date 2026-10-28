import Image from 'next/image';
import Link from 'next/link';
import { Code } from '@/components/code';
import { Faq } from '@/components/faq';
import {
  AppWindow,
  ArrowRight,
  ArrowUpRight,
  Fuel,
  KeyRound,
  Mail,
  Palette,
  Shield,
  Users,
  Wallet,
  type IconComponent,
} from '@/components/icons';
import { site } from '@/lib/site';

const SAMPLE = `import { PockeyProvider, usePockey, useWallet } from '@pockey/react';

function App() {
  return (
    <PockeyProvider appId="pk_app_...">
      <Profile />
    </PockeyProvider>
  );
}

function Profile() {
  const { authenticated, login } = usePockey();
  const { evm } = useWallet();

  if (!authenticated) return <button onClick={login}>Log in</button>;
  return <p>{evm?.address}</p>;
}`;

const FEATURES: { icon: IconComponent; title: string; body: string }[] = [
  {
    icon: Mail,
    title: 'Six ways in',
    body: 'Email code, Google, Apple, passkeys, or an existing wallet.',
  },
  {
    icon: Wallet,
    title: 'A wallet on first login',
    body: 'One EVM and one Solana account per user, from day one.',
  },
  {
    icon: AppWindow,
    title: 'Signing the user sees',
    body: 'A confirmation screen the host page cannot forge.',
  },
  {
    icon: KeyRound,
    title: 'Sessions with limits',
    body: 'Chains, contracts, amounts and expiry, enforced outside your server.',
  },
  {
    icon: Fuel,
    title: 'Gas sponsoring',
    body: 'A Solana fee payer and ERC-4337, for empty wallets.',
  },
  {
    icon: ArrowUpRight,
    title: 'Export, for real',
    body: 'Users can take their private key out, in their browser.',
  },
  {
    icon: Users,
    title: 'A developer dashboard',
    body: 'Apps, keys, users and usage, in a console you run.',
  },
  {
    icon: Palette,
    title: 'The modal is yours',
    body: 'Theme, accent, corners, font and logo, down to the session.',
  },
];

const SHOTS = [
  { src: '/shots/login.png', caption: 'Log in or sign up' },
  { src: '/shots/email-code.png', caption: 'The email code' },
  { src: '/shots/sign-message.png', caption: 'Signing a message' },
  { src: '/shots/transaction.png', caption: 'Confirming a transaction' },
];

const AUTHORITIES = [
  {
    name: 'The parent key',
    holder: 'Your API',
    body: 'Creates one sub-organization per user and runs logins. It cannot sign or export inside one.',
  },
  {
    name: 'The session key',
    holder: 'The browser',
    body: 'Stamps every request the user makes. It cannot leave the browser or be read by your server.',
  },
  {
    name: 'The signer key',
    holder: 'Your API',
    body: 'Acts inside a policy the user created, and never outlives it.',
  },
];

const FAQ = [
  {
    q: 'Who holds the keys?',
    a: 'Turnkey, in a sub-organization whose only root user is your end user. Your server cannot sign for them, and that was tested against the real API.',
  },
  {
    q: 'What does it cost?',
    a: 'Turnkey per signature, Cloudflare for a Worker and a database, your email and RPC providers. Nothing for Pockey.',
  },
  {
    q: 'What do I have to run?',
    a: 'A Worker, a D1 database, an iframe on its own domain, and the dashboard. An afternoon the first time.',
  },
  {
    q: 'Is it audited?',
    a: 'No. Every flow was exercised against Turnkey’s production API and the test suite covers the stack end to end, but no third party has audited it. Read the security model before you put real value behind it.',
  },
] as const;

export default function Home() {
  return (
    <>
      {/* Hero */}
      <section className="mx-auto w-full max-w-[1120px] px-6 pb-20 pt-16 sm:pt-24">
        <div className="stagger max-w-[760px]">
          <p className="inline-flex items-center gap-2 rounded-pill bg-surface px-3.5 py-1.5 text-[13px] text-fg-2">
            <span className="size-1.5 rounded-pill bg-accent" />
            Open source, MIT, self hosted
          </p>
          <h1 className="mt-6 text-[44px] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-[62px]">
            Embedded wallets your users own, on your own infrastructure.
          </h1>
          <p className="mt-6 max-w-[560px] text-[17px] leading-[1.6] text-fg-2">
            Login, wallets, signing and gas sponsoring behind a few React hooks. Your server never
            holds a key that can sign.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/docs"
              className="inline-flex items-center gap-2 rounded-pill bg-white px-5 py-3 text-[15px] font-medium text-black transition-transform duration-150 active:scale-[0.96]"
            >
              Read the docs
              <ArrowRight size={16} />
            </Link>
            <a
              href={site.repo}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-2 rounded-pill bg-surface px-5 py-3 text-[15px] text-fg transition-colors hover:bg-surface-2"
            >
              Clone the repository
            </a>
          </div>
        </div>

        <div className="mt-14 grid gap-4 lg:grid-cols-[1.25fr_1fr]">
          <Code code={SAMPLE} lang="tsx" label="app.tsx" />
          <div className="rounded-card bg-surface p-6">
            <h2 className="text-[16px] font-semibold">Runs locally in one command</h2>
            <p className="mt-2 text-[14px] text-fg-2">
              The default setup talks to an in-memory key provider, so the whole suite runs with no
              account and no signatures spent.
            </p>
            <div className="mt-4">
              <Code code={'pnpm install\npnpm --filter @pockey/api dev'} lang="bash" />
            </div>
          </div>
        </div>
      </section>

      {/* What is in the box */}
      <section className="mx-auto w-full max-w-[1120px] px-6 py-20">
        <h2 className="text-[32px] font-semibold tracking-[-0.02em]">What is in the box</h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="rounded-card bg-surface p-6">
              <feature.icon size={20} className="text-fg" />
              <h3 className="mt-4 text-[15px] font-semibold">{feature.title}</h3>
              <p className="mt-2 text-[14px] text-fg-2">{feature.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* The modal */}
      <section className="mx-auto w-full max-w-[1120px] px-6 py-20">
        <h2 className="text-[32px] font-semibold tracking-[-0.02em]">What the user sees</h2>
        <p className="mt-3 max-w-[560px] text-[16px] text-fg-2">
          The real screens, in your colours, on a domain you own.
        </p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SHOTS.map((shot) => (
            <figure key={shot.src}>
              <Image
                src={shot.src}
                alt={shot.caption}
                width={896}
                height={1362}
                sizes="(min-width: 1024px) 260px, (min-width: 640px) 45vw, 90vw"
                className="w-full rounded-card bg-surface"
              />
              <figcaption className="mt-3 text-[13px] text-fg-3">{shot.caption}</figcaption>
            </figure>
          ))}
        </div>

        <figure className="mt-10">
          <Image
            src="/shots/dashboard.png"
            alt="The developer dashboard, with the login methods of an app"
            width={2720}
            height={1700}
            sizes="(min-width: 1120px) 1120px, 100vw"
            className="w-full rounded-card bg-surface"
          />
          <figcaption className="mt-3 text-[13px] text-fg-3">
            The dashboard, where you choose what the modal offers
          </figcaption>
        </figure>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto w-full max-w-[1120px] scroll-mt-20 px-6 py-20">
        <p className="inline-flex w-fit items-center gap-2 rounded-pill bg-surface px-3.5 py-1.5 text-[13px] text-fg-2">
          <Shield size={14} className="text-fg" />
          How it works
        </p>
        <h2 className="mt-3 text-[32px] font-semibold tracking-[-0.02em]">
          Three credentials, three kinds of power
        </h2>
        <p className="mt-3 max-w-[560px] text-[16px] text-fg-2">
          The key your server holds is not the key that can sign. Checked against a production
          organization, where it is refused.
        </p>

        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {AUTHORITIES.map((item) => (
            <div key={item.name} className="rounded-card bg-surface p-6">
              <h3 className="text-[16px] font-semibold">{item.name}</h3>
              <p className="mt-1 text-[13px] text-fg-3">{item.holder}</p>
              <p className="mt-4 text-[14px] leading-[1.6] text-fg-2">{item.body}</p>
            </div>
          ))}
        </div>

        <Link
          href="/docs/security"
          className="mt-6 inline-flex items-center gap-2 text-[15px] text-fg transition-opacity hover:opacity-70"
        >
          The security model
          <ArrowRight size={15} />
        </Link>
      </section>

      {/* Self hosting */}
      <section id="self-hosting" className="mx-auto w-full max-w-[1120px] scroll-mt-20 px-6 py-20">
        <h2 className="text-[32px] font-semibold tracking-[-0.02em]">Host it yourself</h2>
        <p className="mt-3 max-w-[600px] text-[16px] leading-[1.6] text-fg-2">
          Bring a Turnkey organization and a Cloudflare account, then deploy. You own the database,
          the keys and the bill, with no seat pricing and nobody in the middle. An afternoon the
          first time.
        </p>
        <Link
          href="/docs/self-hosting"
          className="mt-8 inline-flex w-fit items-center gap-2 rounded-pill bg-white px-5 py-3 text-[15px] font-medium text-black transition-transform duration-150 active:scale-[0.96]"
        >
          Deployment guide
          <ArrowRight size={16} />
        </Link>
      </section>

      {/* Questions */}
      <section className="mx-auto w-full max-w-[760px] px-6 py-20">
        <h2 className="text-[32px] font-semibold tracking-[-0.02em]">Questions</h2>
        <Faq items={FAQ} />
      </section>
    </>
  );
}
