# @pockey/key-provider

The `KeyProvider` port and its implementations. This is the only package that
knows a key vendor exists.

- `src/index.ts`: the interface, and the comment explaining the three authorities
  (parent key, session key, signer key). Changing it is a deliberate act, not a
  refactor.
- `src/turnkey/`: the real implementation, and the only place allowed to import
  `@turnkey/*`, which ESLint enforces. `policy.ts` maps a `SigningPolicy` to a
  Turnkey policy and is pure, with no SDK import, so it can be tested on its own.
- `src/turnkey/emulator/`: an in-memory Turnkey that speaks the real wire format.
  It verifies request stamps, evaluates policies and encrypts OTPs the way the
  enclave does, so the whole suite runs with no account and no signatures spent.
  Its enclave key is accepted only by development builds of the iframe.

`packages/key-provider/src/turnkey/live.test.ts` runs the same flows against a
real Turnkey organization. It is skipped unless `TURNKEY_LIVE=1` and the
`TURNKEY_*` variables are set, because it spends signatures. Run it on purpose.
