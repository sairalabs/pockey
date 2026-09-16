/**
 * Where the client keeps its session. Sync or async, so React Native secure
 * stores and extension storage fit as well as `localStorage`.
 * Everything read back is treated as untrusted and validated by the client.
 */
export interface TokenStorage {
  get(key: string): string | null | Promise<string | null>;
  set(key: string, value: string): void | Promise<void>;
  remove(key: string): void | Promise<void>;
}

/** In-memory storage. The session dies with the page (or the process). */
export function memoryStorage(): TokenStorage {
  const map = new Map<string, string>();
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => {
      map.set(key, value);
    },
    remove: (key) => {
      map.delete(key);
    },
  };
}

interface WebStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function webStorage(): WebStorage | null {
  try {
    return (globalThis as { localStorage?: WebStorage }).localStorage ?? null;
  } catch {
    // The getter itself throws in sandboxed iframes and with storage blocked.
    return null;
  }
}

/**
 * `window.localStorage`, falling back to memory when it is missing or throws
 * (Safari private mode, sandboxed iframes, blocked third-party storage, quota).
 * A key whose write failed is served from memory from then on, so reads never
 * return a value older than the last write.
 */
export function localStorageStorage(): TokenStorage {
  /** `null` marks a removal that could not reach localStorage. */
  const overlay = new Map<string, string | null>();

  return {
    get(key) {
      if (overlay.has(key)) return overlay.get(key) ?? null;
      try {
        return webStorage()?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        const store = webStorage();
        if (store) {
          store.setItem(key, value);
          overlay.delete(key);
          return;
        }
      } catch {
        // Fall through to memory.
      }
      overlay.set(key, value);
    },
    remove(key) {
      try {
        const store = webStorage();
        if (store) {
          store.removeItem(key);
          overlay.delete(key);
          return;
        }
      } catch {
        // Fall through to memory.
      }
      overlay.set(key, null);
    },
  };
}
