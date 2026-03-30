import { createContext, useContext, useRef, useCallback, useSyncExternalStore, type ReactNode } from 'react';

interface CursorState {
  distance: number | null;
  time: number | null;
  mapDistance: number | null;
}

interface CursorSyncAPI {
  setCursor: (state: Partial<CursorState>) => void;
  clearCursor: () => void;
  subscribe: (fn: () => void) => () => void;
  getSnapshot: () => CursorState;
}

const EMPTY: CursorState = { distance: null, time: null, mapDistance: null };

function createCursorSyncStore(): CursorSyncAPI {
  let state: CursorState = { ...EMPTY };
  const listeners = new Set<() => void>();

  function notify() {
    listeners.forEach((fn) => fn());
  }

  return {
    setCursor(partial) {
      state = { ...state, ...partial };
      notify();
    },
    clearCursor() {
      state = { ...EMPTY };
      notify();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    getSnapshot() {
      return state;
    },
  };
}

const CursorSyncContext = createContext<CursorSyncAPI | null>(null);

export function CursorSyncProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<CursorSyncAPI | null>(null);
  if (!storeRef.current) storeRef.current = createCursorSyncStore();
  return (
    <CursorSyncContext.Provider value={storeRef.current}>
      {children}
    </CursorSyncContext.Provider>
  );
}

export function useCursorSync() {
  const store = useContext(CursorSyncContext);
  if (!store) throw new Error('useCursorSync must be used within CursorSyncProvider');

  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);

  const setCursor = useCallback(
    (partial: Partial<CursorState>) => store.setCursor(partial),
    [store],
  );
  const clearCursor = useCallback(() => store.clearCursor(), [store]);

  return { ...state, setCursor, clearCursor };
}
