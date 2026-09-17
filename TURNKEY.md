# Turnkey checklist (T0.5)

Everything Pocketkey needs from Turnkey before the mock key provider can be replaced, and every assumption our code makes that has not been run against a real Turnkey account yet.

Related code: `packages/key-provider/src/index.ts` (the port), `packages/key-provider/src/mock/` (what the real adapter must reproduce), `packages/key-provider/src/turnkey/policy.ts` (policy mapping), `DECISIONS.md` (2026-09-17 sections).

## 1. Credentials to obtain

| Secret                    | Where it goes                        | Notes                                                                  |
| ------------------------- | ------------------------------------ | ---------------------------------------------------------------------- |
| `TURNKEY_ORG_ID`          | Wrangler secret, `.dev.vars` locally | Parent organization id                                                 |
| `TURNKEY_API_PUBLIC_KEY`  | same                                 | API key of the Pocketkey backend user                                  |
| `TURNKEY_API_PRIVATE_KEY` | same                                 | P-256 private key, signs every request (never leaves Wrangler secrets) |

Also needed: a sandbox or test organization we can create sub-organizations in without touching production data.

## 2. Questions that change the product

1. **Price per active wallet and per signature.** Section 11 of the spec assumes 0.02 to 0.03 USD per active wallet. Above 0.04 USD we must move from 0.06 to 0.08 USD per monthly active wallet.
2. **Free tier and rate limits.** How many sub-organizations, wallets and signatures per second before we pay or get throttled. This sets how many free users we can absorb.
3. **Sub-organization limits.** One sub-organization per end user is our model (section 4.2). Confirm there is no practical cap and no per sub-organization cost.
4. **Export.** Confirm the export flow returns a bundle encrypted to a client public key (section 8.4) and which curve and format that key must use, so the iframe can decrypt it. Today the embed shows a simulated export.

## 3. Policy language, to verify before trusting sessions

`packages/key-provider/src/turnkey/policy.ts` builds policies from these assumptions, none of which have been executed against Turnkey:

- Activity names: `ACTIVITY_TYPE_SIGN_TRANSACTION_V2`, `ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2`, `ACTIVITY_TYPE_SIGN_RAW_PAYLOADS`.
- Consensus expression: `approvers.any(user, user.id == '<id>')`.
- Fields: `wallet.id`, `activity.type`, `eth.tx.chain_id`, `eth.tx.to`, `eth.tx.value`, `solana.tx.program_keys`, `solana.tx.transfers`.
- Operators: `in`, `all(...)`, `&&`, `||`, `<=`.
- Address casing: we lowercase EVM addresses in conditions. Confirm comparisons are case-insensitive, or that Turnkey normalizes.

Two limits we already know and work around, worth confirming:

- **No expiry in a policy.** We delete the policy on an hourly cron and also refuse expired sessions in the API.
- **No running total.** `maxValueTotal` is enforced only by Pocketkey, with an atomic reservation.

## 4. The open security question

A session that may sign messages needs raw payload signing, and Turnkey cannot tell a message hash from a transaction hash. That is why `allowMessages` is off by default and shown on the consent screen.

Ask Turnkey whether a policy can restrict raw payload signing to payloads Turnkey hashes itself, for example by pinning `hash_function` or the payload encoding. If yes, a session could allow messages without allowing arbitrary hashes, and the warning on the consent screen could be softened.

Same question for ERC-4337: a sponsored EVM transaction is signed as a user operation hash, so no `eth.tx.*` condition applies. Ask whether Turnkey can parse user operations, or whether they recommend a different pattern for smart accounts.

## 5. What the adapter must implement

`packages/key-provider/src/turnkey/` must satisfy the port and match the mock's behavior, which the test suite already pins:

- `createSubOrganization` (one per end user, with the end user as the root user of that sub-organization).
- `createWallet` for secp256k1 (EVM) and ed25519 (Solana).
- `signRaw` with `hash` and `raw` encodings, and the `sessionPolicyId` variant.
- `signTransaction` for EVM (unsigned EIP-1559 serialization) and Solana (base64, keeping other signatures), with the `sessionPolicyId` variant.
- `createPolicy` (bound to a wallet, with an expiry we enforce) and `deletePolicy`.
- `exportWallet` returning a bundle encrypted to the client key.

Plan: keep the mock as the default in development and tests, and switch with `KEY_PROVIDER=turnkey`. The environment validation already refuses `mock` in production.

## 6. Migration of existing data

Local development wallets were created by the mock and have no Turnkey counterpart. Before switching, decide whether to wipe the local D1 (simplest) or keep both providers side by side per wallet, which would mean storing the provider name on the wallet row.

## 7. Follow-ups decided on 2026-09-17

- **One signing path.** Interactive user signatures still go through `signRaw` plus local assembly, while sessions go through `signTransaction`. During T0.5, move everything to `signTransaction` so Turnkey sees and can constrain every transaction, and keep `signRaw` for messages only.
- **Second provider (Para).** Before adding it (section 14 of the spec), confirm it can sign a full transaction under a policy. If it cannot, sessions would be protected by our API alone with that provider, which breaks the promise of section 8.1.
- **Shorter sessions when messages are allowed.** A session with `allowMessages` is closer to a blank cheque, so its maximum duration should be shorter than the 30 days allowed for transaction-only sessions. Planned: 24 hours, enforced in `SigningPolicy` and shown on the consent screen.
