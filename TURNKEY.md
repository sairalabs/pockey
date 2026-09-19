# Turnkey integration (T0.5)

Pocketkey runs on Turnkey, non-custodial (decision of 2026-09-19, see `DECISIONS.md`). This file says how it works, what was verified against the real Turnkey API, and what is left to check by hand.

## How it works

Three credentials, three kinds of power:

| Credential                                                  | Who holds it                    | What it can do                                                                                                                               |
| ----------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Parent API key (`TURNKEY_API_*`)                            | Pocketkey API (Wrangler secret) | Create sub-organizations, run login ceremonies (OTP, OAuth). Nothing inside a user sub-organization.                                         |
| Session key (P-256, non-extractable)                        | The embed iframe, IndexedDB     | Everything the user can do: sign, export, add a passkey, create session policies. Expires with the Pocketkey session (30 days).              |
| Signer key (`TURNKEY_SIGNER_*`, defaults to the parent key) | Pocketkey API                   | Only what a user policy allows (session signers), and deleting those policies. Sole owner of the per-app Solana fee payer sub-organizations. |

Every request touching a user key is stamped in the iframe and relayed by the API, which checks it matches the route (`packages/key-provider/src/turnkey/provider.ts`, `relay`) and cannot change it.

Code map:

- `packages/key-provider/src/index.ts`: the `KeyProvider` port.
- `packages/key-provider/src/turnkey/`: wire format, stamps, HTTP client, provider, policy mapping, HPKE port, the in-memory emulator (`emulator/`), the browser side (`client.ts`, `key-client.ts`, `client-crypto.ts`).
- `apps/embed/src/lib/keys.ts`: IndexedDB key store, production builds pin Turnkey's enclave key.
- `packages/core/src/keys.ts`: the provider-agnostic `KeyClient` the SDK uses.

## Verified live (organization "Saira Labs", 2026-09-19)

`packages/key-provider/src/turnkey/live.test.ts` (run with `TURNKEY_LIVE=1`) and the two spikes behind the decision:

- the parent key cannot sign, export or add a user in a user sub-organization;
- sub-organization and wallet (EVM and Solana accounts) created in one call;
- external wallet sign-up and login (EIP-191 and ed25519 stamps), passkey registration and login addressed to the parent (the provider finds the sub-organization);
- session policies: signer user, revoke permission, `wallet.id` plus `wallet_account.address` binding, `eth.tx.*` and `solana.tx.*` conditions, native expiry (`time`), revocation by the signer, no policy creation by the signer;
- EVM and Solana transaction signing, Solana raw messages, export decrypted against Turnkey's production enclave key;
- about one second of propagation after creating a wallet, user or policy (retried for 5 seconds).

## Left to check by hand

1. **Email OTP end to end with a real inbox**: sign up then log in once with `KEY_PROVIDER=turnkey`. Covers `INIT_OTP_V3`, `VERIFY_OTP_V2`, the sign-up client signature (`signupV2` usage) and `OTP_LOGIN_V2`, whose message formats come from `@turnkey/core` and are exercised only against the emulator so far.
2. **Google sign-in** with real OAuth keys: Turnkey must accept our ID token (nonce = SHA-256 of the session public key) at sub-organization creation and in `OAUTH_LOGIN`.
3. **Apple sign-in**: same, plus the Apple client secret (a signed JWT) in `APPLE_CLIENT_SECRET`.
4. **The OTP email template**: app name and logo come from the app appearance. Sending from our own domain needs a verified domain at Turnkey.

## Questions for Turnkey

1. **Price** per active wallet and per signature. Section 11 assumes 0.02 to 0.03 USD per monthly active wallet; above 0.04 USD the price moves from 0.06 to 0.08 USD.
2. **Limits**: sub-organizations per parent, activities per second, free tier.
3. **Raw payloads under a policy**: can a policy only allow payloads Turnkey hashes itself? Today a session that signs messages (`allowMessages`) can sign any 32-byte digest while it lives, which is why it is capped at 24 hours.
4. **ERC-4337**: can a policy parse user operations? A sponsored EVM send under a session is a raw digest for Turnkey.

## Local development

- `KEY_PROVIDER=mock` (default): the emulator. OTP codes are printed in the API log like before. State is lost when wrangler restarts: wipe the local D1 then (`rm -rf apps/api/.wrangler/state` and re-run the migrations and seed).
- `KEY_PROVIDER=turnkey` with `TURNKEY_ORG_ID`, `TURNKEY_API_PUBLIC_KEY`, `TURNKEY_API_PRIVATE_KEY` in `apps/api/.dev.vars`: real sub-organizations, real OTP emails. Local users created with the emulator do not exist at Turnkey: wipe the local D1 when switching.
