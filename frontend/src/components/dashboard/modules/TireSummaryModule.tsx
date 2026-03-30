import { convertPressure, pressureLabel, type PressureUnit } from '../../../utils/units';

interface TireSummaryModuleProps {
  summary?: Record<string, unknown>;
  target?: number | null;
  /** Dashboard tire summary / target are stored in PSI. */
  pressureUnit?: PressureUnit;
}

interface CornerData {
  avg: number | null;
  min: number | null;
  max: number | null;
  start: number | null;
  end: number | null;
}

const CORNER_COLORS: Record<string, string> = {
  fl: '#3b82f6',
  fr: '#ef4444',
  rl: '#22c55e',
  rr: '#f59e0b',
};

function fmtPsiToDisplay(v: number | null | undefined, pressureUnit: PressureUnit): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const n = convertPressure(v, 'psi', pressureUnit);
  return n.toFixed(1);
}

export default function TireSummaryModule({
  summary,
  target,
  pressureUnit = 'psi',
}: TireSummaryModuleProps) {
  if (!summary) return <p className="muted">No tire pressure data.</p>;

  const corners = ['fl', 'fr', 'rl', 'rr'] as const;
  const labels = { fl: 'Front Left', fr: 'Front Right', rl: 'Rear Left', rr: 'Rear Right' };
  const unitHdr = `(${pressureLabel(pressureUnit)})`;

  const lapsOverRaw = summary.laps_over_target;
  const lapsOverCount = Array.isArray(lapsOverRaw) ? lapsOverRaw.length : 0;

  return (
    <div className="tire-summary">
      <div className="tire-summary-global-strip" aria-label="Session pressure range by corner">
        {corners.map((c) => {
          const d = (summary[c] as CornerData) || ({} as CornerData);
          const lo = d.min;
          const hi = d.max;
          if (lo == null || hi == null || !Number.isFinite(lo) || !Number.isFinite(hi)) {
            return (
              <div key={c} className="tire-summary-global-chip" style={{ borderColor: CORNER_COLORS[c] }}>
                <span className="tire-summary-global-corner" style={{ color: CORNER_COLORS[c] }}>
                  {c.toUpperCase()}
                </span>
                <span className="muted">—</span>
              </div>
            );
          }
          return (
            <div key={c} className="tire-summary-global-chip" style={{ borderColor: CORNER_COLORS[c] }}>
              <span className="tire-summary-global-corner" style={{ color: CORNER_COLORS[c] }}>
                {c.toUpperCase()}
              </span>
              <span>
                {fmtPsiToDisplay(lo, pressureUnit)} – {fmtPsiToDisplay(hi, pressureUnit)} {pressureLabel(pressureUnit)}
              </span>
            </div>
          );
        })}
      </div>

      {target != null && lapsOverCount > 0 && (
        <p className="tire-summary-warn" role="status">
          {lapsOverCount} lap{lapsOverCount === 1 ? '' : 's'} with peak pressure over target (
          {fmtPsiToDisplay(target, pressureUnit)} {pressureLabel(pressureUnit)})
        </p>
      )}

      <table className="data-table data-table-sm tire-summary-table">
        <thead>
          <tr>
            <th>Corner</th>
            <th>Start {unitHdr}</th>
            <th>End {unitHdr}</th>
            <th>Min {unitHdr}</th>
            <th>Max {unitHdr}</th>
            <th>Avg {unitHdr}</th>
            {target != null && <th>Target {unitHdr}</th>}
          </tr>
        </thead>
        <tbody>
          {corners.map((c) => {
            const d = (summary[c] as CornerData) || ({} as CornerData);
            return (
              <tr key={c}>
                <td>
                  <span className="tire-corner-label">
                    <span className="tire-corner-dot" style={{ backgroundColor: CORNER_COLORS[c] }} aria-hidden />
                    {labels[c]}
                  </span>
                </td>
                <td>{fmtPsiToDisplay(d.start, pressureUnit)}</td>
                <td>{fmtPsiToDisplay(d.end, pressureUnit)}</td>
                <td>{fmtPsiToDisplay(d.min, pressureUnit)}</td>
                <td>{fmtPsiToDisplay(d.max, pressureUnit)}</td>
                <td>{fmtPsiToDisplay(d.avg, pressureUnit)}</td>
                {target != null && <td>{fmtPsiToDisplay(target, pressureUnit)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
