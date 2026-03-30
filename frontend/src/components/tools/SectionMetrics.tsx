interface SectionMetric {
  name: string;
  min_speed?: number;
  max_speed?: number;
  avg_speed?: number;
  min_time?: number;
  max_time?: number;
  distance?: number;
}

interface SectionMetricsProps {
  metrics: SectionMetric[];
}

export default function SectionMetrics({ metrics }: SectionMetricsProps) {
  if (!metrics.length) return <p className="text-muted">No section metrics available.</p>;

  return (
    <table className="data-table data-table-sm">
      <thead>
        <tr>
          <th>Section</th>
          <th>Min Speed</th>
          <th>Max Speed</th>
          <th>Avg Speed</th>
          <th>Distance</th>
        </tr>
      </thead>
      <tbody>
        {metrics.map((m, i) => (
          <tr key={i}>
            <td>{m.name}</td>
            <td>{m.min_speed?.toFixed(1) ?? '—'}</td>
            <td>{m.max_speed?.toFixed(1) ?? '—'}</td>
            <td>{m.avg_speed?.toFixed(1) ?? '—'}</td>
            <td>{m.distance?.toFixed(0) ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
