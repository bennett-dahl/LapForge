import { useState } from 'react';
import type { Plan, BoardSession, PlanPressures } from '../../types/models';
import { convertPressure, pressureDecimals, pressureLabel, tempLabel, type PressureUnit, type TempUnit } from '../../utils/units';

interface Props {
  plan: Plan;
  sessions: BoardSession[];
  onChange: (fields: Partial<Plan>) => void;
  pressureUnit: PressureUnit;
  tempUnit: TempUnit;
}

const CORNERS = ['fl', 'fr', 'rl', 'rr'] as const;

export default function PlanPlanHeader({ plan, sessions, onChange, pressureUnit, tempUnit }: Props) {
  const mode = plan.planning_mode ?? 'race';
  const [collapsed, setCollapsed] = useState(() =>
    localStorage.getItem('plan_header_collapsed') === '1',
  );

  function toggleCollapse() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('plan_header_collapsed', next ? '1' : '0');
  }

  function setMode(m: 'qual' | 'race') {
    onChange({ planning_mode: m } as Partial<Plan>);
  }

  const pressures: PlanPressures = mode === 'qual' ? plan.qual_plan : plan.race_plan;
  const lapRange = mode === 'qual' ? plan.qual_lap_range : plan.race_stint_lap_range;
  const dec = pressureDecimals(pressureUnit);
  const cv = (v: number) => convertPressure(v, 'psi', pressureUnit);
  const displayRound = (v: number) => parseFloat(cv(v).toFixed(dec));

  const acceptableSym = pressures.acceptable_band_psi ?? plan.pressure_band_psi ?? 0.5;
  const optimalSym = pressures.optimal_band_psi ?? 0.25;
  const acceptableUpper = pressures.acceptable_upper_psi ?? acceptableSym;
  const acceptableLower = pressures.acceptable_lower_psi ?? acceptableSym;
  const optimalUpper = pressures.optimal_upper_psi ?? optimalSym;
  const optimalLower = pressures.optimal_lower_psi ?? optimalSym;

  const optimalCount = sessions.filter(s => {
    const band = mode === 'qual' ? s.qual_lap_band : s.race_lap_band;
    return band?.first_optimal_lap != null;
  }).length;

  function setPressureField(key: keyof PlanPressures, raw: string) {
    const num = raw === '' ? null : parseFloat(raw);
    const psi = num != null && !isNaN(num) ? convertPressure(num, pressureUnit, 'psi') : null;
    const updated = { ...pressures, [key]: psi };
    onChange({ [mode === 'qual' ? 'qual_plan' : 'race_plan']: updated } as Partial<Plan>);
  }

  function setLapRange(start: number, end: number | null) {
    if (mode === 'qual') {
      onChange({ qual_lap_range: [start, end ?? 3] } as Partial<Plan>);
    } else {
      onChange({ race_stint_lap_range: [start, end] } as Partial<Plan>);
    }
  }

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 8,
      background: 'rgba(255,255,255,0.04)', overflow: 'hidden',
      flexShrink: 0,
    }}>
      {/* Always-visible strip */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
        background: 'rgba(255,255,255,0.03)',
        borderBottom: collapsed ? 'none' : '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', gap: 2, background: 'var(--bg)', borderRadius: 6, padding: 2 }}>
          {(['qual', 'race'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                padding: '4px 16px', borderRadius: 5, fontSize: 13, cursor: 'pointer',
                border: 'none',
                background: mode === m ? 'var(--primary)' : 'transparent',
                color: mode === m ? '#fff' : 'var(--text)',
                fontWeight: mode === m ? 600 : 400,
              }}
            >
              {m === 'qual' ? 'Qual' : 'Race'}
            </button>
          ))}
        </div>

        <span className="text-muted" style={{ fontSize: 12, flex: 1 }}>
          {mode === 'qual' ? 'Qualifying focus' : 'Race focus'}
          {sessions.length > 0 && ` — ${optimalCount}/${sessions.length} in optimal`}
        </span>

        <button
          onClick={toggleCollapse}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', fontSize: 16, padding: '2px 6px',
          }}
          title={collapsed ? 'Expand plan details' : 'Collapse'}
        >
          {collapsed ? '▸' : '▾'}
        </button>
      </div>

      {/* Collapsible body */}
      {!collapsed && (
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--bg, #1a1a1e)' }}>
          {/* Decision card for active mode */}
          <div>
            <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>
              {mode === 'qual' ? 'Qual Plan' : 'Race Plan'}
            </h3>

            {/* Corner pressures */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6 }}>
              {CORNERS.map(c => (
                <div key={c} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{c}</div>
                  <input
                    className="input"
                    type="number"
                    step={pressureUnit === 'bar' ? '0.01' : '0.1'}
                    style={{ width: '100%', textAlign: 'center', fontWeight: 600 }}
                    value={pressures[c] != null ? displayRound(pressures[c]!) : ''}
                    onChange={e => setPressureField(c, e.target.value)}
                  />
                </div>
              ))}
            </div>

            {/* Target + Notes */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, fontSize: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span className="text-muted">Target</span>
                <input
                  className="input"
                  type="number"
                  step={pressureUnit === 'bar' ? '0.01' : '0.1'}
                  style={{ width: 70, textAlign: 'center', fontWeight: 600 }}
                  value={pressures.target != null ? displayRound(pressures.target) : ''}
                  onChange={e => setPressureField('target', e.target.value)}
                />
                <span className="text-muted">{pressureLabel(pressureUnit)}</span>
              </label>
            </div>
          </div>

          {/* Lap range + Tolerances row */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
            padding: '8px 0', borderTop: '1px solid var(--border)', fontSize: 13,
          }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span className="text-muted">{mode === 'qual' ? 'Qual laps' : 'Race stint'}</span>
              <input
                className="input"
                type="number"
                min={1}
                style={{ width: 50 }}
                value={lapRange?.[0] ?? (mode === 'qual' ? 2 : 3)}
                onChange={e => setLapRange(
                  parseInt(e.target.value) || (mode === 'qual' ? 2 : 3),
                  lapRange?.[1] ?? (mode === 'qual' ? 3 : null),
                )}
              />
              <span>–</span>
              <input
                className="input"
                type="number"
                min={1}
                style={{ width: 50 }}
                value={lapRange?.[1] ?? ''}
                placeholder={mode === 'race' ? 'end' : undefined}
                onChange={e => {
                  const v = e.target.value ? parseInt(e.target.value) : null;
                  setLapRange(lapRange?.[0] ?? (mode === 'qual' ? 2 : 3), v);
                }}
              />
            </label>

            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span className="text-muted">Acceptable</span>
              <span className="text-muted" style={{ fontSize: 11 }}>+</span>
              <input
                className="input"
                type="number"
                step={pressureUnit === 'bar' ? '0.01' : '0.1'}
                min={0}
                style={{ width: 50 }}
                value={displayRound(acceptableUpper)}
                onChange={e => setPressureField('acceptable_upper_psi', e.target.value)}
              />
              <span className="text-muted" style={{ fontSize: 11 }}>−</span>
              <input
                className="input"
                type="number"
                step={pressureUnit === 'bar' ? '0.01' : '0.1'}
                min={0}
                style={{ width: 50 }}
                value={displayRound(acceptableLower)}
                onChange={e => setPressureField('acceptable_lower_psi', e.target.value)}
              />
              <span className="text-muted">{pressureLabel(pressureUnit)}</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span className="text-muted">Optimal</span>
              <span className="text-muted" style={{ fontSize: 11 }}>+</span>
              <input
                className="input"
                type="number"
                step={pressureUnit === 'bar' ? '0.01' : '0.05'}
                min={0}
                style={{ width: 50 }}
                value={displayRound(optimalUpper)}
                onChange={e => setPressureField('optimal_upper_psi', e.target.value)}
              />
              <span className="text-muted" style={{ fontSize: 11 }}>−</span>
              <input
                className="input"
                type="number"
                step={pressureUnit === 'bar' ? '0.01' : '0.05'}
                min={0}
                style={{ width: 50 }}
                value={displayRound(optimalLower)}
                onChange={e => setPressureField('optimal_lower_psi', e.target.value)}
              />
              <span className="text-muted">{pressureLabel(pressureUnit)}</span>
            </div>
          </div>

          <TempDeltaSection plan={plan} sessions={sessions} onChange={onChange} tempUnit={tempUnit} />
        </div>
      )}
    </div>
  );
}

