import { createContext, useContext, useRef, useCallback, useSyncExternalStore, type ReactNode } from 'react';

interface CursorState {
  distance: number | null;
  time: number | null;
  mapDistance: number | null;
  xMin: number | null;
  xMax: number | null;
}

interface CursorSyncAPI {
  setCursor: (state: Partial<Pick<CursorState, 'distance' | 'time' | 'mapDistance'>>) => void;
  clearCursor: () => void;
  setXRange: (min: number | null, max: number | null) => void;
  resetZoom: () => void;
  subscribe: (fn: () => void) => () => void;
  getSnapshot: () => CursorState;
}

const EMPTY_CURSOR: Pick<CursorState, 'distance' | 'time' | 'mapDistance'> = {
  distance: null,
  time: null,
  mapDistance: null,
};

const initialState = (): CursorState => ({
  ...EMPTY_CURSOR,
  xMin: null,
  xMax: null,
});

function createCursorSyncStore(): CursorSyncAPI {
  let state: CursorState = initialState();
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
      state = { ...state, ...EMPTY_CURSOR };
      notify();
    },
    setXRange(min, max) {
      state = { ...state, xMin: min, xMax: max };
      notify();
    },
    resetZoom() {
      state = { ...state, xMin: null, xMax: null };
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
    (partial: Parameters<CursorSyncAPI['setCursor']>[0]) => store.setCursor(partial),
    [store],
  );
  const clearCursor = useCallback(() => store.clearCursor(), [store]);
  const setXRange = useCallback(
    (min: number | null, max: number | null) => store.setXRange(min, max),
    [store],
  );
  const resetZoom = useCallback(() => store.resetZoom(), [store]);

  return {
    ...state,
    setCursor,
    clearCursor,
    setXRange,
    resetZoom,
  };
}

/**
 * Raw store access without subscription -- calling code can subscribe
 * imperatively and read snapshots without causing React re-renders.
 */
export function useCursorStore() {
  const store = useContext(CursorSyncContext);
  if (!store) throw new Error('useCursorStore must be used within CursorSyncProvider');
  return store;
}

/**
 * Subscribe only to zoom state (xMin / xMax). Cursor position changes
 * (distance, time, mapDistance) will NOT trigger a re-render.
 */
export function useCursorZoom() {
  const store = useContext(CursorSyncContext);
  if (!store) throw new Error('useCursorZoom must be used within CursorSyncProvider');

  const prevRef = useRef<{ xMin: number | null; xMax: number | null }>({ xMin: null, xMax: null });

  const zoom = useSyncExternalStore(store.subscribe, () => {
    const s = store.getSnapshot();
    if (s.xMin === prevRef.current.xMin && s.xMax === prevRef.current.xMax) {
      return prevRef.current;
    }
    prevRef.current = { xMin: s.xMin, xMax: s.xMax };
    return prevRef.current;
  });

  const setXRange = useCallback(
    (min: number | null, max: number | null) => store.setXRange(min, max),
    [store],
  );
  const resetZoom = useCallback(() => store.resetZoom(), [store]);
  const setCursor = useCallback(
    (partial: Parameters<CursorSyncAPI['setCursor']>[0]) => store.setCursor(partial),
    [store],
  );
  const clearCursor = useCallback(() => store.clearCursor(), [store]);

  return { ...zoom, setXRange, resetZoom, setCursor, clearCursor };
}
