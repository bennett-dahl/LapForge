import { useState, useRef, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet, apiUploadWithProgress } from '../api/client';
import { useUploadProgress } from '../contexts/UploadProgressContext';
import type { CarDriver } from '../types/models';
import type { UploadParseResponse, SettingsResponse } from '../types/api';
import Button from '../components/ui/Button';
import { DEFAULT_SESSION_TYPE_OPTIONS, mergeSessionTypeOptions } from '../utils/sessionTypes';

function coerceSessionType(options: string[], v: string | undefined): string {
  if (!v) return options[0] ?? DEFAULT_SESSION_TYPE_OPTIONS[0]!;
  const found = options.find((o) => o === v);
  return found ?? options[0] ?? DEFAULT_SESSION_TYPE_OPTIONS[0]!;
}

function strMeta(v: string | number | undefined): string {
  if (v === undefined || v === null) return '';
  return String(v);
}

export default function UploadPage() {
  const uploadProgress = useUploadProgress();

  useEffect(() => {
    document.title = 'LapForge - Upload';
  }, []);

  const { data: carDrivers = [] } = useQuery({
    queryKey: ['car-drivers'],
    queryFn: () => apiGet<CarDriver[]>('/api/car-drivers'),
  });

  const { data: settingsData } = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiGet<SettingsResponse>('/api/settings'),
  });

  const sessionTypeOpts = settingsData?.preferences?.session_type_options;
  const sessionTypeSelectOptions = useMemo(
    () =>
      mergeSessionTypeOptions(
        Array.isArray(sessionTypeOpts) ? sessionTypeOpts : undefined,
        undefined,
      ),
    [sessionTypeOpts],
  );

  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [parsed, setParsed] = useState<UploadParseResponse | null>(null);
  const [uploading, setUploading] = useState(false);

  const [formCd, setFormCd] = useState('');
  const [formSessionType, setFormSessionType] = useState<string>(DEFAULT_SESSION_TYPE_OPTIONS[0]!);
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
    setFormSessionType(
      coerceSessionType(sessionTypeSelectOptions, sessionTypeRaw || undefined),
    );
    setFormTrack(strMeta(fm.track) || meta.TrackName || meta.Track || '');
    setFormDriver(strMeta(fm.driver) || meta.DriverName || meta.Driver || '');
    setFormCar(strMeta(fm.car) || meta.CarName || meta.Car || '');
    setFormOutingNumber(strMeta(fm.outing_number) || meta.OutingNumber || '');
    setFormSessionNumber(strMeta(fm.session_number) || meta.SessionNumber || '');
  }, [parsed, sessionTypeSelectOptions]);

  const busy = uploadProgress.phase === 'uploading' || uploadProgress.phase === 'processing';

  async function handleFileUpload() {
    if (files.length === 0) return;
    for (const f of files) {
      if (!f.name.endsWith('.txt')) {
        setError(`File must be a .txt Pi Toolbox export: ${f.name}`);
        return;
      }
    }
    setError('');
    setUploading(true);
    const label = files.length === 1 ? files[0].name : `${files.length} outing files`;
    uploadProgress.startUpload(label);
    try {
      const fd = new FormData();
      for (const f of files) {
        fd.append('file', f);
      }
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
    const label =
      files.length === 1
        ? `Save: ${files[0].name}`
        : `Save: ${files.length} outing files`;
    uploadProgress.startUpload(label);
    try {
      const fd = new FormData();
      fd.append('save', '1');
      const paths = parsed.upload_paths ?? (parsed.upload_path ? [parsed.upload_path] : []);
      for (const p of paths) {
        fd.append('upload_path', p);
      }
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
        uploadProgress.beginProcessingTask(res.task_id, label);
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

  const metadata = parsed?.metadata;
  const fileCount = parsed?.file_count ?? 0;

  const showParseStats =
    parsed &&
    typeof parsed.row_count === 'number' &&
    typeof parsed.lap_split_count === 'number';

  const showProcessingCard = uploadProgress.phase === 'processing' && uploadProgress.taskId;

  return (
    <div className="page-content">
      <h1>Upload</h1>
      <p className="muted">Import Pi Toolbox Versioned ASCII export files (.txt).</p>
      <p className="muted">
        Select one file or multiple outing files from the same session to merge them.
      </p>

      {error && <div className="alert alert-danger">{error}</div>}
      {uploadProgress.phase === 'error' && uploadProgress.processingError && !error && (
        <div className="alert alert-danger">{uploadProgress.processingError}</div>
      )}

      {showProcessingCard ? (
        <div className="upload-progress card">
          <h3>Processing...</h3>
          <div className="progress-bar-wrap">
            <div
              className="progress-bar-fill"
              style={{ width: `${uploadProgress.processingPct}%` }}
            />
          </div>
          <p className="muted">
            {uploadProgress.processingStage || uploadProgress.filename || 'Processing...'}
          </p>
          {uploadProgress.processingError && (
            <div className="alert alert-danger">{uploadProgress.processingError}</div>
          )}
        </div>
      ) : parsed ? (
        <div className="card">
          <h3>Parsed Data Preview</h3>
          {showParseStats && (
            <p className="muted">
              {fileCount > 1 ? `${fileCount} outing files merged — ` : ''}
              {parsed.row_count} rows, {parsed.lap_split_count} lap splits
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
              onChange={(e) => setFormSessionType(e.target.value)}
            >
              {sessionTypeSelectOptions.map((st) => (
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
            <Button onClick={handleSave} disabled={busy || uploading || !formCd}>
              {uploading ? 'Saving...' : 'Save Session'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setParsed(null);
                setFiles([]);
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
              Export File(s) (.txt)
            </label>
            <input
              id="upload-file"
              ref={fileRef}
              type="file"
              accept=".txt"
              multiple
              className="form-input"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
            {files.length > 1 && (
              <p className="muted" style={{ marginTop: '0.25rem' }}>
                {files.length} files selected — will be merged into one session
              </p>
            )}
          </div>
          <div className="form-actions">
            <Button onClick={handleFileUpload} disabled={files.length === 0 || busy || uploading}>
              {uploading ? 'Uploading...' : files.length > 1 ? `Upload & Parse ${files.length} Files` : 'Upload & Parse'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
