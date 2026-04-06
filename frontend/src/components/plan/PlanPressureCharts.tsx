import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../api/client';
import type { Plan, BoardSession } from '../../types/models';

interface Props {
  plan: Plan;
  sessions: BoardSession[];
}

interface TelemetryData {
  id: string;
  times: number[];
  distances: number[];
  series: Record<string, (number | null)[]>;
  channel_meta: Record<string, { unit?: string; category?: string; display?: string }>;
  lap_splits: number[];
  lap_split_distances: number[];
  lap_times: Array<{ index: number; time: number }>;
  target_psi: number;
}

const PRESSURE_CHANNELS = ['tpms_press_fl', 'tpms_press_fr', 'tpms_press_rl', 'tpms_press_rr'];
const CORNER_COLORS: Record<string, string> = {
  tpms_press_fl: '#3b82f6',
  tpms_press_fr: '#ef4444',
  tpms_press_rl: '#10b981',
  tpms_press_rr: '#f59e0b',
};

export default function PlanPressureCharts({ plan, sessions }: Props) {
  const [expandedSecondary, setExpandedSecondary] = useState(false);

  if (sessions.length === 0) {
    return null;
  }

  return (
    <div>
      <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Pressure Charts</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {sessions.map(s => (
          <SessionChartBlock key={s.id} session={s} plan={plan} />
        ))}
      </div>

      <div style={{ marginTop: 16 }}>
        <button
          onClick={() => setExpandedSecondary(!expandedSecondary)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', fontSize: 13,
          }}
        >
          {expandedSecondary ? '▾ Hide' : '▸ Show'} secondary telemetry
        </button>
        {expandedSecondary && sessions.map(s => (
          <SecondaryChartBlock key={`sec-${s.id}`} sessionId={s.id} label={s.label} />
        ))}
      </div>
    </div>
  );
}

