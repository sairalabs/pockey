# @pocketkey/key-provider

The `KeyProvider` port (section 7.3 of the spec) and its implementations.

- `src/index.ts`: the interface. Changing it requires an explicit flag in the PR.
- `src/mock/`: in-memory implementation with real secp256k1 and ed25519 signatures, for tests and `KEY_PROVIDER=mock` local dev. Holds keys in process memory by design, never deployable.
- `src/turnkey/`: the production implementation (T0.5). The only place allowed to import `@turnkey/*`, enforced by ESLint.
