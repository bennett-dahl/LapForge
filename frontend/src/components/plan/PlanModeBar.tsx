import type { Plan } from '../../types/models';

interface Props {
  plan: Plan;
  onChange: (fields: Partial<Plan>) => void;
}

export default function PlanModeBar({ plan, onChange }: Props) {
  const modes: Array<{ value: Plan['planning_mode']; label: string }> = [
    { value: 'qual', label: 'Qual' },
    { value: 'race', label: 'Race' },
  ];

  return (
    <div className="plan-mode-bar" style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px',
      background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)',
      flexWrap: 'wrap',
    }}>
      <div style={{ display: 'flex', gap: 2, background: 'var(--bg)', borderRadius: 6, padding: 2 }}>
        {modes.map(m => (
          <button
            key={m.value}
            onClick={() => onChange({ planning_mode: m.value } as Partial<Plan>)}
            style={{
              padding: '4px 14px', borderRadius: 5, fontSize: 13, cursor: 'pointer',
              border: 'none',
              background: plan.planning_mode === m.value ? 'var(--primary)' : 'transparent',
              color: plan.planning_mode === m.value ? '#fff' : 'var(--text)',
              fontWeight: plan.planning_mode === m.value ? 600 : 400,
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
        <span className="text-muted">Qual laps</span>
        <input
          className="input"
          type="number"
          min={1}
          style={{ width: 50 }}
          value={plan.qual_lap_range?.[0] ?? 2}
          onChange={e => onChange({
            qual_lap_range: [parseInt(e.target.value) || 2, plan.qual_lap_range?.[1] ?? 3],
          } as Partial<Plan>)}
        />
        <span>–</span>
        <input
          className="input"
          type="number"
          min={1}
          style={{ width: 50 }}
          value={plan.qual_lap_range?.[1] ?? 3}
          onChange={e => onChange({
            qual_lap_range: [plan.qual_lap_range?.[0] ?? 2, parseInt(e.target.value) || 3],
          } as Partial<Plan>)}
        />
      </label>

      <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
        <span className="text-muted">±</span>
        <input
          className="input"
          type="number"
          step="0.1"
          min={0}
          style={{ width: 60 }}
          value={plan.pressure_band_psi ?? 0.5}
          onChange={e => onChange({ pressure_band_psi: parseFloat(e.target.value) || 0.5 } as Partial<Plan>)}
        />
        <span className="text-muted">psi</span>
      </label>

      <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
        <span className="text-muted">Race stint</span>
        <input
          className="input"
          type="number"
          min={1}
          style={{ width: 50 }}
          value={plan.race_stint_lap_range?.[0] ?? 3}
          onChange={e => onChange({
            race_stint_lap_range: [parseInt(e.target.value) || 3, plan.race_stint_lap_range?.[1] ?? null],
          } as Partial<Plan>)}
        />
        <span>–</span>
        <input
          className="input"
          type="number"
          min={1}
          style={{ width: 50 }}
          value={plan.race_stint_lap_range?.[1] ?? ''}
          placeholder="end"
          onChange={e => {
            const v = e.target.value ? parseInt(e.target.value) : null;
            onChange({
              race_stint_lap_range: [plan.race_stint_lap_range?.[0] ?? 3, v],
            } as Partial<Plan>);
          }}
        />
      </label>
    </div>
  );
}
