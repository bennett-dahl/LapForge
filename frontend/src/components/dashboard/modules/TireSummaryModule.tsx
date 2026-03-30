interface TireSummaryModuleProps {
  summary?: Record<string, unknown>;
  target?: number | null;
}

interface CornerData {
  avg: number | null;
  min: number | null;
  max: number | null;
  start: number | null;
  end: number | null;
}

export default function TireSummaryModule({ summary, target }: TireSummaryModuleProps) {
  if (!summary) return <p className="text-muted">No tire pressure data.</p>;

  const corners = ['fl', 'fr', 'rl', 'rr'];
  const labels = { fl: 'Front Left', fr: 'Front Right', rl: 'Rear Left', rr: 'Rear Right' };

  return (
    <div className="tire-summary">
      <table className="data-table data-table-sm">
        <thead>
          <tr>
            <th>Corner</th><th>Start</th><th>End</th><th>Min</th><th>Max</th><th>Avg</th>
            {target != null && <th>Target</th>}
          </tr>
        </thead>
        <tbody>
          {corners.map((c) => {
            const d = (summary[c] as CornerData) || {} as CornerData;
            return (
              <tr key={c}>
                <td>{labels[c as keyof typeof labels]}</td>
                <td>{d.start?.toFixed(1) ?? '—'}</td>
                <td>{d.end?.toFixed(1) ?? '—'}</td>
                <td>{d.min?.toFixed(1) ?? '—'}</td>
                <td>{d.max?.toFixed(1) ?? '—'}</td>
                <td>{d.avg?.toFixed(1) ?? '—'}</td>
                {target != null && <td>{target.toFixed(1)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
