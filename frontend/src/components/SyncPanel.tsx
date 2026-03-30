import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../api/client';
import type { SyncStatusResponse, SyncFilesResponse } from '../types/api';
import Button from './ui/Button';

export default function SyncPanel() {
  const { data: status, refetch: refetchStatus } = useQuery({
    queryKey: ['sync-status'],
    queryFn: () => apiGet<SyncStatusResponse>('/api/sync/status'),
  });

  const { data: files, refetch: refetchFiles } = useQuery({
    queryKey: ['sync-files'],
    queryFn: () => apiGet<SyncFilesResponse>('/api/sync/files'),
    enabled: !!status && status.status !== 'not_logged_in' && status.status !== 'oauth_not_configured',
  });

  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState('');
  const [resultColor, setResultColor] = useState('');

  const doSync = useCallback(async (action: 'push' | 'pull') => {
    setSyncing(true);
    setResult('');
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
            const evt = JSON.parse(clean);
            if (evt.event === 'complete') {
              gotComplete = true;
              setResult(`${action === 'push' ? 'Pushed' : 'Pulled'} successfully.`);
              setResultColor('var(--success, #22c55e)');
            } else if (evt.event === 'error') {
              gotComplete = true;
              setResult(`Error: ${evt.message || 'Sync failed'}`);
              setResultColor('var(--danger, #ef4444)');
            } else if (evt.event === 'file_start') {
              setResult(`${action === 'push' ? 'Uploading' : 'Downloading'} ${evt.path}...`);
              setResultColor('');
            }
          } catch {
            // skip
          }
        }
      }
    } catch (e) {
      setResult(`Error: ${e instanceof Error ? e.message : 'Unknown'}`);
      setResultColor('var(--danger, #ef4444)');
    } finally {
      setSyncing(false);
      refetchStatus();
      refetchFiles();
    }
  }, [refetchStatus, refetchFiles]);

  if (!status) return <p className="text-muted">Loading sync status...</p>;
  if (status.status === 'oauth_not_configured') return <p className="text-muted">OAuth not configured.</p>;
  if (status.status === 'not_logged_in') {
    return (
      <div>
        <p className="text-muted">Sign in to enable cloud sync.</p>
        <a href="/auth/login"><Button>Sign in with Google</Button></a>
      </div>
    );
  }

  const summary = files?.summary;

  return (
    <div className="sync-panel">
      <div className="sync-status">
        <span>Status: <strong>{status.status.replace(/_/g, ' ')}</strong></span>
        {status.last_synced_at && <span className="text-muted"> — last synced {new Date(status.last_synced_at).toLocaleString()}</span>}
      </div>

      {summary && (
        <div className="sync-summary text-muted">
          {summary.total} files, {summary.synced} synced, {summary.pending} pending
          ({(summary.pending_size / 1024).toFixed(1)} KB)
        </div>
      )}

      <div className="form-actions">
        <Button onClick={() => doSync('push')} disabled={syncing}>Push to Cloud</Button>
        <Button variant="secondary" onClick={() => doSync('pull')} disabled={syncing}>Pull from Cloud</Button>
      </div>

      {result && <p className="sync-result" style={{ color: resultColor || undefined }}>{result}</p>}
    </div>
  );
}
