import Link from 'next/link';
import { Code } from '@/components/code';
import { Waitlist } from '@/components/waitlist';
import {
  AppWindow,
  ArrowRight,
  ArrowUpRight,
  Check,
  Fuel,
  Globe,
  KeyRound,
  Mail,
  Palette,
  ScanFace,
  Shield,
  Users,
  Wallet,
  type IconComponent,
} from '@/components/icons';
import { site } from '@/lib/site';

const SAMPLE = `import { PockeyProvider, usePockey, useWallet, useSign } from '@pockey/react';

function App() {
  return (
    <PockeyProvider appId="pk_app_...">
      <Profile />
    </PockeyProvider>
  );
}

function Profile() {
  const { authenticated, user, login, logout } = usePockey();
  const { evm } = useWallet();
  const { signMessage } = useSign();

  if (!authenticated) return <button onClick={login}>Log in</button>;
  return (
    <>
      <p>{evm?.address}</p>
      <button onClick={() => signMessage({ message: 'gm' })}>Sign</button>
    </>
  );
}`;

const FEATURES: { icon: IconComponent; title: string; body: string }[] = [
  {
    icon: Mail,
    title: 'Six ways in',
    body: 'Email code, Google, Apple, passkeys, or an EVM or Solana wallet the user already has.',
  },
  {
    icon: Wallet,
    title: 'A wallet on first login',
    body: 'One EVM and one Solana account per user, created the moment they sign in, in their own sub-organization.',
  },
  {
    icon: AppWindow,
    title: 'Signing the user sees',
    body: 'Messages, typed data and transactions go through a confirmation screen in an iframe the host page cannot forge.',
  },
  {
    icon: KeyRound,
    title: 'Sessions with limits',
    body: 'Chains, contracts, amount per transaction, total spend and expiry, enforced by the key provider rather than by your server.',
  },
  {
    icon: Fuel,
    title: 'Gas sponsoring',
    body: 'A Solana fee payer, and ERC-4337 through a bundler, so a new user can transact with an empty wallet.',
  },
  {
    icon: ArrowUpRight,
    title: 'Export, for real',
    body: 'A user can take their private key out at any time, decrypted in their browser. Nothing holds them.',
  },
  {
    icon: Users,
    title: 'A developer dashboard',
    body: 'Apps, keys, users, usage, login methods and appearance, in a dark console you run yourself.',
  },
  {
    icon: Palette,
    title: 'The modal is yours',
    body: 'Theme, accent, corner scale, font stack, per mode colours, your logo and name, overridable per session.',
  },
];

const AUTHORITIES = [
  {
    name: 'The parent key',
    holder: 'Your API',
    can: 'Create one sub-organization per user, and run login ceremonies.',
    cannot: 'Sign, export, or add itself as a user inside someone’s sub-organization.',
  },
  {
    name: 'The session key',
    holder: 'The iframe, in the browser',
    can: 'Everything the user can do. It is non-extractable and it stamps every request.',
    cannot: 'Leave the browser, or be read by the host page or by your server.',
  },
  {
    name: 'The signer key',
    holder: 'Your API',
    can: 'Act only through a policy the user created, within the limits they set.',
    cannot: 'Do anything the user did not allow, or outlive the policy.',
  },
];

