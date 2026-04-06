import { useRef, useCallback, useEffect, useState } from 'react';

type SaveFn<T> = (data: T) => Promise<unknown>;

export function useDebouncedSave<T>(saveFn: SaveFn<T>, delay = 800) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef<T | null>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const save = useCallback(
    (data: T) => {
      latestRef.current = data;
      if (timerRef.current) clearTimeout(timerRef.current);
      setStatus('saving');
      timerRef.current = setTimeout(async () => {
        try {
          await saveFn(data);
          setStatus('saved');
          setTimeout(() => setStatus((s) => (s === 'saved' ? 'idle' : s)), 2000);
        } catch {
          setStatus('error');
        }
      }, delay);
    },
    [saveFn, delay],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { save, status };
}
