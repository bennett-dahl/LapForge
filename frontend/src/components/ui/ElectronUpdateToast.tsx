import { useEffect, useRef, useState } from 'react';
import Button from './Button';
import type { ElectronUpdateStatusPayload } from '../../types/electron-api';

type DisplayKind =
  | 'checking'
  | 'available'
  | 'download-progress'
  | 'downloaded'
  | 'not-available'
  | 'error';

function toDisplayKind(data: ElectronUpdateStatusPayload): DisplayKind {
  const s = data.status;
  if (s === 'downloading' || s === 'download-progress') return 'download-progress';
  if (s === 'ready' || s === 'downloaded') return 'downloaded';
  if (s === 'checking') return 'checking';
  if (s === 'available') return 'available';
  if (s === 'not-available') return 'not-available';
  if (s === 'error') return 'error';
  return 'error';
}

export default function ElectronUpdateToast() {
  const [payload, setPayload] = useState<ElectronUpdateStatusPayload | null>(null);
  const [readyDismissed, setReadyDismissed] = useState(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onUpdateStatus) return;

    api.onUpdateStatus((data) => {
      setReadyDismissed(false);
      setPayload(data);
    });
    api.requestLastUpdateStatus?.();
  }, []);

  useEffect(() => {
    if (!payload) return;
    const kind = toDisplayKind(payload);
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    if (kind === 'not-available') {
      dismissTimerRef.current = setTimeout(() => {
        setPayload(null);
        dismissTimerRef.current = null;
      }, 3000);
    } else if (kind === 'error') {
      dismissTimerRef.current = setTimeout(() => {
        setPayload(null);
        dismissTimerRef.current = null;
      }, 5000);
    }
    return () => {
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
    };
  }, [payload]);

  const api = window.electronAPI;
  if (!api) return null;

  if (!payload) return null;

  const kind = toDisplayKind(payload);
  if (kind === 'downloaded' && readyDismissed) return null;

  const pct =
    typeof payload.percent === 'number' && Number.isFinite(payload.percent)
      ? Math.min(100, Math.max(0, payload.percent))
      : 0;

  return (
    <div
      className={`electron-update-toast electron-update-toast--${kind}`}
      role="status"
      aria-live="polite"
    >
      <div className="electron-update-toast-inner">
        {kind === 'checking' && <span className="electron-update-toast-msg">Checking for updates...</span>}

        {kind === 'available' && (
          <span className="electron-update-toast-msg">Update available, downloading...</span>
        )}

        {kind === 'download-progress' && (
          <div className="electron-update-toast-progress-wrap">
            <span className="electron-update-toast-msg">Downloading update… {pct}%</span>
            <div className="electron-update-toast-bar" aria-hidden>
              <div className="electron-update-toast-bar-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        {kind === 'downloaded' && (
          <>
            <span className="electron-update-toast-msg">Update ready! Restart to install.</span>
            <div className="electron-update-toast-actions">
              <Button
                type="button"
                size="sm"
                variant="primary"
                onClick={() => window.electronAPI?.installUpdate()}
              >
                Restart
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => setReadyDismissed(true)}>
                Later
              </Button>
            </div>
          </>
        )}

        {kind === 'not-available' && (
          <span className="electron-update-toast-msg">You&apos;re up to date.</span>
        )}

        {kind === 'error' && (
          <span className="electron-update-toast-msg">Update check failed</span>
        )}
      </div>
    </div>
  );
}