const FAQ = [
  {
    q: 'Who holds the keys?',
    a: 'Turnkey does, in a sub-organization whose only root user is your end user. Pockey never holds them, and neither do you. The code that runs on your server cannot sign for a user even if it wanted to, which was verified against the real Turnkey API rather than assumed.',
  },
  {
    q: 'What does it cost?',
    a: 'You pay Turnkey per signature, Cloudflare for a Worker and a database, and your email and RPC providers. There is no line for Pockey, because nobody is reselling you anything.',
  },
  {
    q: 'What do I have to run?',
    a: 'A Cloudflare Worker, a D1 database, an iframe on its own domain, and the dashboard wherever you deploy a Next.js app. Budget an afternoon the first time.',
  },
  {
    q: 'Is it audited?',
    a: 'No. It is complete and every flow was exercised against a production Turnkey organization, but it has had no third party audit and nobody runs it as a service. Read the security model before you put real value behind it.',
  },
];

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
          <p className="mt-6 max-w-[620px] text-[17px] leading-[1.6] text-fg-2">
            Email, Google, Apple, passkeys or an existing wallet. An EVM and a Solana wallet created
            on first login. Signing, sessions and gas sponsoring behind a few React hooks, and a key
            provider that cannot sign for your users behind their back.
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
          <div className="flex flex-col gap-4">
            <div className="rounded-card bg-surface p-6">
              <h2 className="text-[16px] font-semibold">Runs on your machine in one command</h2>
              <p className="mt-2 text-[14px] text-fg-2">
                The default setup talks to an in-memory key provider that speaks the real wire
                format, so the whole suite runs with no account and no signatures spent.
              </p>
              <div className="mt-4">
                <Code code={'pnpm install\npnpm --filter @pockey/api dev'} lang="bash" />
              </div>
            </div>
            <div className="rounded-card bg-surface p-6">
              <h2 className="text-[16px] font-semibold">No service in the middle</h2>
              <p className="mt-2 text-[14px] text-fg-2">
                You bring your own Turnkey organization and pay them directly. Pockey is the code
                between your app and their API, and it is yours to read.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* What is in the box */}
      <section className="mx-auto w-full max-w-[1120px] px-6 py-20">
        <h2 className="text-[32px] font-semibold tracking-[-0.02em]">What is in the box</h2>
        <p className="mt-3 max-w-[560px] text-[16px] text-fg-2">
          Everything a product needs to give someone a wallet without becoming responsible for it.
        </p>
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

      {/* How it works */}
      <section id="how" className="mx-auto w-full max-w-[1120px] scroll-mt-20 px-6 py-20">
        <div className="flex flex-col gap-3">
          <p className="inline-flex w-fit items-center gap-2 rounded-pill bg-surface px-3.5 py-1.5 text-[13px] text-fg-2">
            <Shield size={14} className="text-fg" />
            How it works
          </p>
          <h2 className="text-[32px] font-semibold tracking-[-0.02em]">
            Three credentials, three kinds of power
          </h2>
          <p className="max-w-[640px] text-[16px] text-fg-2">
            A compromised backend is the question every embedded wallet has to answer. Here the
            answer is structural: the key that your server holds is not the key that can sign.
          </p>
        </div>

        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {AUTHORITIES.map((item) => (
            <div key={item.name} className="flex flex-col rounded-card bg-surface p-6">
              <h3 className="text-[16px] font-semibold">{item.name}</h3>
              <p className="mt-1 text-[13px] text-fg-3">{item.holder}</p>
              <div className="mt-5 space-y-3">
                <p className="flex gap-2.5 text-[14px] text-fg-2">
                  <Check size={16} className="mt-0.5 shrink-0 text-fg" />
                  {item.can}
                </p>
                <p className="flex gap-2.5 text-[14px] text-fg-2">
                  <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-fg">
                    <span className="block h-[1.5px] w-3 rounded-pill bg-current" />
                  </span>
                  {item.cannot}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-col gap-4 rounded-card bg-surface p-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-[720px] text-[14px] text-fg-2">
            This was checked, not assumed. Against a production organization, the parent key is
            refused when it tries to sign, export, or add itself as a user inside an end user
            sub-organization.
          </p>
          <Link
            href="/docs/security"
            className="inline-flex w-fit shrink-0 items-center gap-2 rounded-pill bg-surface-2 px-4 py-2.5 text-[14px] text-fg transition-colors hover:bg-surface-3"
          >
            The security model
            <ArrowRight size={15} />
          </Link>
        </div>
      </section>

      {/* Hosting */}
      <section id="hosting" className="mx-auto w-full max-w-[1120px] scroll-mt-20 px-6 py-20">
        <h2 className="text-[32px] font-semibold tracking-[-0.02em]">Two ways to get it</h2>
        <p className="mt-3 max-w-[560px] text-[16px] text-fg-2">
          One of them exists today. The other depends on how many people ask.
        </p>

        <div className="mt-10 grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col rounded-card bg-surface p-8">
            <div className="flex items-center gap-2">
              <Globe size={18} className="text-fg" />
              <h3 className="text-[18px] font-semibold">Host it yourself</h3>
            </div>
            <p className="mt-1 text-[14px] text-fg-3">Available now</p>
            <p className="mt-5 text-[15px] text-fg-2">
              Clone it, bring a Turnkey organization and a Cloudflare account, pick your domains and
              deploy. You own the database, the keys and the bill.
            </p>
            <ul className="mt-6 space-y-2.5">
              {[
                'No seat pricing, no active wallet pricing, no middleman',
                'Your data stays in your account',
                'Fork it, read it, change it, it is MIT',
                'An afternoon the first time',
              ].map((line) => (
                <li key={line} className="flex gap-2.5 text-[14px] text-fg-2">
                  <Check size={16} className="mt-0.5 shrink-0 text-fg" />
                  {line}
                </li>
              ))}
            </ul>
            <Link
              href="/docs/self-hosting"
              className="mt-8 inline-flex w-fit items-center gap-2 rounded-pill bg-white px-5 py-3 text-[15px] font-medium text-black transition-transform duration-150 active:scale-[0.96]"
            >
              Deployment guide
              <ArrowRight size={16} />
            </Link>
          </div>

          <div className="flex flex-col rounded-card bg-surface p-8">
            <div className="flex items-center gap-2">
              <ScanFace size={18} className="text-fg" />
              <h3 className="text-[18px] font-semibold">Let someone else host it</h3>
            </div>
            <p className="mt-1 text-[14px] text-fg-3">Not available</p>
            <p className="mt-5 text-[15px] text-fg-2">
              There is no hosted Pockey. If enough teams want the same thing without running a
              Worker and a database, it is worth building, and this is how that gets counted.
            </p>
            <div className="mt-6">
              <Waitlist />
            </div>
            <p className="mt-auto pt-8 text-[13px] text-fg-3">
              Nothing is promised and nothing is for sale. Self hosting stays free either way.
            </p>
          </div>
        </div>
      </section>

      {/* Honest status */}
      <section className="mx-auto w-full max-w-[1120px] px-6 py-20">
        <div className="rounded-card bg-surface p-8">
          <h2 className="text-[20px] font-semibold">Where it stands</h2>
          <p className="mt-3 max-w-[760px] text-[15px] text-fg-2">
            Complete and verified, not run as a service. Every flow was exercised against Turnkey’s
            production API, the test suite covers the stack end to end, and the repository says
            plainly what it does not guarantee. It has had no third party audit. Read the security
            model before putting real value behind it.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/docs/security"
              className="rounded-pill bg-surface-2 px-4 py-2.5 text-[14px] text-fg transition-colors hover:bg-surface-3"
            >
              Security model
            </Link>
            <Link
              href="/docs/decisions"
              className="rounded-pill bg-surface-2 px-4 py-2.5 text-[14px] text-fg transition-colors hover:bg-surface-3"
            >
              Why it is built this way
            </Link>
          </div>
        </div>
      </section>

      {/* Questions */}
      <section className="mx-auto w-full max-w-[1120px] px-6 py-20">
        <h2 className="text-[32px] font-semibold tracking-[-0.02em]">Questions</h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {FAQ.map((item) => (
            <div key={item.q} className="rounded-card bg-surface p-6">
              <h3 className="text-[16px] font-semibold">{item.q}</h3>
              <p className="mt-2 text-[14px] text-fg-2">{item.a}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
