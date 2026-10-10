import {
  createContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { PockeyClient } from './client.js';
import { DEFAULT_EMBED_URL, type PockeyConfig } from './config.js';
import type { PockeyEmbedError } from './errors.js';
import { createSolanaWallet, registerStandardWallet } from './solana-wallet.js';

export interface PockeyProviderProps {
  /** Public app id, `pk_app_...`. */
  appId: string;
  config?: PockeyConfig;
  /** Defaults to https://embed.pockey.xyz. */
  embedUrl?: string;
  children: ReactNode;
  /** Bridge-level failures: embed not loading in time, `init` rejected. */
  onError?: (error: PockeyEmbedError) => void;
}

export interface PockeyContextValue {
  client: PockeyClient;
  config: PockeyConfig | undefined;
}

export const PockeyContext = createContext<PockeyContextValue | null>(null);

export function PockeyProvider({
  appId,
  config,
  embedUrl = DEFAULT_EMBED_URL,
  children,
  onError,
}: PockeyProviderProps) {
  const [client] = useState(() => new PockeyClient(config));

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

  const value = useMemo<PockeyContextValue>(() => ({ client, config }), [client, config]);

  return <PockeyContext.Provider value={value}>{children}</PockeyContext.Provider>;
}
