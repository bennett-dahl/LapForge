import { useUploadProgress } from '../../contexts/UploadProgressContext';

export default function GlobalUploadBar() {
  const { active, filename, progress, total, status, dismiss } = useUploadProgress();

  if (!active) return null;

  const pct =
    total > 0 ? Math.min(100, Math.round((progress / total) * 100)) : status === 'Processing...' ? 100 : 0;
  const isError = status !== 'Uploading...' && status !== 'Processing...' && status.length > 0;

  return (
    <div className="bg-upload-bar" role="status" aria-live="polite">
      <div className="bg-upload-inner">
        <span className="bg-upload-label" title={filename}>
          {filename || 'Upload'}
        </span>
        <div
          className="bg-upload-progress"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={isError ? 'bg-upload-fill bg-error' : 'bg-upload-fill'}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="bg-upload-pct">{pct}%</span>
        <span className="bg-upload-status">{status}</span>
        <button
          type="button"
          className="bg-upload-dismiss"
          onClick={dismiss}
          aria-label="Dismiss upload progress"
        >
          ×
        </button>
      </div>
    </div>
  );
}
