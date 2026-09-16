import {
  createContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { PocketkeyClient } from './client.js';
import { DEFAULT_EMBED_URL, type PocketkeyConfig } from './config.js';
import type { PocketkeyEmbedError } from './errors.js';
import { createSolanaWallet, registerStandardWallet } from './solana-wallet.js';

export interface PocketkeyProviderProps {
  /** Public app id, `pk_app_...`. */
  appId: string;
  config?: PocketkeyConfig;
  /** Defaults to https://embed.pocketkey.dev. */
  embedUrl?: string;
  children: ReactNode;
  /** Bridge-level failures: embed not loading in time, `init` rejected. */
  onError?: (error: PocketkeyEmbedError) => void;
}

export interface PocketkeyContextValue {
  client: PocketkeyClient;
  config: PocketkeyConfig | undefined;
}

export const PocketkeyContext = createContext<PocketkeyContextValue | null>(null);

export function PocketkeyProvider({
  appId,
  config,
  embedUrl = DEFAULT_EMBED_URL,
  children,
  onError,
}: PocketkeyProviderProps) {
  const [client] = useState(() => new PocketkeyClient(config));

  // Declared before the mount effect so the bridge reads the current config.
  useEffect(() => {
    client.setConfig(config);
  }, [client, config]);

  useEffect(() => {
    client.setOnError(onError);
  }, [client, onError]);

  // One bridge per mount. StrictMode runs mount, cleanup, mount: the first iframe is removed.
  useEffect(() => client.mount({ appId, embedUrl }), [client, appId, embedUrl]);

  const solanaSeen = useSyncExternalStore(
    client.subscribe,
    () => client.getSnapshot().solanaSeen,
    () => false,
  );
  const walletStandard = config?.solana?.walletStandard !== false;

  useEffect(() => {
    if (!walletStandard || !solanaSeen) return;
    const wallet = createSolanaWallet(client);
    const unregister = registerStandardWallet(wallet);
    return () => {
      unregister();
      wallet.dispose();
    };
  }, [client, walletStandard, solanaSeen]);

  const value = useMemo<PocketkeyContextValue>(() => ({ client, config }), [client, config]);

  return <PocketkeyContext.Provider value={value}>{children}</PocketkeyContext.Provider>;
}
