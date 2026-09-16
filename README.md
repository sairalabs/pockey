# Pocketkey

Embedded wallets + auth for indie devs and side projects. Usage-based from the first dollar.

Read `POCKETKEY_SPEC.md` for the full spec and `DECISIONS.md` for the decision log.

## Layout

```
apps/
  api/             Hono on Cloudflare Workers: auth, wallets, usage (private)
  dashboard/       Next.js developer dashboard, mocked data for now (private)
packages/
  config/          shared tsconfig + eslint
  types/           @pocketkey/types, Zod schemas shared by SDK and backend (MIT)
  chains-evm/      @pocketkey/chains-evm, viem adapter, signer callbacks only (MIT)
  chains-solana/   @pocketkey/chains-solana, wire codec + SIWS, no web3.js at runtime (MIT)
  db/              Drizzle schema + D1 migrations + seed (private)
  key-provider/    KeyProvider port + mock (Turnkey simulated until sandbox keys) (private)
  mailer/          Mailer port: memory, console, Resend (private)
```

## Getting started

```bash
nvm use                                        # Node 24, Wrangler refuses Node 20
pnpm install
cp apps/api/.dev.vars.example apps/api/.dev.vars   # then fill BETTER_AUTH_SECRET and MOCK_KEY_SEED
pnpm --filter @pocketkey/api db:migrate:local
pnpm --filter @pocketkey/api db:seed
pnpm check                                     # typecheck + lint + test everywhere
pnpm --filter @pocketkey/api smoke             # boots wrangler dev and walks login -> wallet -> signature
pnpm --filter @pocketkey/api dev               # http://localhost:8787
pnpm --filter @pocketkey/dashboard dev         # http://localhost:3800
```

With `MAILER=console`, OTP codes are printed in the wrangler log.

## API surface today

| Area         | Routes                                                                                                                                                      |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public       | `GET /health`, `GET /v1/apps/:appId/config`                                                                                                                 |
| Email OTP    | `POST /v1/auth/email-otp/send-verification-otp`, `POST /v1/auth/sign-in/email-otp`                                                                          |
| Passkeys     | `GET /v1/auth/passkey/generate-register-options`, `POST .../verify-registration`, `GET .../generate-authenticate-options`, `POST .../verify-authentication` |
| Wallet login | `POST /v1/auth/wallet/nonce`, `POST /v1/auth/wallet/verify` (SIWE, SIWS)                                                                                    |
| OAuth popup  | `GET /v1/auth/oauth/:appId/:provider/start`, `/v1/auth/callback/:provider`, `GET /v1/auth/oauth/:appId/complete`, `POST /v1/auth/oauth/exchange`            |
| Session      | `POST /v1/auth/session/exchange`, `POST /v1/auth/refresh`, `POST /v1/auth/logout`, `GET /v1/me`                                                             |
| Wallets      | `POST /v1/wallets`, `GET /v1/wallets`, `POST /v1/wallets/:id/{sign-message,sign-typed-data,sign-transaction,send-transaction,export}`                       |

Every `/v1/*` call sends `X-Pocketkey-App-Id`. User routes send `Authorization: Bearer <access token>`.

## Rules

See `CLAUDE.md`. Short version: strict TypeScript, Zod at every boundary, no private key ever touches this codebase, every external service sits behind a port in `packages/`.
