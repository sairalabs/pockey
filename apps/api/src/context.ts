import type { AppRow, Db } from '@pocketkey/db';
import type { KeyProvider } from '@pocketkey/key-provider';
import type { Env, ParsedEnv } from './env.js';

/** Variables set by middleware and available as `c.get(...)` / `c.var`. */
export interface Variables {
  requestId: string;
  db: Db;
  config: ParsedEnv;
  keyProvider: KeyProvider;
  /** Set by `requireApp` on every `/v1/*` route. */
  app: AppRow;
}

export interface AppEnv {
  Bindings: Env;
  Variables: Variables;
}
