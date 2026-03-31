import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiGet, apiUploadWithProgress } from '../api/client';
import { useUploadProgress } from '../contexts/UploadProgressContext';
import type { CarDriver } from '../types/models';
import { SessionType } from '../types/models';
import type { UploadParseResponse, UploadTaskStatus } from '../types/api';
import Button from '../components/ui/Button';

const SESSION_TYPE_OPTIONS: SessionType[] = [
  SessionType.Practice1,
  SessionType.Practice2,
  SessionType.Practice3,
  SessionType.Qualifying,
  SessionType.Race1,
  SessionType.Race2,
];

function coerceSessionType(v: string | undefined): SessionType {
  if (!v) return SessionType.Practice1;
  const found = SESSION_TYPE_OPTIONS.find((o) => o === v);
  return found ?? SessionType.Practice1;
}

function strMeta(v: string | number | undefined): string {
  if (v === undefined || v === null) return '';
  return String(v);
}

export default function UploadPage() {
  const navigate = useNavigate();
  const uploadProgress = useUploadProgress();

  useEffect(() => {
    document.title = 'LapForge - Upload';
  }, []);

  const { data: carDrivers = [] } = useQuery({
    queryKey: ['car-drivers'],
    queryFn: () => apiGet<CarDriver[]>('/api/car-drivers'),
  });

  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [parsed, setParsed] = useState<UploadParseResponse | null>(null);
  const [uploading, setUploading] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState<UploadTaskStatus | null>(null);

  const [formCd, setFormCd] = useState('');
  const [formSessionType, setFormSessionType] = useState<SessionType>(SessionType.Practice1);
  const [formTrack, setFormTrack] = useState('');
  const [formDriver, setFormDriver] = useState('');
  const [formCar, setFormCar] = useState('');
  const [formOutingNumber, setFormOutingNumber] = useState('');
  const [formSessionNumber, setFormSessionNumber] = useState('');

  useEffect(() => {
    if (!parsed) return;
    const fm = parsed.form_metadata ?? {};
    const meta = parsed.metadata ?? {};
    const sessionTypeRaw =
      strMeta(fm.session_type) || meta.SessionType || meta.Session || '';
    setFormSessionType(coerceSessionType(sessionTypeRaw || undefined));
    setFormTrack(strMeta(fm.track) || meta.TrackName || meta.Track || '');
    setFormDriver(strMeta(fm.driver) || meta.DriverName || meta.Driver || '');
    setFormCar(strMeta(fm.car) || meta.CarName || meta.Car || '');
    setFormOutingNumber(strMeta(fm.outing_number) || meta.OutingNumber || '');
    setFormSessionNumber(strMeta(fm.session_number) || meta.SessionNumber || '');
  }, [parsed]);

  async function handleFileUpload() {
    if (!file) return;
    if (!file.name.endsWith('.txt')) {
      setError('File must be a .txt Pi Toolbox export.');
      return;
    }
    setError('');
    setUploading(true);
    uploadProgress.startUpload(file.name);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (formCd) fd.append('car_driver_id', formCd);
      const res = await apiUploadWithProgress<UploadParseResponse & { error?: string }>(
        '/upload',
        fd,
        {
          onProgress: (loaded, total) => uploadProgress.updateProgress(loaded, total),
          onUploadComplete: () => uploadProgress.completeUpload(),
        },
      );
      if (res.error) {
        uploadProgress.failUpload(res.error as string);
        setError(res.error as string);
      } else if (res.parsed) {
        uploadProgress.dismiss();
        setParsed(res);
      } else {
        uploadProgress.dismiss();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Upload failed';
      uploadProgress.failUpload(msg);
      setError(msg);
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    if (!parsed) return;
    setUploading(true);
    setError('');
    const label = file?.name ? `Save: ${file.name}` : 'Save session';
    uploadProgress.startUpload(label);
    try {
      const fd = new FormData();
      fd.append('save', '1');
      fd.append('upload_path', parsed.upload_path || '');
      fd.append('car_driver_id', formCd);
      fd.append('session_type', formSessionType);
      fd.append('track', formTrack);
      fd.append('driver', formDriver);
      fd.append('car', formCar);
      fd.append('outing_number', formOutingNumber);
      fd.append('session_number', formSessionNumber);
      const res = await apiUploadWithProgress<{ task_id?: string; error?: string }>(
        '/upload',
        fd,
        {
          onProgress: (loaded, total) => uploadProgress.updateProgress(loaded, total),
          onUploadComplete: () => uploadProgress.completeUpload(),
        },
      );
      if (res.task_id) {
        uploadProgress.dismiss();
        setTaskId(res.task_id);
      } else if (res.error) {
        uploadProgress.failUpload(res.error);
        setError(res.error);
      } else {
        uploadProgress.dismiss();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      uploadProgress.failUpload(msg);
      setError(msg);
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
        navigate(`/sessions/${sessionId}`);
      }
    } catch {
      // poll will retry
    }
  }, [taskId, navigate]);

  useEffect(() => {
    if (!taskId) return;
    const iv = setInterval(pollTask, 1000);
    return () => clearInterval(iv);
  }, [taskId, pollTask]);

  const metadata = parsed?.metadata;

  const showParseStats =
    parsed &&
    typeof parsed.row_count === 'number' &&
    typeof parsed.lap_split_count === 'number';

  return (
    <div className="page-content">
      <h1>Upload</h1>
      <p className="muted">
        Upload telemetry data files from your data logger. Supported formats: CSV, MoTeC LD/LDX.
      </p>
      <p className="muted">Import a Pi Toolbox Versioned ASCII export file (.txt).</p>

      {error && <div className="alert alert-danger">{error}</div>}

      {taskId && taskStatus ? (
        <div className="upload-progress card">
          <h3>Processing...</h3>
          <div className="progress-bar-wrap">
            <div className="progress-bar-fill" style={{ width: `${taskStatus.pct}%` }} />
          </div>
          <p className="muted">{taskStatus.label || taskStatus.stage}</p>
          {taskStatus.error && <div className="alert alert-danger">{taskStatus.error}</div>}
        </div>
      ) : parsed ? (
        <div className="card">
          <h3>Parsed Data Preview</h3>
          {showParseStats && (
            <p className="muted">
              Parsed: {parsed.row_count} rows, {parsed.lap_split_count} lap splits
            </p>
          )}
          {metadata && Object.keys(metadata).length > 0 && (
            <dl className="preview-meta">
              {Object.entries(metadata).map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          )}
          <div className="form-group">
            <label className="form-label" htmlFor="upload-save-car-driver">
              Car / Driver
            </label>
            <select
              id="upload-save-car-driver"
              className="form-select"
              value={formCd}
              onChange={(e) => setFormCd(e.target.value)}
            >
              <option value="">Select...</option>
              {carDrivers.map((cd) => (
                <option key={cd.id} value={cd.id}>
                  {cd.car_identifier} / {cd.driver_name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="upload-session-type">
              Session Type
            </label>
            <select
              id="upload-session-type"
              className="form-select"
              required
              value={formSessionType}
              onChange={(e) => setFormSessionType(e.target.value as SessionType)}
            >
              {SESSION_TYPE_OPTIONS.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="upload-track">
              Track
            </label>
            <input
              id="upload-track"
              type="text"
              className="form-input"
              value={formTrack}
              onChange={(e) => setFormTrack(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="upload-driver">
              Driver
            </label>
            <input
              id="upload-driver"
              type="text"
              className="form-input"
              value={formDriver}
              onChange={(e) => setFormDriver(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="upload-car">
              Car
            </label>
            <input
              id="upload-car"
              type="text"
              className="form-input"
              value={formCar}
              onChange={(e) => setFormCar(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="upload-outing-number">
              Outing Number
            </label>
            <input
              id="upload-outing-number"
              type="number"
              className="form-input"
              value={formOutingNumber}
              onChange={(e) => setFormOutingNumber(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="upload-session-number">
              Session Number
            </label>
            <input
              id="upload-session-number"
              type="number"
              className="form-input"
              value={formSessionNumber}
              onChange={(e) => setFormSessionNumber(e.target.value)}
            />
          </div>
          <div className="form-actions">
            <Button onClick={handleSave} disabled={uploading || !formCd}>
              {uploading ? 'Saving...' : 'Save Session'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setParsed(null);
                setFile(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="card upload-card">
          <div className="form-group">
            <label className="form-label" htmlFor="upload-car-driver">
              Car / Driver
            </label>
            <select
              id="upload-car-driver"
              className="form-select"
              value={formCd}
              onChange={(e) => setFormCd(e.target.value)}
            >
              <option value="">Select...</option>
              {carDrivers.map((cd) => (
                <option key={cd.id} value={cd.id}>
                  {cd.car_identifier} / {cd.driver_name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="upload-file">
              Export File (.txt)
            </label>
            <input
              id="upload-file"
              ref={fileRef}
              type="file"
              accept=".txt"
              className="form-input"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
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
