import type { KeyClient } from '@pocketkey/core';
import {
  createTurnkeyKeyClient,
  memoryKeyStore,
  type KeyStore,
  type StoredKeys,
} from '@pocketkey/key-provider/client';
import { decryptExport, encryptOtp } from '@pocketkey/key-provider/client/crypto';
import type { PublicAppConfig } from '@pocketkey/types';

/**
 * The user's key session, held by this iframe (non-custodial since 2026-09-19).
 *
 * The session key is a non-extractable WebCrypto P-256 key stored in IndexedDB: it
 * survives reloads, and no script (ours included) can read its private half. OTP
 * codes are encrypted to Turnkey's enclave here, and exported keys decrypted here.
 */

const DB_NAME = 'pocketkey-keys';
const STORE = 'keys';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB unavailable'));
    };
  });
}

function run<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
) {
  return new Promise<T>((resolve, reject) => {
    const request = action(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB request failed'));
    };
  });
}

/** One entry per app. Falls back to memory when IndexedDB is blocked (private windows). */
export function indexedDbKeyStore(appId: string): KeyStore {
  const fallback = memoryKeyStore();
  let db: Promise<IDBDatabase | null> | null = null;
  const connect = () => {
    db ??= openDb().catch(() => null);
    return db;
  };
  return {
    async load(): Promise<StoredKeys> {
      const handle = await connect();
      if (!handle) return fallback.load();
      const stored = await run(
        handle,
        'readonly',
        (store) => store.get(appId) as IDBRequest<StoredKeys | undefined>,
      ).catch(() => undefined);
      return stored ?? { active: null, pending: null };
    },
    async save(keys: StoredKeys): Promise<void> {
      const handle = await connect();
      if (!handle) {
        await fallback.save(keys);
        return;
      }
      await run(handle, 'readwrite', (store) => store.put(keys, appId));
    },
  };
}

/**
 * Only development builds accept the emulator's enclave key. A production iframe
 * always pins Turnkey's production key, whatever the API claims.
 */
export const EMULATOR_ALLOWED =
  import.meta.env.DEV || import.meta.env.VITE_POCKETKEY_ALLOW_EMULATOR === 'true';

export function createEmbedKeyClient(
  appId: string,
  config: () => PublicAppConfig | null,
): KeyClient {
  return createTurnkeyKeyClient({
    store: indexedDbKeyStore(appId),
    enclave: { encryptOtp, decryptExport },
    enclaveSignerPublicKey: () => {
      const facts = config()?.keyProvider;
      return EMULATOR_ALLOWED && facts?.kind === 'emulator'
        ? facts.enclaveSignerPublicKey
        : undefined;
    },
  });
}