function SessionChartBlock({ session, plan }: { session: BoardSession; plan: Plan }) {
  const { data: telemetry, isLoading } = useQuery({
    queryKey: ['session-telemetry', session.id],
    queryFn: () => apiGet<TelemetryData>(`/api/sessions/${session.id}/telemetry`),
    staleTime: 5 * 60_000,
  });

  if (isLoading) {
    return (
      <div className="card" style={{ padding: 16, textAlign: 'center' }}>
        <span className="text-muted">Loading {session.label}...</span>
      </div>
    );
  }

  if (!telemetry) {
    return (
      <div className="card" style={{ padding: 12 }}>
        <span className="text-muted">{session.label} — no telemetry data</span>
      </div>
    );
  }

  const xKey = telemetry.distances?.length ? 'distances' : 'times';
  const xValues = xKey === 'distances' ? telemetry.distances : telemetry.times;
  const xLabel = xKey === 'distances' ? 'Distance (m)' : 'Time (s)';

  const pressureSeries = PRESSURE_CHANNELS
    .filter(ch => telemetry.series[ch])
    .map(ch => ({
      key: ch,
      data: telemetry.series[ch],
      color: CORNER_COLORS[ch] || '#888',
      label: ch.replace('tpms_press_', '').toUpperCase(),
    }));

  const targetPsi = telemetry.target_psi ?? plan.qual_plan?.target ?? plan.race_plan?.target;

  const lapSplitX = xKey === 'distances'
    ? (telemetry.lap_split_distances || [])
    : (telemetry.lap_splits || []);

  return (
    <div className="card" style={{ padding: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{session.label}</div>
      <MiniPressureChart
        xValues={xValues}
        series={pressureSeries}
        targetPsi={targetPsi ?? null}
        lapSplits={lapSplitX}
        xLabel={xLabel}
      />
    </div>
  );
}

function MiniPressureChart({
  xValues,
  series,
  targetPsi,
  lapSplits,
  xLabel,
}: {
  xValues: number[];
  series: Array<{ key: string; data: (number | null)[]; color: string; label: string }>;
  targetPsi: number | null;
  lapSplits: number[];
  xLabel?: string;
}) {
  void xLabel;
  const canvasHeight = 120;
  const canvasWidth = '100%';
  const margin = { top: 10, right: 40, bottom: 20, left: 40 };

  const allValues: number[] = [];
  for (const s of series) {
    for (const v of s.data) {
      if (v != null) allValues.push(v);
    }
  }
  if (targetPsi != null) allValues.push(targetPsi);

  if (allValues.length === 0 || xValues.length === 0) {
    return <div className="text-muted" style={{ fontSize: 12, padding: 8 }}>No pressure data</div>;
  }

  const yMin = Math.floor(Math.min(...allValues) - 1);
  const yMax = Math.ceil(Math.max(...allValues) + 1);
  const xMin = xValues[0];
  const xMax = xValues[xValues.length - 1];

  const w = 800;
  const plotW = w - margin.left - margin.right;
  const plotH = canvasHeight - margin.top - margin.bottom;

  function scaleX(v: number) { return margin.left + ((v - xMin) / (xMax - xMin || 1)) * plotW; }
  function scaleY(v: number) { return margin.top + ((yMax - v) / (yMax - yMin || 1)) * plotH; }

  const step = Math.max(1, Math.floor(xValues.length / 400));

  return (
    <svg viewBox={`0 0 ${w} ${canvasHeight}`} style={{ width: canvasWidth, height: canvasHeight }}>
      {/* Y axis labels */}
      {[yMin, (yMin + yMax) / 2, yMax].map(v => (
        <g key={v}>
          <line x1={margin.left} y1={scaleY(v)} x2={w - margin.right} y2={scaleY(v)} stroke="var(--border)" strokeWidth={0.5} />
          <text x={margin.left - 4} y={scaleY(v) + 3} fontSize={9} fill="var(--text-muted)" textAnchor="end">{v.toFixed(0)}</text>
        </g>
      ))}
      {/* Target line */}
      {targetPsi != null && (
        <g>
          <line x1={margin.left} y1={scaleY(targetPsi)} x2={w - margin.right} y2={scaleY(targetPsi)}
            stroke="#e74c3c" strokeWidth={1} strokeDasharray="4,3" />
          <text x={w - margin.right + 2} y={scaleY(targetPsi) + 3} fontSize={8} fill="#e74c3c">
            {targetPsi}
          </text>
        </g>
      )}
      {/* Lap splits */}
      {lapSplits.map((ls, i) => (
        <line key={i} x1={scaleX(ls)} y1={margin.top} x2={scaleX(ls)} y2={canvasHeight - margin.bottom}
          stroke="var(--border)" strokeWidth={0.5} strokeDasharray="2,2" />
      ))}
      {/* Pressure lines */}
      {series.map(s => {
        const points: string[] = [];
        for (let i = 0; i < Math.min(xValues.length, s.data.length); i += step) {
          const v = s.data[i];
          if (v != null) {
            points.push(`${scaleX(xValues[i])},${scaleY(v)}`);
          }
        }
        return (
          <g key={s.key}>
            <polyline points={points.join(' ')} fill="none" stroke={s.color} strokeWidth={1.2} />
            <text x={w - margin.right + 2} y={scaleY(s.data[s.data.length - 1] ?? yMin) + 3}
              fontSize={8} fill={s.color}>{s.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

function SecondaryChartBlock({ sessionId, label }: { sessionId: string; label: string }) {
  const { data: telemetry } = useQuery({
    queryKey: ['session-telemetry', sessionId],
    queryFn: () => apiGet<TelemetryData>(`/api/sessions/${sessionId}/telemetry`),
    staleTime: 5 * 60_000,
  });

  if (!telemetry) return null;

  const secondaryChannels = Object.keys(telemetry.series)
    .filter(ch => !PRESSURE_CHANNELS.includes(ch))
    .slice(0, 4);

  if (secondaryChannels.length === 0) return null;

  return (
    <div className="card" style={{ padding: 12, marginTop: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{label} — Secondary</div>
      <div className="text-muted" style={{ fontSize: 11 }}>
        Channels: {secondaryChannels.join(', ')}
      </div>
    </div>
  );
}
