# @pockey/site

The public site: the landing page, the documentation and the legal pages.

```bash
pnpm --filter @pockey/site dev     # :3850
```

The documentation is not written here. `src/lib/doc-list.ts` names the markdown
files at the repository root, and the pages read and render them at build time,
so there is one copy of every sentence and GitHub shows the same text.

Adding a page means adding a file to that list. Links between markdown files are
rewritten to site paths by `src/lib/docs.ts`; a link to anything else sends the
reader to the file on GitHub.

The legal identity is read from the environment rather than committed, since
this repository is public. See `.env.example`, and set the variables in the
hosting provider. A value left unset is rendered as "to be set", which is the
visible failure.

## The screenshots

`public/shots` holds real captures, not mockups, and two scripts regenerate
them. Each one photographs the panel alone, on a transparent background, so the
landing page lights and frames them itself.

The modal shots come from the embed's own preview route, which renders every
screen with mock data and no network. The last three are the login screen in
another theme, accent and radius, and the landing page flips between them:

```bash
pnpm --filter @pockey/embed dev
pnpm --filter @pockey/site shots
```

The dashboard shot drives the local stack the way the end to end suite does,
reading the login code from the API log. The API only accepts the dashboard
origin it was given, so both have to be on the same port:

```bash
bash apps/api/scripts/e2e-server.sh
pnpm --filter @pockey/dashboard dev
pnpm --filter @pockey/site shots:dashboard
```

Run them again whenever those screens change, so the landing page never shows a
version of the product that no longer exists.

## Deploying

A plain Next.js app, deployed from the monorepo root with
`apps/site` as the root directory. The build must run from the repository, not
from the app alone, because it reads the markdown two levels up.
