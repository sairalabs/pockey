import { createPocketkey, localStorageStorage } from '@pocketkey/core';
import type { PublicAppConfig } from '@pocketkey/types';
import { StrictMode } from 'react';
import type { Root } from 'react-dom/client';
import { App } from './App';
import { createController } from './lib/controller';
import { createEmbedKeyClient } from './lib/keys';
import { createMessenger, type IncomingMessage } from './lib/messenger';
import { installModalityTracking } from './lib/modality';
import { createEmbedStore } from './lib/state';
import { createBrowserWalletAdapter } from './lib/wallets';

const DEFAULT_API_URL = 'http://localhost:8787';
/** Longest exit animation is 200ms: past this the dialog is treated as closed. */
const CLOSE_FALLBACK_MS = 400;

/** Wires the client, controller, messenger and UI. Runs once, outside React. */
export function startEmbed(root: Root, appId: string): void {
  let client;
  // The session key lives here, in IndexedDB. The config tells the key client which
  // provider it talks to (production builds only ever trust Turnkey's enclave key).
  let config: PublicAppConfig | null = null;
  try {
    client = createPocketkey({
      appId,
      baseUrl: import.meta.env.VITE_POCKETKEY_API_URL ?? DEFAULT_API_URL,
      storage: localStorageStorage(),
      keys: createEmbedKeyClient(appId, () => config),
    });
  } catch (error) {
    console.error('[pocketkey] invalid embed configuration', error);
    return;
  }

  installModalityTracking(window);
  const store = createEmbedStore();
  const controller = createController({
    client,
    store,
    wallets: createBrowserWalletAdapter(window),
  });
  const messenger = createMessenger({
    parent: window.parent,
    listen(listener) {
      const onMessage = (event: MessageEvent<unknown>) => {
        const message: IncomingMessage = {
          data: event.data,
          origin: event.origin,
          source: event.source,
        };
        listener(message);
      };
      window.addEventListener('message', onMessage);
      return () => {
        window.removeEventListener('message', onMessage);
      };
    },
    getConfig: async () => {
      config = await client.getConfig();
      return config;
    },
    handle: controller.handle,
    onAuthChange: (listener) => client.auth.onChange(listener),
  });

  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  let lastPhase = store.get().phase;
  store.subscribe(() => {
    const { phase } = store.get();
    if (phase === lastPhase) return;
    lastPhase = phase;
    if (closeTimer !== null) clearTimeout(closeTimer);
    closeTimer = null;
    if (phase === 'open') {
      messenger.setVisible(true);
    } else if (phase === 'closed') {
      messenger.setVisible(false);
    } else {
      // The exit animation normally ends the close; this covers a dialog that never rendered.
      closeTimer = setTimeout(() => {
        if (store.get().phase === 'closing') store.set({ phase: 'closed', screen: null });
      }, CLOSE_FALLBACK_MS);
    }
  });

  root.render(
    <StrictMode>
      <App store={store} actions={controller.actions} />
    </StrictMode>,
  );

  const start = async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await messenger.start();
        return;
      } catch (error) {
        console.error('[pocketkey] could not load the app config', error);
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
      }
    }
  };
  void start();
}
