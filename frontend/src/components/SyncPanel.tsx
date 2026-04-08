import { useState, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet } from '../api/client';
import type { SyncStatusResponse, SyncFilesResponse, SyncFile } from '../types/api';
import Button from './ui/Button';
import { SYNC_STATUS_LABELS } from '../utils/syncStatus';

const STATUS_LABELS = SYNC_STATUS_LABELS;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileStatusDotClass(file: SyncFile, transient?: string): string {
  if (transient === 'uploading') return 'st-uploading';
  if (transient === 'downloading') return 'st-downloading';
  if (transient === 'done') return 'st-done';
  if (transient === 'skipped') return 'st-skipped';
  switch (file.status) {
    case 'synced':
      return 'st-synced';
    case 'new':
      return 'st-new';
    case 'modified':
      return 'st-modified';
    default:
      return 'st-pending';
  }
}

function fileStatusLabel(file: SyncFile, transient?: string): string {
  if (transient === 'uploading') return 'Uploading';
  if (transient === 'downloading') return 'Downloading';
  if (transient === 'done') return 'Done';
  if (transient === 'skipped') return 'Skipped';
  switch (file.status) {
    case 'synced':
      return 'Synced';
    case 'new':
      return 'New';
    case 'modified':
      return 'Modified';
    default:
      return file.status;
  }
}

