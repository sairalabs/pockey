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

## Deploying

A plain Next.js app, deployed from the monorepo root with
`apps/site` as the root directory. The build must run from the repository, not
from the app alone, because it reads the markdown two levels up.
