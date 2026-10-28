# Decisions

Why the code is shaped the way it is. Read this before changing something that
looks arbitrary, because most of it is not.

## Keys and custody

**Non custodial, not co-owned.** The iframe holds a non-extractable P-256 session
key and stamps every Turnkey request. The API relays the exact bytes and cannot
alter them, because the signature covers them; it checks the organization, the
wallet and the activity type, then counts usage. The alternative, letting the
backend co-own every sub-organization, was faster to build and was rejected: it
means a compromised backend empties every wallet.

This was verified against a real Turnkey organization, not assumed. The parent
key cannot sign, export, or add itself as a user inside a sub-organization whose
only root is the end user: Turnkey answers `organization mismatch`.

**Our own Turnkey client, not their SDK inside the Worker.** The SDK's stamper
picks an implementation from the environment it thinks it is in, and gets it
wrong under workerd with `nodejs_compat`. Ours signs with `@noble/curves` on the
server and with a WebCrypto `CryptoKey` in the iframe, producing the same bytes:
base64url of `{publicKey, scheme: SIGNATURE_SCHEME_TK_API_P256, signature}` over
the SHA-256 of the body.

**Turnkey is eventually consistent.** A freshly created wallet, user or policy is
invisible for roughly 0.1 to 1.2 seconds. The client retries `not_found` and
`permission_denied` for five seconds, but only for a resource it just created.
Re-sending the same stamped body is safe: a refused request executed nothing.

**Email codes come from Turnkey, not from us.** `INIT_OTP_V3` returns a target
key signed by Turnkey's enclave; the iframe verifies that signature against the
pinned production signer before encrypting the code and its own public key to it.
`OTP_LOGIN_V2` then demands a signature from that same key. The backend relays
without ever seeing the code and without being able to bind the token to a key of
its own.

**Residual trust, stated plainly.** When a sub-organization is created, it is the
backend that declares the root credentials. A backend compromised at that exact
moment could insert itself, for that one new account. This is the same assumption
as Turnkey's own recommended flow. See SECURITY.md.

## Sessions

**Policies are enforced by Turnkey, including expiry.** `CREATE_POLICY_V3`
accepts `time: "time.now < Timestamp('<RFC 3339>')"`, and an expired policy
refuses. The hourly cron is therefore a cleanup, not the enforcement.

**A raw hash carries no transaction.** Turnkey evaluates `eth.tx.*` and
`solana.tx.*` conditions only on transaction signing activities, so the
`KeyProvider` port grew `signTransaction`, and a policy is always bound to a
wallet and bounded in time.

**`allowMessages` is off by default, and that is a security decision.** A session
signs transactions only, which the key provider can constrain. Messages, typed
data and sponsored EVM sends (ERC-4337 user operations are signed as raw digests)
require `allowMessages: true`, which the user sees on the consent screen. It is
enforced three times: by the API, by the emulator, and by the Turnkey policy
mapping, which only allows `ACTIVITY_TYPE_SIGN_RAW_PAYLOAD*` when it is set.
Sessions that allow messages are capped at 24 hours, in the `SigningPolicy`
schema itself, so the cap holds in the API, the SDK and the iframe alike.

**Typed data under a session** needs the policy's contract allowlist to contain
`domain.verifyingContract`, otherwise it is refused. A permit or a signed order
can drain a wallet without a transaction.

**`maxValueTotal` is ours alone.** Turnkey policies are stateless and cannot
accumulate, so the API reserves atomically with a compare-and-set on
`spent_total` before signing, and compensates if signing or broadcast fails. A
signed but unbroadcast transaction still counts as spent. Three failed
compare-and-sets return a 409.

**Revocation flips the database flag first**, so the session is refused
immediately, then deletes the provider policy. If that fails the route answers
502 and a second DELETE retries.

## Sponsoring and payments

**EVM**: the user operation is prepared, then signed, then sent through the
Pimlico client with no account attached. Going through the smart account client
would make viem re-prepare the operation with fresh paymaster data and invalidate
the signature. Kernel v3.1, EntryPoint 0.7. Bundler error messages are scrubbed
of `apikey=`.

**Solana fee payer safety rules**: account zero, never referenced by any
instruction (not even as a destination), never a program, never read-only or
duplicated, required signers exactly the fee payer and the user, no lookup
tables, and a capped fee.

**Money is debited before the work and refunded after.** EVM debits the maximum
cost before sending and refunds the difference once the receipt lands, through
`waitUntil` with a 25 second budget. Solana validates, debits, co-signs,
broadcasts, and refunds in full on failure. `creditTopUp` writes the event, the
balance and the ledger in one `db.batch`, so an event is never marked processed
without the credit.

**Prices**: CoinGecko cached 60 seconds, and a failure is never served from
cache. Cents are computed in BigInt and rounded up.

**Stripe**: idempotency keys are hashed so no developer or customer id travels in
a header; checkout and portal keep a random key, since a stable one would replay
an expired URL. `current_period_end` is read at the subscription level then at
its items, because it moved. Billing events with no identifiable customer are
ignored rather than rejected, since other products may live on the same Stripe
account.

## Rate limiting

**Durable Objects with SQLite storage, not KV.** KV is eventually consistent and
a counter loses requests in it. One object per key, fixed window, with an alarm
at the end of the window that empties the storage so an idle key costs nothing.
`new_sqlite_classes` keeps it on the free plan.

