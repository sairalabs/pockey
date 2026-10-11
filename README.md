# Pockey

Embedded wallets + auth for indie devs and side projects. Usage-based from the first dollar.

Read `POCKEY_SPEC.md` for the full spec and roadmap, `DECISIONS.md` for the decision log, and `TURNKEY.md` for the key provider integration.

## Status

Phases 0 to 5 are done (foundations, auth, wallets, web SDK, session signers, gas sponsoring, dashboard, billing and rate limiting), and T0.5: real Turnkey, non-custodial. The embed iframe holds a session key and signs every request touching the user's keys; the API relays them and cannot sign on its own. Tests and default local development use an in-memory Turnkey emulator (`KEY_PROVIDER=mock`). Next: React Native (phase 6).

## Layout

```
apps/
  api/             Hono on Cloudflare Workers: auth, wallets, usage (private)
  embed/           Iframe UI served from embed.pockey.xyz, holds the session (private)
  playground/      Next.js app exercising the SDK + Playwright end to end suite
  dashboard/       Next.js developer dashboard on the admin API (private)
packages/
  types/           @pockey/types     Zod schemas and the iframe protocol (MIT)
  core/            @pockey/core      headless client (MIT)
  react/           @pockey/react     provider, hooks, EIP-1193, Wallet Standard (MIT)
  chains-evm/      @pockey/chains-evm     viem adapter, signer callbacks only (MIT)
  chains-solana/   @pockey/chains-solana  wire codec + SIWS, no web3.js at runtime (MIT)
  db/              Drizzle schema + D1 migrations + seed (private)
  key-provider/    KeyProvider port + mock (private)
  mailer/          Mailer port: memory, console, Resend (private)
  gas-sponsor/     Solana fee payer, ERC-4337 Kernel via Pimlico, pricing (private)
  payments/        Stripe Checkout and webhooks over fetch, mock (private)
  config/          shared tsconfig + eslint
```

## Getting started

```bash
nvm use                                             # Node 24, Wrangler refuses Node 20
pnpm install
cp apps/api/.dev.vars.example apps/api/.dev.vars    # fill BETTER_AUTH_SECRET (and TURNKEY_* for KEY_PROVIDER=turnkey)
pnpm --filter @pockey/api db:migrate:local
pnpm --filter @pockey/api db:seed
pnpm check                                          # typecheck + lint + test everywhere
pnpm e2e                                            # API + embed + playground in Chromium
```

Run the stack by hand:

```bash
pnpm --filter @pockey/api dev          # http://localhost:8787 (OTP codes print in this log)
pnpm --filter @pockey/embed dev        # http://localhost:5174 (design gallery: /?preview=1&appId=pk_app_seed00000000000000000001)
pnpm --filter @pockey/playground dev   # http://localhost:3810
pnpm --filter @pockey/dashboard dev    # http://localhost:3800
```

## Using the SDK

```tsx
import { PockeyProvider, usePockey, useSessionSigners, useSign, useWallet } from '@pockey/react';

<PockeyProvider appId="pk_app_..." config={{ chains: { evm: [8453], solana: ['mainnet-beta'] } }}>
  <App />
</PockeyProvider>;

const { ready, authenticated, user, login, logout } = usePockey();
const { evm, solana } = useWallet();
const { signMessage, sendTransaction } = useSign();
const { sessions, createSession, signWithSession } = useSessionSigners();
```

## API surface

| Area                          | Routes                                                                                                                                                                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public                        | `GET /health`, `GET /v1/apps/:appId/config` (includes the key provider facts the iframe needs)                                                                                                                                               |
| Email OTP                     | `POST /v1/auth/email/start`, `POST /v1/auth/email/verify` (code encrypted to the provider enclave), `POST /v1/auth/email/login` (signed sign-up or login)                                                                                    |
| Passkeys                      | `POST /v1/auth/passkey/register` (signed-in user), `POST /v1/auth/passkey/login`                                                                                                                                                             |
| Wallet login                  | `POST /v1/auth/wallet/lookup`, `POST /v1/auth/wallet/login` (the wallet signs the provider login request)                                                                                                                                    |
| OAuth popup                   | `GET /v1/auth/oauth/:appId/:provider/start?publicKey=`, `/v1/auth/callback/:provider`, `POST /v1/auth/oauth/exchange`                                                                                                                        |
| Session                       | `POST /v1/auth/refresh`, `POST /v1/auth/logout`, `GET /v1/me`                                                                                                                                                                                |
| Wallets                       | `POST /v1/wallets`, `GET /v1/wallets`, `POST /v1/wallets/:id/prepare`, `POST /v1/wallets/:id/{sign-message,sign-typed-data,sign-transaction,send-transaction,export}` (each with the stamped `request`), `GET /v1/wallets/:id/smart-account` |
| Session signers               | `POST /v1/sessions/signer`, `POST /v1/sessions/signer/permission`, `POST /v1/sessions`, `GET /v1/sessions`, `DELETE /v1/sessions/:id`, `POST /v1/sessions/:id/sign`                                                                          |
| Sponsoring                    | `GET /v1/sponsor/solana/fee-payer`, then send with `sponsored: true`                                                                                                                                                                         |
| Server (secret key)           | `GET /v1/server/users`, `POST /v1/server/users/:id/wallets/:wid/sign`, `GET /v1/server/sponsoring/balance`, `POST /v1/server/sponsoring/checkout`                                                                                            |
| Webhooks                      | `POST /webhooks/stripe`                                                                                                                                                                                                                      |
| Dashboard (developer session) | `GET /admin/auth/providers`, `/admin/auth/*`, `GET /admin/session`, CRUD `/admin/apps`, `/admin/apps/:id/{config,api-keys,usage,users,sponsoring}`, `GET /admin/billing`, `GET /admin/billing/portal`                                        |

Every `/v1/*` call sends `X-Pockey-App-Id`. User routes send `Authorization: Bearer <access token>`. Server routes send `Authorization: Bearer pk_sk_...` and never come from a browser. The dashboard calls `/admin/*` through its own origin, which proxies to the API with the developer session cookie.

## Rate limits

Fixed one minute windows. A 429 carries `Retry-After` and `details: { scope, limit, resetAt }`, so a client should wait rather than retry at once.

| Scope                                          | Limit          |
| ---------------------------------------------- | -------------- |
| Per app, all `/v1/*`                           | 600 per minute |
| Per end user                                   | 120 per minute |
| Per app on code send, wallet nonce and sign-in | 30 per minute  |
| Per identity (email or device) on those routes | 5 per minute   |
| Per secret key on `/v1/server/*`               | 300 per minute |
| Sponsored sends per end user                   | 10 per minute  |

`/health`, `/webhooks/*` and `/admin/*` are never limited. Override with the `RATE_LIMITS` variable.

## Rules

See `CLAUDE.md`. Strict TypeScript, Zod at every boundary, no private key ever touches this codebase, every external service sits behind a port in `packages/`.
