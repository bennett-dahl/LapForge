import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { apiPost } from '../api/client';
import type { UploadTaskStatus } from '../types/api';

const STORAGE_KEY = 'bg_upload';

export type UploadPhase = 'idle' | 'uploading' | 'processing' | 'error';

const VALID_PHASES: readonly string[] = ['idle', 'uploading', 'processing', 'error'];

export type UploadProgressState = {
  phase: UploadPhase;
  filename: string;
  progress: number;
  total: number;
  status: string;
  taskId: string | null;
  processingPct: number;
  processingStage: string;
  processingError: string | null;
};

const DEFAULT_STATE: UploadProgressState = {
  phase: 'idle',
  filename: '',
  progress: 0,
  total: 0,
  status: '',
  taskId: null,
  processingPct: 0,
  processingStage: '',
  processingError: null,
};

function readStored(): UploadProgressState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as unknown;
    if (!p || typeof p !== 'object') return null;
    const o = p as Record<string, unknown>;
    if (typeof o.phase !== 'string' || !VALID_PHASES.includes(o.phase)) return null;
    return {
      phase: o.phase as UploadPhase,
      filename: typeof o.filename === 'string' ? o.filename : '',
      progress: typeof o.progress === 'number' ? o.progress : 0,
      total: typeof o.total === 'number' ? o.total : 0,
      status: typeof o.status === 'string' ? o.status : '',
      taskId: typeof o.taskId === 'string' ? o.taskId : null,
      processingPct: typeof o.processingPct === 'number' ? o.processingPct : 0,
      processingStage: typeof o.processingStage === 'string' ? o.processingStage : '',
      processingError: typeof o.processingError === 'string' ? o.processingError : null,
    };
  } catch {
    return null;
  }
}

function writeStored(state: UploadProgressState) {
  try {
    if (state.phase === 'idle') {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota / private mode */
  }
}

export type UploadProgressContextValue = UploadProgressState & {
  /** Derived: true when phase !== 'idle' */
  active: boolean;
  startUpload: (filename: string) => void;
  updateProgress: (loaded: number, total: number) => void;
  completeUpload: () => void;
  failUpload: (error: string | Error) => void;
  beginProcessingTask: (taskId: string, fallbackLabel?: string) => void;
  updateTaskStatus: (status: UploadTaskStatus) => void;
  resetAfterSuccess: () => void;
  failProcessing: (message: string) => void;
  dismiss: () => void;
};

const UploadProgressContext = createContext<UploadProgressContextValue | null>(null);

export function UploadProgressProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<UploadProgressState>(() => readStored() ?? DEFAULT_STATE);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    writeStored(state);
  }, [state]);

  const startUpload = useCallback((filename: string) => {
    setState({
      ...DEFAULT_STATE,
      phase: 'uploading',
      filename,
      status: 'Uploading...',
    });
  }, []);

  const updateProgress = useCallback((loaded: number, total: number) => {
    setState((s) => ({
      ...s,
      progress: loaded,
      total,
      status: 'Uploading...',
    }));
  }, []);

  const completeUpload = useCallback(() => {
    setState((s) => {
      if (s.total > 0) {
        return { ...s, progress: s.total, total: s.total, status: 'Processing...' };
      }
      return { ...s, progress: 1, total: 1, status: 'Processing...' };
    });
  }, []);

  const failUpload = useCallback((error: string | Error) => {
    const msg = error instanceof Error ? error.message : error;
    setState((s) => ({
      ...s,
      phase: 'error',
      status: msg || 'Upload failed',
    }));
  }, []);

  const beginProcessingTask = useCallback((taskId: string, fallbackLabel?: string) => {
    setState((s) => ({
      ...s,
      phase: 'processing',
      taskId,
      processingPct: 0,
      processingStage: '',
      processingError: null,
      filename: fallbackLabel || s.filename,
      status: 'Processing...',
    }));
  }, []);

  const updateTaskStatus = useCallback((status: UploadTaskStatus) => {
    setState((s) => ({
      ...s,
      processingPct: status.pct,
      processingStage: status.stage,
      processingError: status.error,
      filename: status.label || s.filename,
      status: status.stage || 'Processing...',
    }));
  }, []);

  const resetAfterSuccess = useCallback(() => {
    setState(DEFAULT_STATE);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const failProcessing = useCallback((message: string) => {
    setState((s) => ({
      ...s,
      phase: 'error',
      processingError: message,
      status: message || 'Processing failed',
    }));
  }, []);

  const dismiss = useCallback(() => {
    const { phase, taskId } = stateRef.current;
    if (phase === 'processing' && taskId) {
      apiPost(`/api/upload-dismiss/${taskId}`).catch(() => {});
    }
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
      active: state.phase !== 'idle',
      startUpload,
      updateProgress,
      completeUpload,
      failUpload,
      beginProcessingTask,
      updateTaskStatus,
      resetAfterSuccess,
      failProcessing,
      dismiss,
    }),
    [state, startUpload, updateProgress, completeUpload, failUpload, beginProcessingTask, updateTaskStatus, resetAfterSuccess, failProcessing, dismiss],
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