**Six scopes**, overridable through the `RATE_LIMITS` variable, where `0`
disables one. The identity is hashed before it becomes an object name, so no
email address ever appears in a key.

**An unreachable counter lets the request through.** Losing a limit for a few
seconds beats losing the API.

Never limited: `/health` and `/webhooks/*` are infrastructure, and `/admin/*` is
one human behind a session cookie.

## Auth

**Two Better Auth instances, one scope each.** End users carry an `app_id`,
developers carry `NULL`, and each instance filters on its own side: a tenant
adapter that ANDs `appId`, and a developer adapter that ANDs `appId IS NULL` and
prefixes verification identifiers. Symmetrical, and deliberately separate.

Since the move to Turnkey, Better Auth serves developers only. End user
identities are resolved through `end_user_identities`.

**Pockey tokens**: a 15 minute HS256 access token, its key derived from
`BETTER_AUTH_SECRET` by HKDF so no extra secret is needed, and an opaque 30 day
refresh token stored as SHA-256. Rotation is a conditional UPDATE, so two
concurrent refreshes cannot both succeed; the loser is treated as reuse and the
whole family is revoked. Every authenticated request checks the family, which
makes logout immediate.

**One `auth_challenges` table** for SIWE and SIWS nonces, OAuth state and
exchange codes, consumed atomically. The nonce is consumed before the signature
is verified, so a nonce buys exactly one attempt.

**The dashboard uses real cookies, not a header bridge.** It proxies `/admin/*`
under its own origin, so there is no third party context. The cookie prefix is
`pockey_dev`, distinct from `pockey`, so an end user OAuth popup can never mask a
developer session on the API origin.

**Wallet identity** is `evm:<lowercased address>` or `solana:<base58>`. The same
person logging in by email and then by wallet is two end users: account linking
is not in this version.

## Frontend

**The iframe protocol is the contract.** Messages are tagged `source: 'pockey'`,
one response per `requestId`, response payloads validated by type on the host
side. Tokens never cross the iframe boundary.

**Host overrides only apply to keys actually present in the message.** Zod would
otherwise fill in a default theme and accent and silently overwrite the server
config. Login methods from the host can only narrow the server's list, and an
empty intersection keeps the server list with a console warning.

**`@solana/web3.js` is not in the runtime.** It pulls borsh, jayson and
rpc-websockets, breaks under the Workers test pool, and would weigh down the
browser bundle. The wire codec is written by hand (legacy, v0, lookup tables) and
RPC goes over fetch.

**`@simplewebauthn/browser` is a dynamic import only**, so the core stays
importable in Workers and Node.

**Refresh is cooperative between tabs.** Before refreshing, the client re-reads
storage: if another tab already rotated, it adopts those tokens rather than
replaying an old refresh, which the API would treat as theft.

**tsup tree shaking is off in `@pockey/react`**: Rollup was removing the
`'use client'` directive the App Router needs. esbuild still drops dead code.

## Colour

The rules live in `packages/types/src/color.ts` and are shared by the iframe and
the dashboard preview, so a developer sees exactly what their users will see.

Text on an accent fill prefers white, and switches to near black only when white
falls under APCA Lc 50. APCA rather than WCAG 2, which underestimates how
readable white is on saturated colours: orange, green and pink stay white.

When the accent disappears into the surface, it is replaced by the theme's text
colour, so primary buttons stay visible: white buttons on a dark theme, black on
a light one.

No monospace anywhere. Addresses, hashes, keys and codes use the site font with
tabular numerals.

## Platform

- Node 24. Wrangler refuses Node 20.
- Vitest 4, because `@cloudflare/vitest-pool-workers` requires it, and one Vitest
  version across the monorepo.
- D1 migrations generated by `drizzle-kit generate` and applied by Wrangler.
  `drizzle-kit push` does not work properly against D1.
- cuid2 generators are initialised lazily: workerd forbids randomness at module
  load, and cuid2's `init()` does exactly that. Tests passed, `wrangler dev`
  crashed at boot.
- Ids are prefixed by type (`dev_`, `app_`, `usr_`, `wlt_`, `ses_`, `key_`,
  `evt_`). The public app id is `pk_app_<cuid2>`, the secret key `pk_sk_<cuid2>`,
  stored as a SHA-256 hash plus its prefix for display.
- CORS on `/v1/*` reflects the calling origin and lets `requireApp` apply the per
  app allowlist, so the browser gets a documented `origin_not_allowed` rather
  than an opaque CORS failure. `/admin/*` allows one exact origin with
  credentials.
- The app row is cached 60 seconds per colo through the Cache API, invalidated on
  config change. Unknown ids are never cached.
- Usage is aggregated hourly and recomputed for the current and previous month,
  so it is idempotent. Gas sums are BigInt, because SQLite would overflow.
- The current month is recomputed on the fly for the dashboard, since
  `usage_monthly` always lags by up to an hour.

## Known consequences

- `user.active` is emitted once per user per month, so the daily active wallet
  curve shows first logins of the month, not daily actives. Changing it means a
  daily event and many more rows.
- The iframe bundle is around 855 KB (260 KB compressed) since the Turnkey crypto
  landed. It should be split so the export crypto and the external wallet code
  load on demand.
- `GET /v1/server/users` loads each user in full, roughly 300 queries for 100
  users.

The security limitations are in [SECURITY.md](../SECURITY.md) rather than here,
because they matter more than the rest.
