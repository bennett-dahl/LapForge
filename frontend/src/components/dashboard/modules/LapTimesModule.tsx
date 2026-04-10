const LAP_DOT_PALETTE = [
  '#3b82f6',
  '#ef4444',
  '#22c55e',
  '#f59e0b',
  '#a855f7',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
  '#f97316',
  '#6366f1',
] as const;

interface LapTime {
  lap: number;
  time: number;
  fast?: boolean;
  segment_index?: number;
}

interface LapTimesModuleProps {
  lapTimes: LapTime[];
  fastIdx: number | null;
  onLapClick?: (lap: number) => void;
  excludedLaps?: number[];
  onToggleExcludeLap?: (segmentIndex: number) => void;
  hasExclusionDraft?: boolean;
  onApplyExclusions?: () => void;
  onDiscardExclusions?: () => void;
  applyExclusionsPending?: boolean;
}

/** `m:ss.SSS` if ≥ 60s, else `ss.SSS`. */
function fmtLapTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  const frac = s.toFixed(3);
  if (m > 0) return `${m}:${frac.padStart(6, '0')}`;
  return frac;
}

function formatDelta(delta: number): string {
  if (!Number.isFinite(delta)) return '—';
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta.toFixed(3)}`;
}

function deltaClass(delta: number, isBest: boolean): string {
  if (isBest) return 'lap-delta-best';
  if (delta > 1) return 'lap-delta-slow';
  return 'lap-delta-warn';
}

export default function LapTimesModule({
  lapTimes,
  fastIdx,
  onLapClick,
  excludedLaps,
  onToggleExcludeLap,
  hasExclusionDraft,
  onApplyExclusions,
  onDiscardExclusions,
  applyExclusionsPending,
}: LapTimesModuleProps) {
  if (!lapTimes.length) return <p className="muted">No lap times.</p>;

  const excludedSet = new Set(excludedLaps ?? [0]);

  let bestIdx = -1;
  let bestTime = Infinity;
  for (let i = 0; i < lapTimes.length; i++) {
    const seg = lapTimes[i].segment_index ?? i;
    if (excludedSet.has(seg)) continue;
    const t = lapTimes[i].time;
    if (t < bestTime) {
      bestTime = t;
      bestIdx = i;
    }
  }
  const analysisBest = bestIdx >= 0 ? bestTime : null;

  return (
    <>
      {hasExclusionDraft && onApplyExclusions && (
        <div className="lap-excl-actions">
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={onApplyExclusions}
            disabled={applyExclusionsPending}
          >
            {applyExclusionsPending ? 'Applying…' : 'Recalc metrics'}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={onDiscardExclusions}
            disabled={applyExclusionsPending}
          >
            Discard
          </button>
        </div>
      )}
      <table className="data-table data-table-sm lap-times-table">
        <thead>
          <tr>
            {onToggleExcludeLap && <th className="lap-excl-col" title="Exclude from analysis">Excl</th>}
            <th>Lap</th>
            <th>Time</th>
            <th>Δ vs best</th>
          </tr>
        </thead>
      <tbody>
        {lapTimes.map((lt, i) => {
          const segIdx = lt.segment_index ?? i;
          const excluded = excludedSet.has(segIdx);
          const delta = analysisBest != null ? lt.time - analysisBest : NaN;
          const isBest = analysisBest != null && i === bestIdx && Math.abs(delta) < 0.0005;
          const dotColor = LAP_DOT_PALETTE[i % LAP_DOT_PALETTE.length];
          return (
            <tr
              key={lt.lap}
              className={`${i === fastIdx ? 'row-fast ' : ''}${excluded ? 'lap-row-excluded ' : ''}${onLapClick ? 'lap-times-row-clickable' : ''}`}
              onClick={onLapClick ? () => onLapClick(lt.lap) : undefined}
            >
              {onToggleExcludeLap && (
                <td className="lap-excl-col" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={excluded}
                    title="Exclude lap from virtual best / averages"
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => onToggleExcludeLap(segIdx)}
                    aria-label={`Exclude lap ${lt.lap} from analysis`}
                  />
                </td>
              )}
              <td>
                <span className="lap-lap-cell">
                  <span className="lap-dot" style={{ backgroundColor: dotColor }} aria-hidden />
                  {lt.lap}
                </span>
              </td>
              <td>
                <span className={excluded ? 'lap-time-excluded' : undefined}>{fmtLapTime(lt.time)}</span>
              </td>
              <td className={deltaClass(delta, isBest && !excluded)}>
                {excluded || isBest || !Number.isFinite(delta) ? '—' : formatDelta(delta)}
              </td>
            </tr>
          );
        })}
      </tbody>
      </table>
    </>
  );
}
