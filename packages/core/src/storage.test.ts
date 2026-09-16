import { afterEach, describe, expect, it, vi } from 'vitest';
import { localStorageStorage, memoryStorage } from './storage.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function fakeLocalStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

describe('storage', () => {
  it('memoryStorage gets, sets and removes', () => {
    const storage = memoryStorage();
    expect(storage.get('k')).toBeNull();
    void storage.set('k', 'v');
    expect(storage.get('k')).toBe('v');
    void storage.remove('k');
    expect(storage.get('k')).toBeNull();
  });

  it('localStorageStorage writes through to localStorage', () => {
    const ls = fakeLocalStorage();
    vi.stubGlobal('localStorage', ls);
    const storage = localStorageStorage();
    void storage.set('k', 'v');
    expect(ls.map.get('k')).toBe('v');
    expect(storage.get('k')).toBe('v');
    void storage.remove('k');
    expect(ls.map.has('k')).toBe(false);
  });

  it('localStorageStorage falls back to memory without localStorage', () => {
    const storage = localStorageStorage();
    void storage.set('k', 'v');
    expect(storage.get('k')).toBe('v');
  });

  it('localStorageStorage falls back to memory when localStorage throws', () => {
    const ls = fakeLocalStorage();
    ls.map.set('old', 'stale');
    ls.setItem = () => {
      throw new DOMException('QuotaExceededError');
    };
    vi.stubGlobal('localStorage', ls);
    const storage = localStorageStorage();
    void storage.set('old', 'fresh');
    expect(storage.get('old')).toBe('fresh');
    ls.removeItem = () => {
      throw new DOMException('SecurityError');
    };
    void storage.remove('old');
    expect(storage.get('old')).toBeNull();
  });

  it('localStorageStorage survives a throwing getter (sandboxed iframe)', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The document is sandboxed', 'SecurityError');
      },
    });
    try {
      const storage = localStorageStorage();
      expect(storage.get('k')).toBeNull();
      void storage.set('k', 'v');
      expect(storage.get('k')).toBe('v');
    } finally {
      Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });
});
