import { Link } from 'react-router-dom';
import { useUploadProgress } from '../../contexts/UploadProgressContext';

export default function GlobalUploadBar() {
  const {
    active,
    phase,
    filename,
    progress,
    total,
    status,
    processingPct,
    processingError,
    dismiss,
  } = useUploadProgress();

  if (!active) return null;

  const isProcessing = phase === 'processing';
  const isError = phase === 'error' || !!processingError;

  const pct = isProcessing
    ? processingPct
    : total > 0
      ? Math.min(100, Math.round((progress / total) * 100))
      : status === 'Processing...'
        ? 100
        : 0;

  return (
    <div className="bg-upload-bar" role="status" aria-live="polite">
      <div className="bg-upload-inner">
        <Link className="bg-upload-label bg-upload-link" to="/upload" title={filename}>
          {filename || 'Upload'}
        </Link>
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
          &times;
        </button>
      </div>
    </div>
  );
}
