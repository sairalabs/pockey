# Pockey

Embedded wallets and auth you host yourself. Email, Google, Apple, passkeys or an
existing wallet; an EVM and a Solana wallet created on first login; signing,
sessions and gas sponsoring behind a few React hooks.

Keys live at [Turnkey](https://turnkey.com), in a sub-organization per user.
Pockey never holds them, and neither do you: the part that runs on your server
cannot sign for a user even if it wanted to. See [SECURITY.md](SECURITY.md).

> **Status: complete and verified, not run as a service.** Every flow below was
> exercised against Turnkey's production API. Nobody operates this for you: you
> bring your own Turnkey organization and run the API yourself. It has had no
> third party audit. Read [SECURITY.md](SECURITY.md) before putting real value
> behind it.

```tsx
import { PockeyProvider, usePockey, useWallet, useSign } from '@pockey/react';

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
      <button onClick={logout}>Log out</button>
    </>
  );
}
```

## What is in the box

- **Login**: email code, Google, Apple, passkeys, or an existing EVM or Solana wallet
- **Wallets**: one EVM and one Solana account per user, created on first login
- **Signing**: messages, typed data, transactions, behind a confirmation screen
  the user sees and the host page cannot forge
- **Sessions**: let an app sign within limits the user set (chains, contracts,
  amount per transaction, expiry), enforced by Turnkey rather than by your server
- **Gas sponsoring**: Solana fee payer, ERC-4337 through Pimlico
- **Export**: the user can take their private key out, decrypted in their browser
- **A developer dashboard**: apps, keys, users, usage, login methods, appearance
- **A Turnkey emulator**: an in-memory Turnkey that speaks the real wire format,
  so the whole suite runs with no account and no signatures spent

## Why you might want it

You want embedded wallets, you do not want to be a custodian, and you would
rather pay Turnkey directly than pay someone else to pay Turnkey for you.
Hosting it is a Cloudflare Worker, a D1 database and a Turnkey account.

## Layout

```
apps/
  api/             Hono on Cloudflare Workers: auth, wallets, sessions, usage
  embed/           The iframe that holds the session key and signs
  dashboard/       Next.js developer dashboard
  playground/      Next.js demo app and the Playwright suite
packages/
  types/           @pockey/types          Zod schemas and the iframe protocol
  core/            @pockey/core           headless client
  react/           @pockey/react          provider, hooks, EIP-1193, Wallet Standard
  chains-evm/      @pockey/chains-evm     viem adapter, signer callbacks only
  chains-solana/   @pockey/chains-solana  wire codec and SIWS, no web3.js at runtime
  key-provider/    the Turnkey integration and the emulator
  db/ mailer/ gas-sponsor/ payments/ config/
```

## Running it locally

Nothing external is required. The default setup runs against the in-memory
Turnkey emulator, and login codes are printed in the API log.

```bash
nvm use                                             # Node 24, Wrangler refuses 20
pnpm install
cp apps/api/.dev.vars.example apps/api/.dev.vars    # set BETTER_AUTH_SECRET
pnpm --filter @pockey/api db:migrate:local
pnpm --filter @pockey/api db:seed
```

Then run the pieces you need:

```bash
pnpm --filter @pockey/api dev          # :8787, login codes print here
pnpm --filter @pockey/embed dev        # :5174
pnpm --filter @pockey/playground dev   # :3810
pnpm --filter @pockey/dashboard dev    # :3800
```

Open the playground and log in with any address.

`pnpm check` runs typecheck, lint and tests everywhere. `pnpm e2e` drives the
whole stack in a real browser.

To see every screen of the modal at once, in both themes and all four corner
scales, open the embed at `/?preview=1`.

## Running it for real

You need a Turnkey organization, a Cloudflare account and a domain.
[docs/self-hosting.md](docs/self-hosting.md) walks through it.

The one choice you cannot take back is the domain the iframe is served from: it
is the relying party of your users' passkeys, so changing it later invalidates
every passkey they registered.

## Customising the modal

Appearance travels with the app config and can be overridden per session from the
host page. Theme, accent, corner scale (`sharp`, `soft`, `round`, `pill`), font
stack, per mode colours (surfaces, text, danger, overlay), overlay opacity, your
logo and name, plus two white label switches. Anything you leave out keeps the
Pockey value for that mode.

## API surface

| Area                | Routes                                                                                                                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public              | `GET /health`, `GET /v1/apps/:appId/config`                                                                                                                                                                |
| Email code          | `POST /v1/auth/email/{start,verify,login}`                                                                                                                                                                 |
| Passkeys            | `POST /v1/auth/passkey/{register,login}`                                                                                                                                                                   |
| Wallet login        | `POST /v1/auth/wallet/{lookup,login}`                                                                                                                                                                      |
| OAuth popup         | `GET /v1/auth/oauth/:appId/:provider/start`, `/v1/auth/callback/:provider`, `POST /v1/auth/oauth/exchange`                                                                                                 |
| Session             | `POST /v1/auth/refresh`, `POST /v1/auth/logout`, `GET /v1/me`                                                                                                                                              |
| Wallets             | `POST /v1/wallets`, `GET /v1/wallets`, `POST /v1/wallets/:id/prepare`, `POST /v1/wallets/:id/{sign-message,sign-typed-data,sign-transaction,send-transaction,export}`, `GET /v1/wallets/:id/smart-account` |
| Session signers     | `POST /v1/sessions/signer`, `POST /v1/sessions/signer/permission`, `POST /v1/sessions`, `GET /v1/sessions`, `DELETE /v1/sessions/:id`, `POST /v1/sessions/:id/sign`                                        |
| Sponsoring          | `GET /v1/sponsor/solana/fee-payer`, then send with `sponsored: true`                                                                                                                                       |
| Server (secret key) | `GET /v1/server/users`, `POST /v1/server/users/:id/wallets/:wid/sign`, `GET /v1/server/sponsoring/balance`, `POST /v1/server/sponsoring/checkout`                                                          |
| Webhooks            | `POST /webhooks/stripe`                                                                                                                                                                                    |
| Dashboard           | `/admin/*`, developer session cookie through a same origin proxy                                                                                                                                           |

Every `/v1/*` call sends `X-Pockey-App-Id`. User routes send a bearer access
token. Server routes send `Authorization: Bearer pk_sk_...` and never come from a
browser.

## Rate limits

Fixed one minute windows. A 429 carries `Retry-After` and
`details: { scope, limit, resetAt }`, so a client should wait rather than retry
at once.

| Scope                                          | Limit          |
| ---------------------------------------------- | -------------- |
| Per app, all `/v1/*`                           | 600 per minute |
| Per end user                                   | 120 per minute |
| Per app on code send, wallet nonce and sign-in | 30 per minute  |
| Per identity (email or device) on those routes | 5 per minute   |
| Per secret key on `/v1/server/*`               | 300 per minute |
| Sponsored sends per end user                   | 10 per minute  |

`/health`, `/webhooks/*` and `/admin/*` are never limited. Override with the
`RATE_LIMITS` variable.

## Documentation

- [SECURITY.md](SECURITY.md): the three authority model, what it guarantees, what
  it does not, and the limitations worth knowing
- [docs/self-hosting.md](docs/self-hosting.md): deploying it
- [TURNKEY.md](TURNKEY.md): the Turnkey integration and what was verified live
- [docs/decisions.md](docs/decisions.md): why the code is shaped the way it is
- [CONTRIBUTING.md](CONTRIBUTING.md): what to expect if you open an issue

## Licence

MIT. See [LICENSE](LICENSE).