function TempDeltaSection({
  plan, sessions, onChange, tempUnit,
}: {
  plan: Plan;
  sessions: BoardSession[];
  onChange: (fields: Partial<Plan>) => void;
  tempUnit: TempUnit;
}) {
  const stabilizationSession = sessions.find(s => s.planning_tag === 'stabilization');

  function calcDelta(
    current: number | null | undefined,
    refVal: number | null | undefined,
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

  const tempDelta = {
    ambient: calcDelta(plan.current_ambient_temp_c, stabilizationSession?.ambient_temp_c),
    track: calcDelta(plan.current_track_temp_c, stabilizationSession?.track_temp_c),
  };

  const WEATHER_OPTIONS = ['Clear', 'Mixed', 'Overcast', 'Light Rain', 'Med Rain', 'Heavy Rain'];

  return (
    <div style={{ fontSize: 12, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
      <div style={{ display: 'flex', gap: 16, marginBottom: 6, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span className="text-muted">Ambient {tempLabel(tempUnit)}</span>
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
          <span className="text-muted">Track {tempLabel(tempUnit)}</span>
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
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span className="text-muted">Weather</span>
          <select
            className="input"
            style={{ width: 120 }}
            value={plan.current_weather_condition ?? ''}
            onChange={e => onChange({
              current_weather_condition: e.target.value || null,
            } as Partial<Plan>)}
          >
            <option value="">—</option>
            {WEATHER_OPTIONS.map(w => (
              <option key={w} value={w}>{w}</option>
            ))}
          </select>
        </label>
      </div>
      {tempDelta.ambient.ref != null && (
        <div className="text-muted">
          Ref: {tempDelta.ambient.ref}{tempLabel(tempUnit)} / {tempDelta.track.ref}{tempLabel(tempUnit)}
          {tempDelta.ambient.delta != null && (
            <span> → Δ {tempDelta.ambient.delta > 0 ? '+' : ''}{tempDelta.ambient.delta}{tempLabel(tempUnit)} ambient,{' '}
              {tempDelta.track.delta != null ? `${tempDelta.track.delta > 0 ? '+' : ''}${tempDelta.track.delta}${tempLabel(tempUnit)} track` : '—'}
            </span>
          )}
          {tempDelta.ambient.source && (
            <span style={{ fontStyle: 'italic', marginLeft: 4 }}>({tempDelta.ambient.source})</span>
          )}
        </div>
      )}
    </div>
  );
}
