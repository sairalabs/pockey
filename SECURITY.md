# Security

Read this before you put real value behind Pockey.

**This code has had no third party audit.** It was written carefully, it is
covered by tests, and the paths that touch Turnkey were exercised against their
production API. That is not the same thing as an audit.

## What holds the keys

Nothing in this repository ever sees a private key, a seed or a share. Keys are
generated and held by [Turnkey](https://turnkey.com), inside a sub-organization
created for each of your users.

Three different credentials act on Turnkey, and they are deliberately unequal.

| Credential     | Who holds it                      | What it can do                                                                               |
| -------------- | --------------------------------- | -------------------------------------------------------------------------------------------- |
| Parent API key | your API, as a Worker secret      | create sub-organizations, run login ceremonies. **Nothing** inside a user's sub-organization |
| Session key    | the user's browser, in the iframe | everything the user can do: sign, export, add a passkey, create a session policy             |
| Signer key     | your API, as a Worker secret      | only what a policy the user created allows, plus deleting those policies                     |

The session key is a non-extractable P-256 `CryptoKey` in IndexedDB on the iframe
origin. It cannot be read by script, by your page, or by the API. Every request
that touches a user's keys is signed in that iframe, relayed by the API, and
rejected by Turnkey if the API altered it.

This was verified against Turnkey, not just asserted: the parent key cannot sign,
export, or add a user inside a user's sub-organization.

## What this gives you

- An operator of the API cannot sign for a user, cannot export their key, and
  cannot add a credential to their account.
- A compromised API server can deny service and read metadata, but it cannot move
  a user's funds.
- Session policies are enforced by Turnkey, including their expiry, so a bug in
  your server cannot widen them.
- A user who loses access to your app can still export their key, provided they
  can still log in.

## What it does not give you

- **Turnkey is trusted.** If Turnkey is compromised or unavailable, so are the
  wallets. This is a delegation of custody, not an elimination of it.
- **The iframe origin is trusted.** Whoever can serve code on that origin can act
  as the user. Serve it from a domain you control, with the headers in
  `apps/embed/public/_headers`, and treat that origin as production infrastructure.
- **The host page is trusted for intent, not for authority.** It decides what to
  ask for, the user sees the request and approves it, but a malicious host page
  can ask for a lot and hope the user clicks.
- **No formal verification, no audit, no bug bounty.**

## Known limitations

These are real, documented, and shipped as is.

**ALLOW policies add up.** Turnkey evaluates policies as a union, so if one user
has several active session policies on the same wallet, the widest one is what
Turnkey enforces. The API also checks the session it was given, but that check
lives in the API, which is exactly the place this design otherwise refuses to
trust. If you use sessions, consider allowing only one active session per wallet.

**Wallet sign-up is not proof carrying.** When a user signs up with an existing
EVM or Solana wallet, the API is what declares the session key to Turnkey, unlike
the email flow where the browser signs the list of credentials it is registering.
A compromised API could register its own key at that moment, for that one new
account.

**Raw digests under a session.** A session that may sign messages can sign any
32 byte digest while it lives, because Turnkey cannot see what the digest means.
Sessions that allow messages are capped at 24 hours for that reason. The same
applies to ERC-4337 user operations, which reach Turnkey as a digest.

**A refused sponsored send is charged then refunded.** The ledger shows two lines
and the balance ends up correct, but a reader of the ledger sees both.

## Reporting something

Open a GitHub issue for anything that is not exploitable. For anything that is,
write to hello@saira.xyz rather than opening an issue.

This project is maintained, and reports are read. It is published as source and
not operated as a service, so there is no SLA on a reply, and if you are running
it you are the one who has to act on what you learn.

## If you deploy it

- Give the signer its own Turnkey API key. Do not reuse the parent key.
- Keep `ENVIRONMENT=production` for production: it refuses `KEY_PROVIDER=mock`
  and demands the real mailer and payment wiring.
- Never ship the emulator's enclave key in a production build of the iframe. The
  build refuses it already; do not remove that check.
- Put the iframe on its own origin, not a path of your main site.
- Rotate `BETTER_AUTH_SECRET` and the Turnkey keys if a server is ever exposed.
