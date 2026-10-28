# Self hosting

What you need: a [Turnkey](https://turnkey.com) organization, a Cloudflare
account, a domain, and a [Resend](https://resend.com) account for the developer
dashboard emails. Login codes for your end users are sent by Turnkey, not by you.

Budget an afternoon.

## 1. Pick the domains first

Three hosts, and one of them is permanent.

| Host                | What it serves          |
| ------------------- | ----------------------- |
| `api.example.com`   | the Worker              |
| `embed.example.com` | the iframe              |
| `app.example.com`   | the developer dashboard |

**The iframe host is the relying party of your users' passkeys.** Change it after
someone has registered one and their passkey stops working, with no recovery
other than another login method. Choose it once.

Serve the iframe from its own host, not a path on your main site: it is a
security boundary, and the browser enforces boundaries per origin.

## 2. Turnkey

Create an organization and an API key for it. That key is the _parent_ key: it
creates sub-organizations and runs login ceremonies, and by design it can do
nothing inside a user's sub-organization.

Generate a second, separate P-256 key pair for the _signer_. It is the credential
that acts through session policies and owns the Solana fee payer accounts. Do not
reuse the parent key for it.

```bash
node -e "const {generateApiKeyPair}=require('./packages/key-provider/dist/turnkey/stamp.js');console.log(generateApiKeyPair())"
```

Keep both halves somewhere you can read them again. Once they are Cloudflare
secrets you cannot.

## 3. Database

```bash
cd apps/api
pnpm exec wrangler d1 create pockey
```

Paste the id it prints into `wrangler.jsonc`, in both places, replacing
`REPLACE_WITH_YOUR_D1_ID`. Then:

```bash
pnpm exec wrangler d1 migrations apply pockey --env production --remote
```

## 4. Secrets

```bash
cd apps/api
for name in BETTER_AUTH_SECRET \
            TURNKEY_ORG_ID TURNKEY_API_PUBLIC_KEY TURNKEY_API_PRIVATE_KEY \
            TURNKEY_SIGNER_PUBLIC_KEY TURNKEY_SIGNER_PRIVATE_KEY \
            RESEND_API_KEY; do
  pnpm exec wrangler secret put "$name" --env production
done
```

`BETTER_AUTH_SECRET` is any 32 random bytes:
`node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`.

Stripe, Pimlico and paid RPC endpoints are only needed if you turn on billing or
gas sponsoring. `ENVIRONMENT=production` does demand the Stripe wiring, because
the code refuses to bill with a guessed price. If you are not billing anyone,
deploy with `ENVIRONMENT=staging`, which asks for real keys and a real mailer but
no payment setup.

## 5. Edit the environment block

In `apps/api/wrangler.jsonc`, set `API_BASE_URL`, `EMBED_ORIGIN` and
`DASHBOARD_ORIGIN` to your three hosts, and uncomment the `routes` entry so the
Worker answers on `api.example.com`. That needs the zone to be on Cloudflare.

## 6. Deploy

```bash
# API
cd apps/api && pnpm exec wrangler deploy --env production

# iframe, on Cloudflare Pages
cd apps/embed && pnpm build
pnpm exec wrangler pages deploy dist --project-name pockey-embed
```

The iframe build refuses the emulator's enclave key, so a production bundle can
only talk to the real Turnkey. Keep it that way.

The dashboard is a plain Next.js app: deploy it wherever you deploy Next, point
its API base at your Worker, and make sure `DASHBOARD_ORIGIN` on the API matches
its origin exactly, since that is what the credentialed admin routes check.

## 7. Check it

```bash
curl https://api.example.com/health
```

You want `{"ok":true,"environment":"production","keyProvider":"turnkey","db":"ok"}`.

Then do it by hand once, which is the only check that proves the whole chain:
sign in to the dashboard, create an app, add your playground origin to its
allowed origins, point the playground at your API, log in as an end user and sign
a message.

## Costs

You pay Turnkey per signature, Cloudflare for Workers and D1, Resend for the
dashboard emails, and your RPC provider if you sponsor gas. There is no Pockey
in that list: nobody is reselling you anything.

Watch the signature count. It is the line that grows with your users.
