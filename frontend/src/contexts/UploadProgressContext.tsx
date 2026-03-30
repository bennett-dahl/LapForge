import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

const STORAGE_KEY = 'bg_upload';

export type UploadProgressState = {
  active: boolean;
  filename: string;
  progress: number;
  total: number;
  status: string;
};

const DEFAULT_STATE: UploadProgressState = {
  active: false,
  filename: '',
  progress: 0,
  total: 0,
  status: '',
};

function readStored(): UploadProgressState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as unknown;
    if (!p || typeof p !== 'object') return null;
    const o = p as Record<string, unknown>;
    if (typeof o.active !== 'boolean') return null;
    return {
      active: o.active,
      filename: typeof o.filename === 'string' ? o.filename : '',
      progress: typeof o.progress === 'number' ? o.progress : 0,
      total: typeof o.total === 'number' ? o.total : 0,
      status: typeof o.status === 'string' ? o.status : '',
    };
  } catch {
    return null;
  }
}

function writeStored(state: UploadProgressState) {
  try {
    if (!state.active) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota / private mode */
  }
}

export type UploadProgressContextValue = UploadProgressState & {
  startUpload: (filename: string) => void;
  updateProgress: (loaded: number, total: number) => void;
  completeUpload: () => void;
  failUpload: (error: string | Error) => void;
  dismiss: () => void;
};

const UploadProgressContext = createContext<UploadProgressContextValue | null>(null);

export function UploadProgressProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<UploadProgressState>(() => readStored() ?? DEFAULT_STATE);

  useEffect(() => {
    writeStored(state);
  }, [state]);

  const startUpload = useCallback((filename: string) => {
    setState({
      active: true,
      filename,
      progress: 0,
      total: 0,
      status: 'Uploading...',
    });
  }, []);

  const updateProgress = useCallback((loaded: number, total: number) => {
    setState((s) => ({
      ...s,
      active: true,
      progress: loaded,
      total,
      status: 'Uploading...',
    }));
  }, []);

  const completeUpload = useCallback(() => {
    setState((s) => {
      if (s.total > 0) {
        return { ...s, active: true, progress: s.total, total: s.total, status: 'Processing...' };
      }
      return { ...s, active: true, progress: 1, total: 1, status: 'Processing...' };
    });
  }, []);

  const failUpload = useCallback((error: string | Error) => {
    const msg = error instanceof Error ? error.message : error;
    setState((s) => ({
      ...s,
      active: true,
      status: msg || 'Upload failed',
    }));
  }, []);

  const dismiss = useCallback(() => {
    setState(DEFAULT_STATE);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<UploadProgressContextValue>(
    () => ({
      ...state,
      startUpload,
      updateProgress,
      completeUpload,
      failUpload,
      dismiss,
    }),
    [state, startUpload, updateProgress, completeUpload, failUpload, dismiss],
  );

  return (
    <UploadProgressContext.Provider value={value}>{children}</UploadProgressContext.Provider>
  );
}

export function useUploadProgress(): UploadProgressContextValue {
  const ctx = useContext(UploadProgressContext);
  if (!ctx) {
    throw new Error('useUploadProgress must be used within UploadProgressProvider');
  }
  return ctx;
}
