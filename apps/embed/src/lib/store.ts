/** Minimal external store, read in React through `useSyncExternalStore`. */
export interface Store<S> {
  get: () => S;
  set: (update: Partial<S> | ((state: S) => Partial<S>)) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createStore<S extends object>(initial: S): Store<S> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(update) {
      const patch = typeof update === 'function' ? update(state) : update;
      state = { ...state, ...patch };
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
