# Pocketkey

Embedded wallets + auth for indie devs and side projects. Usage-based from the first dollar.

Read `POCKETKEY_SPEC.md` for the full spec and `DECISIONS.md` for the decision log.

## Layout

```
apps/
  api/          Hono on Cloudflare Workers (private)
  dashboard/    Next.js developer dashboard (private)
packages/
  config/       shared tsconfig + eslint
  types/        @pocketkey/types, Zod schemas shared by SDK and backend (MIT)
  db/           Drizzle schema + D1 migrations (private)
  key-provider/ KeyProvider port + mock implementation (private)
```

## Getting started

```bash
pnpm install
pnpm check          # typecheck + lint + test everywhere
pnpm --filter @pocketkey/api dev        # http://localhost:8787
pnpm --filter @pocketkey/dashboard dev  # http://localhost:3800
```

## Rules

See `CLAUDE.md`. Short version: strict TypeScript, Zod at every boundary, no private key ever touches this codebase, every external service sits behind a port in `packages/`.
