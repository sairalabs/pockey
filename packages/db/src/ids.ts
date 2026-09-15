import { init } from '@paralleldrive/cuid2';
import { ID_PREFIXES, type IdPrefix } from '@pocketkey/types';

// Lazy: cuid2's init() draws randomness, which workerd forbids at module scope.
let generator: (() => string) | undefined;
function cuid(): string {
  generator ??= init({ length: 24 });
  return generator();
}

/** `newId('app')` -> `app_tz4a98xxat96iws9zmbrgj3a` */
export function newId<P extends IdPrefix>(prefix: P): `${P}_${string}` {
  return `${prefix}_${cuid()}`;
}

/** Public app id shipped to clients. */
export function newPublicAppId(): `pk_app_${string}` {
  return `pk_app_${cuid()}`;
}

/** Secret API key. Returned once to the developer, only its hash is stored. */
export function newSecretApiKey(): `pk_sk_${string}` {
  return `pk_sk_${cuid()}`;
}

export { ID_PREFIXES };
