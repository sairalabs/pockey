Pockey is a self hosted embedded wallet and auth SDK. Keys live at Turnkey, in a
sub-organization per user; nothing here ever holds one. Read SECURITY.md before
touching anything that signs.

Rules:

- TypeScript strict. No `any`. Zod for every external input.
- No private key, seed or share passes through this code. If a task seems to
  require one, stop and ask.
- Every external service sits behind a port in `packages/` (KeyProvider,
  GasSponsor, Mailer, Db). Never import the Turnkey SDK outside
  `packages/key-provider/src/turnkey/`.
- Every API route has a Zod schema in and out, and a Vitest test.
- The published packages (types, core, react, chains-*) depend on no private
  package.
- Conventional commits.
- No em dash anywhere.
- When a decision is not written down, take the simplest and cheapest option and
  record it in docs/decisions.md with the reason.
- Never change the security policies or the KeyProvider interface without saying
  so explicitly.

Tools:

- `pnpm check` (typecheck + lint + test) must pass before any commit.
- `pnpm e2e` drives the whole stack in a real browser.
- The embed at `/?preview=1` shows every screen of the modal at once, in both
  themes and all four corner scales. Use it when changing the modal.
