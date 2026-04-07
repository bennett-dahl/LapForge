import type { Plan, BoardSession, PlanPressures } from '../../types/models';

interface Props {
  plan: Plan;
  sessions: BoardSession[];
  onChange: (fields: Partial<Plan>) => void;
}

export default function PlanDecisionCards({ plan, sessions, onChange }: Props) {
  const mode = plan.planning_mode ?? 'race';
  const showQual = mode === 'qual';
  const showRace = mode === 'race';

  const stabilizationSession = sessions.find(s => s.planning_tag === 'stabilization');

  const tempDelta = {
    ambient: calcDelta(plan.current_ambient_temp_c, stabilizationSession?.ambient_temp_c, sessions),
    track: calcDelta(plan.current_track_temp_c, stabilizationSession?.track_temp_c, sessions),
  };

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr',
      gap: 12,
    }}>
      {showQual && (
        <DecisionCard
          title="Qual Plan"
          pressures={plan.qual_plan}
          onPressureChange={(v) => onChange({ qual_plan: v } as Partial<Plan>)}
          stat={formatAggregateStat(sessions, 'qual')}
          statLabel="Optimal sessions"
        />
      )}
      {showRace && (
        <DecisionCard
          title="Race Plan"
          pressures={plan.race_plan}
          onPressureChange={(v) => onChange({ race_plan: v } as Partial<Plan>)}
          stat={formatAggregateStat(sessions, 'race')}
          statLabel="Optimal sessions"
        >
          <div style={{ marginTop: 8, fontSize: 12, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
            <div style={{ display: 'flex', gap: 16, marginBottom: 6 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span className="text-muted">Ambient °C</span>
                <input
                  className="input"
                  type="number"
                  step="0.5"
                  style={{ width: 60 }}
                  value={plan.current_ambient_temp_c ?? ''}
                  placeholder={stabilizationSession?.ambient_temp_c?.toString() ?? '—'}
                  onChange={e => onChange({
                    current_ambient_temp_c: e.target.value ? parseFloat(e.target.value) : null,
                  } as Partial<Plan>)}
                />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span className="text-muted">Track °C</span>
                <input
                  className="input"
                  type="number"
                  step="0.5"
                  style={{ width: 60 }}
                  value={plan.current_track_temp_c ?? ''}
                  placeholder={stabilizationSession?.track_temp_c?.toString() ?? '—'}
                  onChange={e => onChange({
                    current_track_temp_c: e.target.value ? parseFloat(e.target.value) : null,
                  } as Partial<Plan>)}
                />
              </label>
            </div>
            {tempDelta.ambient.ref != null && (
              <div className="text-muted">
                Ref: {tempDelta.ambient.ref}°C / {tempDelta.track.ref}°C
                {tempDelta.ambient.delta != null && (
                  <span> → Δ {tempDelta.ambient.delta > 0 ? '+' : ''}{tempDelta.ambient.delta}°C ambient,{' '}
                    {tempDelta.track.delta != null ? `${tempDelta.track.delta > 0 ? '+' : ''}${tempDelta.track.delta}°C track` : '—'}
                  </span>
                )}
                {tempDelta.ambient.source && (
                  <span style={{ fontStyle: 'italic', marginLeft: 4 }}>({tempDelta.ambient.source})</span>
                )}
              </div>
            )}
          </div>
        </DecisionCard>
      )}
    </div>
  );
}

function DecisionCard({
  title, pressures, onPressureChange, stat, statLabel, children,
}: {
  title: string;
  pressures: PlanPressures;
  onPressureChange: (v: PlanPressures) => void;
  stat: string | null;
  statLabel: string;
  children?: React.ReactNode;
}) {
  function set(key: keyof PlanPressures, raw: string) {
    const num = raw === '' ? null : parseFloat(raw);
    onPressureChange({ ...pressures, [key]: isNaN(num as number) ? null : num });
  }

  return (
    <div className="card" style={{ padding: 12 }}>
      <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>{title}</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6 }}>
        {(['fl', 'fr', 'rl', 'rr'] as const).map(c => (
          <div key={c} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{c}</div>
            <input
              className="input"
              type="number"
              step="0.1"
              style={{ width: '100%', textAlign: 'center', fontWeight: 600 }}
              value={pressures[c] ?? ''}
              onChange={e => set(c, e.target.value)}
            />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, fontSize: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span className="text-muted">Target</span>
          <input
            className="input"
            type="number"
            step="0.1"
            style={{ width: 70, textAlign: 'center', fontWeight: 600 }}
            value={pressures.target ?? ''}
            onChange={e => set('target', e.target.value)}
          />
          <span className="text-muted">psi</span>
        </label>
        <span className="text-muted">{statLabel}: {stat ?? '—'}</span>
      </div>
      {children}
    </div>
  );
}

function formatAggregateStat(sessions: BoardSession[], mode: 'qual' | 'race'): string | null {
  if (sessions.length === 0) return null;
  const optimalCount = sessions.filter(s => {
    const band = mode === 'qual' ? s.qual_lap_band : s.race_lap_band;
    return band?.first_optimal_lap != null;
  }).length;
  return `${optimalCount}/${sessions.length}`;
}

function calcDelta(
  current: number | null | undefined,
  refVal: number | null | undefined,
  sessions: BoardSession[],
): { ref: number | null; delta: number | null; source: string | null } {
  let ref = refVal ?? null;
  let source: string | null = null;
  if (ref == null && sessions.length > 0) {
    const last = sessions[sessions.length - 1];
    ref = last.ambient_temp_c;
    source = `from ${last.label}`;
  }
  if (ref == null || current == null) return { ref, delta: null, source };
  return { ref, delta: Math.round((current - ref) * 10) / 10, source };
}
