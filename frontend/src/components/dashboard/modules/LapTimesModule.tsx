interface LapTime {
  lap: number;
  time: number;
  fast?: boolean;
}

interface LapTimesModuleProps {
  lapTimes: LapTime[];
  fastIdx: number | null;
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(3);
  return m > 0 ? `${m}:${sec.padStart(6, '0')}` : `${sec}s`;
}

export default function LapTimesModule({ lapTimes, fastIdx }: LapTimesModuleProps) {
  if (!lapTimes.length) return <p className="text-muted">No lap times.</p>;

  return (
    <table className="data-table data-table-sm">
      <thead><tr><th>Lap</th><th>Time</th></tr></thead>
      <tbody>
        {lapTimes.map((lt, i) => (
          <tr key={lt.lap} className={i === fastIdx ? 'row-fast' : ''}>
            <td>{lt.lap}</td>
            <td>{fmtTime(lt.time)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
