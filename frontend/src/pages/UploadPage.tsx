import { useState, useRef, useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet, apiUpload } from '../api/client';
import type { CarDriver } from '../types/models';
import type { UploadTaskStatus } from '../types/api';
import Button from '../components/ui/Button';

export default function UploadPage() {
  const { data: carDrivers = [] } = useQuery({
    queryKey: ['car-drivers'],
    queryFn: () => apiGet<CarDriver[]>('/api/car-drivers'),
  });

  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [parsed, setParsed] = useState<Record<string, unknown> | null>(null);
  const [uploading, setUploading] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState<UploadTaskStatus | null>(null);

  const [formCd, setFormCd] = useState('');

  async function handleFileUpload() {
    if (!file) return;
    if (!file.name.endsWith('.txt')) {
      setError('File must be a .txt Pi Toolbox export.');
      return;
    }
    setError('');
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (formCd) fd.append('car_driver_id', formCd);
      const res = await apiUpload<Record<string, unknown>>('/upload', fd);
      if (res.error) {
        setError(res.error as string);
      } else if (res.parsed) {
        setParsed(res as Record<string, unknown>);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    if (!parsed) return;
    setUploading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('save', '1');
      fd.append('upload_path', (parsed.upload_path as string) || '');
      fd.append('car_driver_id', formCd);
      const res = await apiUpload<Record<string, unknown>>('/upload', fd);
      if (res.task_id) {
        setTaskId(res.task_id as string);
      } else if (res.error) {
        setError(res.error as string);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setUploading(false);
    }
  }

  const pollTask = useCallback(async () => {
    if (!taskId) return;
    try {
      const status = await apiGet<UploadTaskStatus>(`/api/upload-status/${taskId}`);
      setTaskStatus(status);
      if (status.done && status.redirect) {
        const sessionId = status.redirect.replace('/sessions/', '');
        window.location.href = `/sessions/${sessionId}`;
      }
    } catch {
      // poll will retry
    }
  }, [taskId]);

  useEffect(() => {
    if (!taskId) return;
    const iv = setInterval(pollTask, 1000);
    return () => clearInterval(iv);
  }, [taskId, pollTask]);

  const metadata = parsed ? (parsed.parsed as Record<string, unknown>)?.metadata as Record<string, string> | undefined : undefined;

  return (
    <div className="page-content">
      <h1>Upload</h1>
      <p className="text-muted">Import a Pi Toolbox Versioned ASCII export file (.txt).</p>

      {error && <div className="alert alert-danger">{error}</div>}

      {taskId && taskStatus ? (
        <div className="upload-progress card">
          <h3>Processing...</h3>
          <div className="progress-bar-wrap">
            <div className="progress-bar-fill" style={{ width: `${taskStatus.pct}%` }} />
          </div>
          <p className="text-muted">{taskStatus.label || taskStatus.stage}</p>
          {taskStatus.error && <div className="alert alert-danger">{taskStatus.error}</div>}
        </div>
      ) : parsed ? (
        <div className="card">
          <h3>Parsed Data Preview</h3>
          {metadata && (
            <dl className="preview-meta">
              {Object.entries(metadata).map(([k, v]) => (
                <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
              ))}
            </dl>
          )}
          <label className="form-label">
            Car / Driver
            <select className="form-select" value={formCd} onChange={(e) => setFormCd(e.target.value)}>
              <option value="">Select...</option>
              {carDrivers.map((cd) => (
                <option key={cd.id} value={cd.id}>{cd.car_identifier} / {cd.driver_name}</option>
              ))}
            </select>
          </label>
          <div className="form-actions">
            <Button onClick={handleSave} disabled={uploading || !formCd}>
              {uploading ? 'Saving...' : 'Save Session'}
            </Button>
            <Button variant="secondary" onClick={() => { setParsed(null); setFile(null); }}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="card upload-card">
          <label className="form-label">
            Car / Driver
            <select className="form-select" value={formCd} onChange={(e) => setFormCd(e.target.value)}>
              <option value="">Select...</option>
              {carDrivers.map((cd) => (
                <option key={cd.id} value={cd.id}>{cd.car_identifier} / {cd.driver_name}</option>
              ))}
            </select>
          </label>
          <label className="form-label">
            Export File (.txt)
            <input
              ref={fileRef}
              type="file"
              accept=".txt"
              className="form-input"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <div className="form-actions">
            <Button onClick={handleFileUpload} disabled={!file || uploading}>
              {uploading ? 'Uploading...' : 'Upload & Parse'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
