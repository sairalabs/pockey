# Contributing

Read this first, it will save you time.

**This project is published, not maintained.** It is complete and it works, but
nobody is on duty. Issues and pull requests are welcome and will be read when
there is time, which may be a while. If you need something on a schedule, fork
it: that is what the licence is for.

## If you open an issue

Say what you ran, what you expected and what happened. For anything that looks
exploitable, follow [SECURITY.md](SECURITY.md) instead of opening an issue.

## If you open a pull request

- `pnpm check` must pass: typecheck, lint and tests, everywhere.
- `pnpm format:check` must pass. Prettier settles formatting, do not argue with it.
- Add a test for behaviour you change. The suite is the reason this code can be
  trusted at all.
- One pull request, one subject.

## House rules the code follows

- TypeScript strict. No `any`. Zod at every external boundary.
- No private key, seed or share ever passes through this code. If a change seems
  to need one, it is the wrong change.
- Every external service sits behind a port in `packages/`. The Turnkey SDK is
  imported in `packages/key-provider/src/turnkey/` and nowhere else.
- Every API route has a Zod schema in and out, and a test.
- The published packages (`types`, `core`, `react`, `chains-*`) depend on no
  private package.
- Conventional commits.

## Running the tests

```bash
pnpm install
pnpm check     # typecheck + lint + test
pnpm e2e       # the whole stack in a real browser
```

Tests run against the in-memory Turnkey emulator, so they need no account and
spend no signatures. The emulator speaks the real wire format, verifies request
stamps, evaluates policies and encrypts codes the way the enclave does, which is
why a green suite means something.

To run the contract test against a real Turnkey organization, which does spend
signatures, set `TURNKEY_LIVE=1` and the `TURNKEY_*` variables, then run the
`live` test in `packages/key-provider`. Do that on purpose, never in CI.
