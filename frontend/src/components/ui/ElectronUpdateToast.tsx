import { useEffect, useRef, useState } from 'react';
import Button from './Button';
import type { ElectronUpdateStatusPayload } from '../../types/electron-api';

export default function ElectronUpdateToast() {
  const [payload, setPayload] = useState<ElectronUpdateStatusPayload | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onUpdateStatus) return;

    api.onUpdateStatus((data) => {
      // Reset dismissed state when a new status arrives that isn't a repeat
      // of the same "ready" state (so "Later" persists until next download).
      if (data.status !== 'ready') setDismissed(false);
      setPayload(data);
    });

    api.requestLastUpdateStatus?.();
  }, []);

  // Auto-dismiss transient statuses.
  useEffect(() => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    if (!payload) return;

    const autoHide =
      payload.status === 'not-available' ||
      payload.status === 'checking' ||
      payload.status === 'error';

    if (autoHide) {
      const delay = payload.status === 'error' ? 6000 : 3000;
      dismissTimerRef.current = setTimeout(() => {
        setPayload(null);
        dismissTimerRef.current = null;
      }, delay);
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

  const { status, userInitiated, percent, version } = payload;

  // For background (non-user-initiated) checks, only surface the toast once
  // the update is fully downloaded and ready to install.
  const isBackground = !userInitiated;
  if (isBackground && status !== 'ready') return null;

  // User dismissed the "ready" toast -- hide until next download.
  if (status === 'ready' && dismissed) return null;

  const pct =
    typeof percent === 'number' && Number.isFinite(percent)
      ? Math.min(100, Math.max(0, percent))
      : 0;

  let kind: 'checking' | 'available' | 'downloading' | 'ready' | 'not-available' | 'error';
  if (status === 'checking') kind = 'checking';
  else if (status === 'available') kind = 'available';
  else if (status === 'downloading' || status === 'download-progress') kind = 'downloading';
  else if (status === 'ready' || status === 'downloaded') kind = 'ready';
  else if (status === 'not-available') kind = 'not-available';
  else kind = 'error';

  return (
    <div
      className={`electron-update-toast electron-update-toast--${kind}`}
      role="status"
      aria-live="polite"
    >
      <div className="electron-update-toast-inner">
        {kind === 'checking' && (
          <span className="electron-update-toast-msg">Checking for updates...</span>
        )}

        {kind === 'available' && (
          <span className="electron-update-toast-msg">
            Update {version ? `v${version} ` : ''}available, downloading...
          </span>
        )}

        {kind === 'downloading' && (
          <div className="electron-update-toast-progress-wrap">
            <span className="electron-update-toast-msg">
              Downloading update{pct > 0 ? ` ${pct}%` : '...'}
            </span>
            <div className="electron-update-toast-bar" aria-hidden>
              <div className="electron-update-toast-bar-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        {kind === 'ready' && (
          <>
            <span className="electron-update-toast-msg">
              {version ? `v${version} ` : 'Update '}ready to install.
            </span>
            <div className="electron-update-toast-actions">
              <Button
                type="button"
                size="sm"
                variant="primary"
                onClick={() => window.electronAPI?.installUpdate()}
              >
                Restart Now
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setDismissed(true)}
              >
                Later
              </Button>
            </div>
          </>
        )}

        {kind === 'not-available' && (
          <span className="electron-update-toast-msg">You&apos;re up to date.</span>
        )}

        {kind === 'error' && (
          <span className="electron-update-toast-msg">
            Update check failed{payload.message ? `: ${payload.message}` : '.'}
          </span>
        )}
      </div>
    </div>
  );
}