export default function SyncPanel() {
  const queryClient = useQueryClient();
  const { data: status, refetch: refetchStatus } = useQuery({
    queryKey: ['sync-status'],
    queryFn: () => apiGet<SyncStatusResponse>('/api/sync/status'),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const { data: files, refetch: refetchFiles } = useQuery({
    queryKey: ['sync-files'],
    queryFn: () => apiGet<SyncFilesResponse>('/api/sync/files'),
    enabled: !!status && status.status !== 'not_logged_in' && status.status !== 'oauth_not_configured',
  });

  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState('');
  const [resultColor, setResultColor] = useState('');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [fileTransient, setFileTransient] = useState<Record<string, 'uploading' | 'downloading' | 'done' | 'skipped'>>({});
  const pullSucceededRef = useRef(false);

  const doSync = useCallback(
    async (action: 'push' | 'pull') => {
      if (action === 'pull') {
        if (!window.confirm('This will overwrite local data with the cloud version. Continue?')) {
          return;
        }
      }

      pullSucceededRef.current = false;

      const list = files?.files ?? [];
      const totalFromApi = files?.summary?.total ?? list.length;
      const progressTotal = Math.max(totalFromApi, 1);

      setSyncing(true);
      setResult('');
      setProgress({ done: 0, total: progressTotal });
      setFileTransient({});

      try {
        const resp = await fetch(`/api/sync/${action}`, { method: 'POST', credentials: 'same-origin' });
        if (!resp.ok) {
          const d = await resp.json();
          throw new Error(d.error || 'Request failed');
        }
        const reader = resp.body?.getReader();
        if (!reader) throw new Error('No stream');
        const decoder = new TextDecoder();
        let buf = '';
        let gotComplete = false;

        const bumpProgress = () => {
          setProgress((p) => {
            const nextDone = p.done + 1;
            const nextTotal = Math.max(p.total, nextDone);
            return { done: nextDone, total: nextTotal };
          });
        };

        const setPathState = (path: string, state: 'uploading' | 'downloading' | 'done' | 'skipped') => {
          setFileTransient((prev) => ({ ...prev, [path]: state }));
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            if (!gotComplete) {
              setResult('Stream ended without completion.');
              setResultColor('var(--danger, #ef4444)');
            }
            break;
          }
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            const clean = line.replace(/^data:\s*/, '').trim();
            if (!clean) continue;
            try {
              const evt = JSON.parse(clean) as { event: string; path?: string; message?: string };
              if (evt.event === 'complete') {
                gotComplete = true;
                setResult(`${action === 'push' ? 'Pushed' : 'Pulled'} successfully.`);
                setResultColor('var(--success, #22c55e)');
                setProgress((p) => ({ done: p.total, total: p.total }));
                if (action === 'pull') {
                  pullSucceededRef.current = true;
                }
              } else if (evt.event === 'error') {
                gotComplete = true;
                setResult(`Error: ${evt.message || 'Sync failed'}`);
                setResultColor('var(--danger, #ef4444)');
              } else if (evt.event === 'file_start' && evt.path) {
                setPathState(evt.path, action === 'push' ? 'uploading' : 'downloading');
                setResult(`${action === 'push' ? 'Uploading' : 'Downloading'} ${evt.path}...`);
                setResultColor('');
              } else if (evt.event === 'file_done' && evt.path) {
                setPathState(evt.path, 'done');
                bumpProgress();
              } else if (evt.event === 'file_skip' && evt.path) {
                setPathState(evt.path, 'skipped');
                bumpProgress();
              }
            } catch {
              // skip malformed line
            }
          }
        }
      } catch (e) {
        setResult(`Error: ${e instanceof Error ? e.message : 'Unknown'}`);
        setResultColor('var(--danger, #ef4444)');
      } finally {
        setSyncing(false);
        setFileTransient({});
        await refetchStatus();
        await refetchFiles();
        if (pullSucceededRef.current) {
          await queryClient.invalidateQueries();
          window.setTimeout(() => {
            window.location.reload();
          }, 500);
        }
        pullSucceededRef.current = false;
        setProgress({ done: 0, total: 0 });
      }
    },
    [refetchStatus, refetchFiles, files, queryClient],
  );

  if (!status) return <p className="muted">Loading sync status...</p>;
  if (status.status === 'oauth_not_configured') return <p className="muted">OAuth not configured.</p>;
  if (status.status === 'not_logged_in') {
    return (
      <div>
        <p className="muted">Sign in to enable cloud sync.</p>
        <a href="/auth/login">
          <Button>Sign in with Google</Button>
        </a>
      </div>
    );
  }

  const summary = files?.summary;
  const fileRows = files?.files ?? [];
  const statusKey = status.status;
  const statusLabel = STATUS_LABELS[statusKey] ?? statusKey.replace(/_/g, ' ');
  const progressPct =
    progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;

  return (
    <div className="sync-panel">
      <div className="sync-status">
        <span>
          Status:{' '}
          <span className={`sync-badge sync-${statusKey}`}>
            <strong>{statusLabel}</strong>
          </span>
        </span>
        {status.last_synced_at && (
          <span className="muted"> — last synced {new Date(status.last_synced_at).toLocaleString()}</span>
        )}
      </div>

      {summary && (
        <div className="sync-summary muted">
          <span>
            {summary.total} files, {summary.synced} synced, {summary.pending} pending (
            {formatFileSize(summary.pending_size)})
          </span>
        </div>
      )}

      <div
        className="sync-progress-wrap"
        style={{ display: syncing ? 'block' : 'none' }}
        role="progressbar"
        aria-valuenow={progressPct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="sync-progress-bar" style={{ width: `${progressPct}%` }} />
      </div>

      {fileRows.length > 0 && (
        <div className="sync-file-list">
          {fileRows.map((f) => {
            const t = fileTransient[f.path];
            const dotClass = fileStatusDotClass(f, t);
            const statusClass = fileStatusDotClass(f, t);
            return (
              <div key={f.path} className="sync-file-row">
                <span className={`sync-file-dot ${dotClass}`} title={f.type} />
                <span className="sync-file-name" title={f.path}>
                  {f.path}
                </span>
                <span className="sync-file-size">{formatFileSize(f.size)}</span>
                <span className={`sync-file-status ${statusClass}`}>{fileStatusLabel(f, t)}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="form-actions">
        <Button onClick={() => doSync('push')} disabled={syncing}>
          Push to Cloud
        </Button>
        <Button variant="secondary" onClick={() => doSync('pull')} disabled={syncing}>
          Pull from Cloud
        </Button>
      </div>

      {result && (
        <p className="sync-result" style={{ color: resultColor || undefined }}>
          {result}
        </p>
      )}
    </div>
  );
}
