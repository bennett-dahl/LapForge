import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch } from '../api/client';
import type { Plan, CarDriver, Weekend, PlanPressures } from '../types/models';
import type { PlanBoardDataResponse, PlanCreateResponse } from '../types/api';
import { useDebouncedSave } from '../hooks/useDebouncedSave';
import Button from '../components/ui/Button';
import PlanChecklist from '../components/plan/PlanChecklist';
import PlanModeBar from '../components/plan/PlanModeBar';
import PlanDecisionCards from '../components/plan/PlanDecisionCards';
import PlanSessionTable from '../components/plan/PlanSessionTable';
import PlanBleedLedger from '../components/plan/PlanBleedLedger';
import PlanPressureCharts from '../components/plan/PlanPressureCharts';

export default function PlanPage() {
  const { weekendId, carDriverId } = useParams<{ weekendId: string; carDriverId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  useEffect(() => {
    if (weekendId) localStorage.setItem('plan_last_weekend_id', weekendId);
    if (carDriverId) localStorage.setItem('plan_last_car_driver_id', carDriverId);
  }, [weekendId, carDriverId]);

  const { data: weekend } = useQuery({
    queryKey: ['weekend', weekendId],
    queryFn: () => apiGet<Weekend>(`/api/weekends/${weekendId}`).catch(() => null),
    enabled: !!weekendId,
  });

  const { data: allWeekends = [] } = useQuery({
    queryKey: ['weekends'],
    queryFn: () => apiGet<Weekend[]>('/api/weekends'),
  });

  const { data: carDrivers = [] } = useQuery({
    queryKey: ['car-drivers'],
    queryFn: () => apiGet<CarDriver[]>('/api/car-drivers'),
  });

  const { data: weekendPlans = [] } = useQuery({
    queryKey: ['weekend-plans', weekendId],
    queryFn: () => apiGet<(Plan & { car_driver_display?: string })[]>(`/api/weekends/${weekendId}/plans`),
    enabled: !!weekendId,
  });

  const currentPlan = weekendPlans.find(p => p.car_driver_id === carDriverId);
  const currentCar = carDrivers.find(cd => cd.id === carDriverId);

  const [needsCreate, setNeedsCreate] = useState(false);

  useEffect(() => {
    if (weekendPlans.length > 0 && !currentPlan && carDriverId) {
      setNeedsCreate(true);
    } else if (weekendPlans.length === 0 && carDriverId) {
      setNeedsCreate(true);
    } else {
      setNeedsCreate(false);
    }
  }, [weekendPlans, currentPlan, carDriverId]);

  async function handleCreatePlan() {
    if (!carDriverId || !weekendId) return;
    try {
      await apiPost<PlanCreateResponse>('/api/plans', {
        car_driver_id: carDriverId,
        weekend_id: weekendId,
      });
      qc.invalidateQueries({ queryKey: ['weekend-plans', weekendId] });
      setNeedsCreate(false);
    } catch {}
  }

  const { data: boardData, refetch: refetchBoard } = useQuery({
    queryKey: ['plan-board-data', currentPlan?.id],
    queryFn: () => apiGet<PlanBoardDataResponse>(`/api/plans/${currentPlan!.id}/board-data`),
    enabled: !!currentPlan?.id,
  });

  const planSaveFn = useCallback(
    async (data: Partial<Plan>) => {
      if (!currentPlan?.id) return;
      await apiPatch(`/api/plans/${currentPlan.id}`, data);
      qc.invalidateQueries({ queryKey: ['weekend-plans', weekendId] });
      qc.invalidateQueries({ queryKey: ['plan-board-data', currentPlan.id] });
    },
    [currentPlan?.id, weekendId, qc],
  );
  const { save: debouncedSave, status: saveStatus } = useDebouncedSave(planSaveFn);

  const [panelCollapsed, setPanelCollapsed] = useState(() =>
    localStorage.getItem('plan_panel_collapsed') === '1',
  );

  function togglePanel() {
    const next = !panelCollapsed;
    setPanelCollapsed(next);
    localStorage.setItem('plan_panel_collapsed', next ? '1' : '0');
  }

  useEffect(() => {
    document.title = weekend ? `LapForge - ${weekend.name}` : 'LapForge - Plan';
  }, [weekend]);

  const plan = boardData?.plan ?? currentPlan;
  const sessions = boardData?.sessions ?? [];

  if (needsCreate && currentCar) {
    return (
      <div style={{ maxWidth: 500, margin: '60px auto', textAlign: 'center' }}>
        <div className="card" style={{ padding: 24 }}>
          <h2 style={{ margin: '0 0 12px' }}>
            Start planning for {currentCar.car_identifier} / {currentCar.driver_name}?
          </h2>
          <p className="text-muted" style={{ margin: '0 0 16px' }}>
            at {weekend?.name || 'this weekend'}
          </p>
          <Button onClick={handleCreatePlan}>Create Plan</Button>
        </div>
      </div>
    );
  }

  if (!plan) {
    return <div style={{ padding: 40, textAlign: 'center' }} className="text-muted">Loading plan...</div>;
  }

  function handlePlanFieldChange(fields: Partial<Plan>) {
    debouncedSave(fields);
  }

  return (
    <div className="plan-page" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Context bar */}
      <div className="plan-context-bar" style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px',
        borderBottom: '1px solid var(--border)', background: 'var(--surface)',
        flexShrink: 0,
      }}>
        <select
          className="input"
          style={{ width: 200 }}
          value={weekendId}
          onChange={e => navigate(`/plan/${e.target.value}/${carDriverId}`)}
        >
          {allWeekends.map(w => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>

        <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
          {weekendPlans.map(p => {
            const cd = carDrivers.find(c => c.id === p.car_driver_id);
            const isActive = p.car_driver_id === carDriverId;
            return (
              <button
                key={p.id}
                onClick={() => navigate(`/plan/${weekendId}/${p.car_driver_id}`)}
                style={{
                  padding: '4px 12px', borderRadius: 16, fontSize: 13, cursor: 'pointer',
                  border: `1px solid ${isActive ? 'var(--primary)' : 'var(--border)'}`,
                  background: isActive ? 'var(--primary)' : 'transparent',
                  color: isActive ? '#fff' : 'var(--text)',
                  fontWeight: isActive ? 600 : 400,
                }}
              >
                {cd ? `${cd.car_identifier} ${cd.driver_name}` : p.car_driver_id}
              </button>
            );
          })}
        </div>

        <Link to={`/car-drivers?return=/plan/${weekendId}`} style={{ fontSize: 13, marginLeft: 4, color: 'var(--text-muted)' }}>
          + car
        </Link>

        <div style={{ flex: 1 }} />

        <span style={{ fontSize: 12, color: 'var(--text-muted)', marginRight: 8 }}>
          {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved' : saveStatus === 'error' ? 'Save failed' : ''}
        </span>

        <button
          onClick={togglePanel}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 18, padding: '2px 6px' }}
          title={panelCollapsed ? 'Expand checklist' : 'Collapse checklist'}
        >
          {panelCollapsed ? '☰' : '◀'}
        </button>
      </div>

      {/* Split layout */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* Left panel: checklist + plan fields */}
        {!panelCollapsed && (
          <div className="plan-left-panel" style={{
            width: 320, flexShrink: 0, borderRight: '1px solid var(--border)',
            overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16,
          }}>
            <PlanChecklist
              plan={plan}
              carDriverId={carDriverId!}
              onUpdate={handlePlanFieldChange}
              refetchBoard={refetchBoard}
            />

            <div>
              <h4 style={{ margin: '0 0 8px', fontSize: 13, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                Qual Plan
              </h4>
              <PressureFields
                values={plan.qual_plan}
                onChange={(v) => handlePlanFieldChange({ qual_plan: v } as Partial<Plan>)}
              />
            </div>

            <div>
              <h4 style={{ margin: '0 0 8px', fontSize: 13, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                Race Plan
              </h4>
              <PressureFields
                values={plan.race_plan}
                onChange={(v) => handlePlanFieldChange({ race_plan: v } as Partial<Plan>)}
              />
            </div>
          </div>
        )}

        {/* Right: board zones */}
        <div className="plan-board" style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <PlanModeBar plan={plan} onChange={handlePlanFieldChange} />
          <PlanDecisionCards plan={plan} sessions={sessions} onChange={handlePlanFieldChange} />
          <PlanSessionTable
            plan={plan}
            sessions={sessions}
            onAddSession={(sid: string) => {
              const newIds = [...(plan.session_ids || []), sid];
              handlePlanFieldChange({ session_ids: newIds } as Partial<Plan>);
            }}
            onRemoveSession={(sid: string) => {
              const newIds = (plan.session_ids || []).filter(id => id !== sid);
              handlePlanFieldChange({ session_ids: newIds } as Partial<Plan>);
            }}
          />
          <PlanBleedLedger sessions={sessions} refetchBoard={refetchBoard} />
          <PlanPressureCharts plan={plan} sessions={sessions} />
        </div>
      </div>
    </div>
  );
}

function PressureFields({ values, onChange }: {
  values: PlanPressures;
  onChange: (v: PlanPressures) => void;
}) {
  function set(corner: keyof PlanPressures, raw: string) {
    const num = raw === '' ? null : parseFloat(raw);
    onChange({ ...values, [corner]: isNaN(num as number) ? null : num });
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
      {(['fl', 'fr', 'rl', 'rr'] as const).map(c => (
        <label key={c} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{c}</span>
          <input
            className="input"
            type="number"
            step="0.1"
            style={{ width: '100%' }}
            value={values[c] ?? ''}
            onChange={e => set(c, e.target.value)}
          />
        </label>
      ))}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Target</span>
        <input
          className="input"
          type="number"
          step="0.1"
          style={{ width: '100%' }}
          value={values.target ?? ''}
          onChange={e => set('target', e.target.value)}
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 2, gridColumn: '1 / -1' }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Notes</span>
        <input
          className="input"
          value={values.notes ?? ''}
          onChange={e => onChange({ ...values, notes: e.target.value })}
        />
      </label>
    </div>
  );
}
