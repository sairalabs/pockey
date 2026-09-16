import type { Appearance, LoginMethod, PublicAppConfig } from '@pocketkey/types';
import { isRecord } from './guards';

/**
 * Host login methods may only narrow the server list: intersection, server order.
 * An empty intersection keeps the server list (a host cannot enable a method,
 * and an empty picker would leave the user stuck).
 */
export function narrowLoginMethods(
  server: readonly LoginMethod[],
  host: readonly LoginMethod[] | undefined,
): LoginMethod[] {
  if (!host) return [...server];
  const narrowed = server.filter((method) => host.includes(method));
  if (narrowed.length === 0) {
    console.warn('[pocketkey] none of the host login methods are enabled for this app');
    return [...server];
  }
  return narrowed;
}

/**
 * Keys the host actually sent in `init.appearance`. Zod fills schema defaults
 * (`theme`, `accent`) on parse, so the parsed object alone cannot tell an explicit
 * value from a default. Null when the raw payload is unreadable.
 */
export function sentAppearanceKeys(raw: unknown): Set<string> | null {
  if (!isRecord(raw) || !isRecord(raw.appearance)) return null;
  return new Set(Object.keys(raw.appearance));
}

/** Host appearance overrides server appearance, key by key. */
export type HostAppearance = { [K in keyof Appearance]?: Appearance[K] | undefined };

export function mergeAppearance(
  server: Appearance,
  host: HostAppearance | undefined,
  sentKeys: Set<string> | null,
): Appearance {
  if (!host) return server;
  const merged: Appearance = { ...server };
  const sent = (key: keyof Appearance) => sentKeys === null || sentKeys.has(key);
  if (host.theme !== undefined && sent('theme')) merged.theme = host.theme;
  if (host.accent !== undefined && sent('accent')) merged.accent = host.accent;
  if (host.logo !== undefined && sent('logo')) merged.logo = host.logo;
  if (host.name !== undefined && sent('name')) merged.name = host.name;
  return merged;
}

export function effectiveConfig(
  server: PublicAppConfig,
  init: { loginMethods?: LoginMethod[] | undefined; appearance?: HostAppearance | undefined },
  raw: unknown,
): PublicAppConfig {
  return {
    ...server,
    loginMethods: narrowLoginMethods(server.loginMethods, init.loginMethods),
    appearance: mergeAppearance(server.appearance, init.appearance, sentAppearanceKeys(raw)),
  };
}

export function appDisplayName(config: PublicAppConfig): string {
  return config.appearance.name ?? config.name;
}
