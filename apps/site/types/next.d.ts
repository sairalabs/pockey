/**
 * What `next-env.d.ts` would declare, kept under version control.
 *
 * Next rewrites that file between a dev run and a build, which put churn in
 * every diff, so it is ignored. These two references are the part the code
 * actually needs: without the second one, importing a png has no type and a
 * clean checkout fails to typecheck before anything has generated a thing.
 */

/// <reference types="next" />
/// <reference types="next/image-types/global" />
