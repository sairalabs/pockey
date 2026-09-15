import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../context.js';

const HEADER = 'X-Request-Id';
const SAFE = /^[A-Za-z0-9._-]{8,128}$/;

/** Accepts a client-supplied id when it is well-formed, otherwise mints one. Echoed on every response. */
export const requestId = createMiddleware<AppEnv>(async (c, next) => {
  const incoming = c.req.header(HEADER);
  const id = incoming && SAFE.test(incoming) ? incoming : crypto.randomUUID();
  c.set('requestId', id);
  await next();
  c.header(HEADER, id);
});
