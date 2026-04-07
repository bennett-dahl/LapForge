import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../api/client';
import type { CarDriver, Plan } from '../types/models';
import type { PlanCreateResponse } from '../types/api';
import Button from '../components/ui/Button';

export default function PlanRedirect() {
  const { weekendId } = useParams<{ weekendId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: plans, isPending: plansPending } = useQuery({
    queryKey: ['weekend-plans', weekendId],
    queryFn: () => apiGet<(Plan & { car_driver_display?: string })[]>(`/api/weekends/${weekendId}/plans`),
    enabled: !!weekendId,
  });

  const { data: carDrivers, isPending: carDriversPending } = useQuery({
    queryKey: ['car-drivers'],
    queryFn: () => apiGet<CarDriver[]>('/api/car-drivers'),
  });

  const plansLoaded = plans ?? [];
  const carsLoaded = carDrivers ?? [];

  const lastCarId = localStorage.getItem('plan_last_car_driver_id');

  useEffect(() => {
    if (!weekendId || !plans) return;
    if (plans.length === 1) {
      navigate(`/plan/${weekendId}/${plans[0].car_driver_id}`, { replace: true });
      return;
    }
    if (plans.length > 1 && lastCarId) {
      const match = plans.find(p => p.car_driver_id === lastCarId);
      if (match) {
        navigate(`/plan/${weekendId}/${match.car_driver_id}`, { replace: true });
        return;
      }
    }
  }, [weekendId, plans, lastCarId, navigate]);

  const [newCar, setNewCar] = useState('');
  const [newDriver, setNewDriver] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createCarAndPlan() {
    if (!newCar.trim() || !newDriver.trim() || !weekendId) return;
    setCreating(true);
    setError(null);
    try {
      const cdRes = await apiPost<{ ok: boolean; car_driver: CarDriver }>('/api/car-drivers', {
        car_identifier: newCar.trim(),
        driver_name: newDriver.trim(),
      });
      const planRes = await apiPost<PlanCreateResponse>('/api/plans', {
        car_driver_id: cdRes.car_driver.id,
        weekend_id: weekendId,
      });
      qc.setQueryData<(Plan & { car_driver_display?: string })[]>(
        ['weekend-plans', weekendId],
        old => {
          if (!old) return [planRes.plan];
          if (old.some(p => p.id === planRes.plan.id)) return old;
          return [...old, planRes.plan];
        },
      );
      qc.invalidateQueries({ queryKey: ['car-drivers'] });
      qc.invalidateQueries({ queryKey: ['weekend-plans', weekendId] });
      navigate(`/plan/${weekendId}/${cdRes.car_driver.id}`, { replace: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong';
      setError(msg);
      setCreating(false);
    }
  }

  async function createPlanForCar(carDriverId: string) {
    if (!weekendId) return;
    setError(null);
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
      navigate(`/plan/${weekendId}/${carDriverId}`, { replace: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('already exists')) {
        qc.invalidateQueries({ queryKey: ['weekend-plans', weekendId] });
        navigate(`/plan/${weekendId}/${carDriverId}`, { replace: true });
      } else {
        setError(msg || 'Failed to create plan');
      }
    }
  }

  const errorBanner = error && (
    <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 8 }}>{error}</p>
  );

  if (plansPending || carDriversPending) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <span className="text-muted">Loading...</span>
      </div>
    );
  }

  if (plansLoaded.length > 1) {
    return (
      <div className="page-plan-redirect" style={{ maxWidth: 600, margin: '40px auto' }}>
        <h2>Select a car to plan for</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
          {plansLoaded.map(p => (
            <button
              key={p.id}
              className="card"
              style={{ padding: 16, cursor: 'pointer', textAlign: 'left', border: '1px solid var(--border)', background: 'var(--surface)' }}
              onClick={() => navigate(`/plan/${weekendId}/${p.car_driver_id}`, { replace: true })}
            >
              <strong>{(p as { car_driver_display?: string }).car_driver_display || p.car_driver_id}</strong>
              <span className="text-muted" style={{ marginLeft: 8 }}>
                {p.planning_mode === 'qual' ? 'Qual' : 'Race'}
              </span>
            </button>
          ))}
        </div>
        {carsLoaded.filter(cd => !plansLoaded.some(p => p.car_driver_id === cd.id)).length > 0 && (
          <div style={{ marginTop: 24 }}>
            <h3 className="text-muted">Start planning for another car?</h3>
            {carsLoaded.filter(cd => !plansLoaded.some(p => p.car_driver_id === cd.id)).map(cd => (
              <Button key={cd.id} variant="secondary" size="sm" style={{ marginRight: 8, marginTop: 4 }}
                onClick={() => createPlanForCar(cd.id)}>
                + {cd.car_identifier} / {cd.driver_name}
              </Button>
            ))}
          </div>
        )}
        {errorBanner}
      </div>
    );
  }

  if (carsLoaded.length === 0) {
    return (
      <div className="page-plan-redirect" style={{ maxWidth: 500, margin: '40px auto' }}>
        <div className="card" style={{ padding: 24 }}>
          <h2 style={{ margin: '0 0 16px' }}>Create a car/driver to start</h2>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input className="input" placeholder="Car identifier (e.g. #12)" value={newCar}
              onChange={e => setNewCar(e.target.value)} style={{ flex: 1 }} />
            <input className="input" placeholder="Driver name" value={newDriver}
              onChange={e => setNewDriver(e.target.value)} style={{ flex: 1 }} />
          </div>
          <Button onClick={createCarAndPlan} disabled={!newCar.trim() || !newDriver.trim() || creating}>
            {creating ? 'Creating...' : 'Create & Start Planning'}
          </Button>
          {errorBanner}
        </div>
      </div>
    );
  }

  if (plansLoaded.length === 0 && carsLoaded.length > 0) {
    return (
      <div className="page-plan-redirect" style={{ maxWidth: 500, margin: '40px auto' }}>
        <h2>Start planning for a car</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
          {carsLoaded.map(cd => (
            <Button key={cd.id} variant="secondary" onClick={() => createPlanForCar(cd.id)}>
              Start planning for {cd.car_identifier} / {cd.driver_name}
            </Button>
          ))}
        </div>
        {errorBanner}
      </div>
    );
  }

  return (
    <div style={{ padding: 40, textAlign: 'center' }}>
      <span className="text-muted">Loading...</span>
    </div>
  );
}
