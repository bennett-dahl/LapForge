import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch } from '../api/client';
import type { Plan, CarDriver, Weekend } from '../types/models';
import type { PlanBoardDataResponse, PlanCreateResponse, SettingsResponse } from '../types/api';
import { useDebouncedSave } from '../hooks/useDebouncedSave';
import { pressureLabel, tempLabel, type PressureUnit, type TempUnit } from '../utils/units';
import Button from '../components/ui/Button';
import PlanChecklist from '../components/plan/PlanChecklist';
import PlanPlanHeader from '../components/plan/PlanPlanHeader';
import PlanSessionTable from '../components/plan/PlanSessionTable';
import PlanBleedLedger from '../components/plan/PlanBleedLedger';
import PlanPressureCharts from '../components/plan/PlanPressureCharts';

const LS_PRESSURE = 'session_pressure_unit';
const LS_TEMP = 'session_temp_unit';

function readLsUnit<T extends string>(key: string, allowed: T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    if (v && allowed.includes(v)) return v;
  } catch { /* ignore */ }
  return fallback;
}

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

  const { data: weekendPlans = [], status: plansStatus } = useQuery({
    queryKey: ['weekend-plans', weekendId],
    queryFn: () => apiGet<(Plan & { car_driver_display?: string })[]>(`/api/weekends/${weekendId}/plans`),
    enabled: !!weekendId,
  });

  const currentPlan = weekendPlans.find(p => p.car_driver_id === carDriverId);
  const currentCar = carDrivers.find(cd => cd.id === carDriverId);

  // Only show "Create Plan" once the plans query has actually loaded (not while pending).
  // Using a derived value avoids the race where carDrivers resolves before weekendPlans,
  // causing needsCreate=true+currentCar=truthy to flash the "Create Plan" screen.
  const needsCreate = plansStatus !== 'pending' && !currentPlan && !!carDriverId;
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function handleCreatePlan() {
    if (!carDriverId || !weekendId) return;
    setCreateError(null);
    setCreating(true);
    try {
      const res = await apiPost<PlanCreateResponse>('/api/plans', {
        car_driver_id: carDriverId,
        weekend_id: weekendId,
      });
      qc.setQueryData<(Plan & { car_driver_display?: string })[]>(
        ['weekend-plans', weekendId],
        old => {
          if (!old) return [res.plan];
          if (old.some(p => p.id === res.plan.id)) return old;
          return [...old, res.plan];
        },
      );
      qc.invalidateQueries({ queryKey: ['weekend-plans', weekendId] });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('already exists')) {
        qc.invalidateQueries({ queryKey: ['weekend-plans', weekendId] });
      } else {
        setCreateError(msg || 'Failed to create plan');
      }
    } finally {
      setCreating(false);
    }
  }

  const { data: boardData, refetch: refetchBoard } = useQuery({
    queryKey: ['plan-board-data', currentPlan?.id],
    queryFn: () => apiGet<PlanBoardDataResponse>(`/api/plans/${currentPlan!.id}/board-data`),
    enabled: !!currentPlan?.id,
  });

  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const planSaveFn = useCallback(
    async (data: Partial<Plan>) => {
      if (!currentPlan?.id) return;
      await apiPatch(`/api/plans/${currentPlan.id}`, data);
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
      refetchTimerRef.current = setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['weekend-plans', weekendId] });
        qc.invalidateQueries({ queryKey: ['plan-board-data', currentPlan.id] });
      }, 2000);
    },
    [currentPlan?.id, weekendId, qc],
  );
  const { save: debouncedSave, status: saveStatus } = useDebouncedSave(planSaveFn);

  useEffect(() => {
    return () => { if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current); };
  }, []);

  const [panelCollapsed, setPanelCollapsed] = useState(() =>
    localStorage.getItem('plan_panel_collapsed') === '1',
  );

  function togglePanel() {
    const next = !panelCollapsed;
    setPanelCollapsed(next);
    localStorage.setItem('plan_panel_collapsed', next ? '1' : '0');
  }

  // ---- unit toggle state (shared localStorage keys with session page) ----
  const { data: settingsData } = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiGet<SettingsResponse>('/api/settings'),
  });

  const unitsHydrated = useRef(false);
  const [pressureUnit, setPressureUnitRaw] = useState<PressureUnit>(
    () => readLsUnit(LS_PRESSURE, ['psi', 'bar'], 'psi'),
  );
  const [tempUnit, setTempUnitRaw] = useState<TempUnit>(
    () => readLsUnit(LS_TEMP, ['c', 'f'], 'c'),
  );

  useEffect(() => {
    if (!settingsData?.preferences || unitsHydrated.current) return;
    unitsHydrated.current = true;
    if (!localStorage.getItem(LS_PRESSURE)) {
      const p = String(settingsData.preferences.default_pressure_unit ?? 'psi').toLowerCase();
      setPressureUnitRaw(p === 'bar' ? 'bar' : 'psi');
    }
    if (!localStorage.getItem(LS_TEMP)) {
      const t = String(settingsData.preferences.default_temp_unit ?? 'c').toLowerCase();
      setTempUnitRaw(t === 'f' ? 'f' : 'c');
    }
  }, [settingsData]);

  const setPressureUnit = useCallback((u: PressureUnit) => {
    setPressureUnitRaw(u);
    try { localStorage.setItem(LS_PRESSURE, u); } catch { /* ignore */ }
  }, []);
  const setTempUnit = useCallback((u: TempUnit) => {
    setTempUnitRaw(u);
    try { localStorage.setItem(LS_TEMP, u); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    document.title = weekend ? `LapForge - ${weekend.name}` : 'LapForge - Plan';
  }, [weekend]);

  const serverPlan = boardData?.plan ?? currentPlan;
  const sessions = boardData?.sessions ?? [];

  const [localOverride, setLocalOverride] = useState<Partial<Plan>>({});
  const prevBoardDataRef = useRef(boardData);
  if (boardData !== prevBoardDataRef.current) {
    prevBoardDataRef.current = boardData;
    if (Object.keys(localOverride).length > 0) {
      setLocalOverride({});
    }
  }

  const plan = useMemo(() => {
    if (!serverPlan) return serverPlan;
    if (Object.keys(localOverride).length === 0) return serverPlan;
    return { ...serverPlan, ...localOverride } as Plan;
  }, [serverPlan, localOverride]);

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
          <Button onClick={handleCreatePlan} disabled={creating}>
            {creating ? 'Creating...' : 'Create Plan'}
          </Button>
          {createError && (
            <p style={{ color: 'var(--danger)', fontSize: 13, margin: '8px 0 0' }}>{createError}</p>
          )}
        </div>
      </div>
    );
  }

  if (!plan) {
    return <div style={{ padding: 40, textAlign: 'center' }} className="text-muted">Loading plan...</div>;
  }

  function handlePlanFieldChange(fields: Partial<Plan>) {
    setLocalOverride(prev => ({ ...prev, ...fields }));
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

        <span style={{ fontSize: 12, color: 'var(--text-muted)', width: 70, textAlign: 'right' }}>
          {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved' : saveStatus === 'error' ? 'Save failed' : ''}
        </span>

        <div className="unit-toggle-group" role="group" aria-label="Pressure unit">
          <button type="button" className={`unit-toggle-btn${pressureUnit === 'psi' ? ' active' : ''}`} onClick={() => setPressureUnit('psi')}>
            {pressureLabel('psi').toUpperCase()}
          </button>
          <button type="button" className={`unit-toggle-btn${pressureUnit === 'bar' ? ' active' : ''}`} onClick={() => setPressureUnit('bar')}>
            {pressureLabel('bar').charAt(0).toUpperCase() + pressureLabel('bar').slice(1)}
          </button>
        </div>
        <div className="unit-toggle-group" role="group" aria-label="Temperature unit">
          <button type="button" className={`unit-toggle-btn${tempUnit === 'c' ? ' active' : ''}`} onClick={() => setTempUnit('c')}>
            {tempLabel('c')}
          </button>
          <button type="button" className={`unit-toggle-btn${tempUnit === 'f' ? ' active' : ''}`} onClick={() => setTempUnit('f')}>
            {tempLabel('f')}
          </button>
        </div>
      </div>

      {/* Split layout */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* Left panel: checklist + toggle rail */}
        <div style={{ display: 'flex', flexShrink: 0 }}>
          {!panelCollapsed && (
            <div className="plan-left-panel" style={{
              width: 304, overflowY: 'auto', padding: 16,
              display: 'flex', flexDirection: 'column', gap: 16,
            }}>
              <PlanChecklist
                plan={plan}
                carDriverId={carDriverId!}
                onUpdate={handlePlanFieldChange}
                refetchBoard={refetchBoard}
              />
            </div>
          )}
          <button
            onClick={togglePanel}
            title={panelCollapsed ? 'Open checklist' : 'Close checklist'}
            style={{
              width: 16, flexShrink: 0, padding: 0,
              background: 'transparent', border: 'none', borderRight: '1px solid var(--border)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--muted)', fontSize: 10, transition: 'background 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            {panelCollapsed ? '▸' : '◂'}
          </button>
        </div>

        {/* Right: board zones — analysis-first order */}
        <div className="plan-board" style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <PlanPlanHeader plan={plan} sessions={sessions} onChange={handlePlanFieldChange} pressureUnit={pressureUnit} tempUnit={tempUnit} />
          <PlanSessionTable
            plan={plan}
            sessions={sessions}
            pressureUnit={pressureUnit}
            onAddSession={(sid: string) => {
              const newIds = [...(plan.session_ids || []), sid];
              handlePlanFieldChange({ session_ids: newIds } as Partial<Plan>);
            }}
            onRemoveSession={(sid: string) => {
              const newIds = (plan.session_ids || []).filter(id => id !== sid);
              handlePlanFieldChange({ session_ids: newIds } as Partial<Plan>);
            }}
          />
          <PlanPressureCharts plan={plan} sessions={sessions} pressureUnit={pressureUnit} tempUnit={tempUnit} />
          <PlanBleedLedger sessions={sessions} refetchBoard={refetchBoard} pressureUnit={pressureUnit} />
        </div>
      </div>
    </div>
  );
}
