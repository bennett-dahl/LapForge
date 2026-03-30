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
}

interface LapTimesModuleProps {
  lapTimes: LapTime[];
  fastIdx: number | null;
  onLapClick?: (lap: number) => void;
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

export default function LapTimesModule({ lapTimes, fastIdx, onLapClick }: LapTimesModuleProps) {
  if (!lapTimes.length) return <p className="muted">No lap times.</p>;

  let bestIdx = 0;
  let bestTime = lapTimes[0].time;
  for (let i = 1; i < lapTimes.length; i++) {
    if (lapTimes[i].time < bestTime) {
      bestTime = lapTimes[i].time;
      bestIdx = i;
    }
  }

  return (
    <table className="data-table data-table-sm lap-times-table">
      <thead>
        <tr>
          <th>Lap</th>
          <th>Time</th>
          <th>Δ vs best</th>
        </tr>
      </thead>
      <tbody>
        {lapTimes.map((lt, i) => {
          const delta = lt.time - bestTime;
          const isBest = i === bestIdx || delta < 0.0005;
          const dotColor = LAP_DOT_PALETTE[i % LAP_DOT_PALETTE.length];
          return (
            <tr
              key={lt.lap}
              className={`${i === fastIdx ? 'row-fast ' : ''}${onLapClick ? 'lap-times-row-clickable' : ''}`}
              onClick={onLapClick ? () => onLapClick(lt.lap) : undefined}
              role={onLapClick ? 'button' : undefined}
              tabIndex={onLapClick ? 0 : undefined}
              onKeyDown={
                onLapClick
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onLapClick(lt.lap);
                      }
                    }
                  : undefined
              }
            >
              <td>
                <span className="lap-lap-cell">
                  <span className="lap-dot" style={{ backgroundColor: dotColor }} aria-hidden />
                  {lt.lap}
                </span>
              </td>
              <td>{fmtLapTime(lt.time)}</td>
              <td className={deltaClass(delta, isBest)}>
                {isBest ? '—' : formatDelta(delta)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
