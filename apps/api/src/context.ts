import type { AppRow, Db, DeveloperRow } from '@pocketkey/db';
import type { KeyProvider } from '@pocketkey/key-provider';
import type { Mailer } from '@pocketkey/mailer';
import type { Env, ParsedEnv } from './env.js';

/** Variables set by middleware and available as `c.get(...)` / `c.var`. */
export interface Variables {
  requestId: string;
  db: Db;
  config: ParsedEnv;
  keyProvider: KeyProvider;
  mailer: Mailer;
  /** Set by `requireApp` on every `/v1/*` route. */
  app: AppRow;
  /** Set by `requireUser`. */
  endUserId: string;
  sessionFamilyId: string;
  /** Set by `requireApiKey` on `/v1/server/*`. */
  apiKeyId: string;
  /** Set by `requireDeveloper` on every `/admin/*` route except `/admin/auth/*`. */
  developer: DeveloperRow;
}

export interface AppEnv {
  Bindings: Env;
  Variables: Variables;
}
