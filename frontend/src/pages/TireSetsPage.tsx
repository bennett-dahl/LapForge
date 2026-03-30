import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch, apiDelete } from '../api/client';
import type { TireSet, CarDriver } from '../types/models';
import type { TireSetCreateResponse } from '../types/api';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import { convertPressure, type PressureUnit } from '../utils/units';

interface TireSetForm {
  name: string;
  car_driver_id: string;
  morning_pressure_fl: string;
  morning_pressure_fr: string;
  morning_pressure_rl: string;
  morning_pressure_rr: string;
}

const emptyForm: TireSetForm = {
  name: '', car_driver_id: '', morning_pressure_fl: '',
  morning_pressure_fr: '', morning_pressure_rl: '', morning_pressure_rr: '',
};

const LS_TIRE_PRESSURE_DISPLAY = 'tire_sets_pressure_display';

function readDisplayUnit(): PressureUnit {
  try {
    const v = localStorage.getItem(LS_TIRE_PRESSURE_DISPLAY);
    if (v === 'psi' || v === 'bar') return v;
  } catch {
    /* ignore */
  }
  return 'bar';
}

function parseP(v: string): number | null {
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

/** Stored values are bar; format for list cells. */
function formatPressureBar(bar: number | null, display: PressureUnit): string {
  if (bar == null) return '—';
  const v = display === 'psi' ? convertPressure(bar, 'bar', 'psi') : bar;
  const decimals = display === 'psi' ? 1 : 2;
  return `${v.toFixed(decimals)} ${display === 'psi' ? 'psi' : 'bar'}`;
}

/** Bar → display string for form field (number only). */
function barToFormString(bar: number | null, display: PressureUnit): string {
  if (bar == null) return '';
  const v = display === 'psi' ? convertPressure(bar, 'bar', 'psi') : bar;
  const rounded = display === 'psi' ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100;
  return String(rounded);
}

export default function TireSetsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState('');
  const [displayUnit, setDisplayUnitState] = useState<PressureUnit>(() => readDisplayUnit());

  const setDisplayUnit = useCallback((u: PressureUnit) => {
    setDisplayUnitState(u);
    try {
      localStorage.setItem(LS_TIRE_PRESSURE_DISPLAY, u);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    document.title = 'LapForge - Tire Sets';
  }, []);

  const { data: tireSets = [], isLoading } = useQuery({
    queryKey: ['tire-sets', filter],
    queryFn: () => apiGet<TireSet[]>(`/api/tire-sets${filter ? `?car_driver_id=${filter}` : ''}`),
  });

  const { data: carDrivers = [] } = useQuery({
    queryKey: ['car-drivers'],
    queryFn: () => apiGet<CarDriver[]>('/api/car-drivers'),
  });

  const [editing, setEditing] = useState<TireSet | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<TireSetForm>(emptyForm);

  const createMut = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiPost<TireSetCreateResponse>('/api/tire-sets', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tire-sets'] }); closeModal(); },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Record<string, unknown>) =>
      apiPatch<{ ok: boolean }>(`/api/tire-sets/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tire-sets'] }); closeModal(); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/tire-sets/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tire-sets'] }),
  });

  function openCreate() {
    setForm(emptyForm);
    setCreating(true);
  }

  function openEdit(ts: TireSet) {
    setForm({
      name: ts.name,
      car_driver_id: ts.car_driver_id ?? '',
      morning_pressure_fl: barToFormString(ts.morning_pressure_fl, displayUnit),
      morning_pressure_fr: barToFormString(ts.morning_pressure_fr, displayUnit),
      morning_pressure_rl: barToFormString(ts.morning_pressure_rl, displayUnit),
      morning_pressure_rr: barToFormString(ts.morning_pressure_rr, displayUnit),
    });
    setEditing(ts);
  }

  useEffect(() => {
    if (!editing) return;
    setForm((prev) => ({
      ...prev,
      morning_pressure_fl: barToFormString(editing.morning_pressure_fl, displayUnit),
      morning_pressure_fr: barToFormString(editing.morning_pressure_fr, displayUnit),
      morning_pressure_rl: barToFormString(editing.morning_pressure_rl, displayUnit),
      morning_pressure_rr: barToFormString(editing.morning_pressure_rr, displayUnit),
    }));
  }, [displayUnit, editing]);

  function closeModal() { setCreating(false); setEditing(null); }

  function formValueToBar(raw: string): number | null {
    const n = parseP(raw);
    if (n == null) return null;
    return displayUnit === 'psi' ? convertPressure(n, 'psi', 'bar') : n;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      name: form.name,
      car_driver_id: form.car_driver_id || null,
      morning_pressure_fl: formValueToBar(form.morning_pressure_fl),
      morning_pressure_fr: formValueToBar(form.morning_pressure_fr),
      morning_pressure_rl: formValueToBar(form.morning_pressure_rl),
      morning_pressure_rr: formValueToBar(form.morning_pressure_rr),
    };
    if (editing) {
      updateMut.mutate({ id: editing.id, ...payload });
    } else {
      createMut.mutate(payload);
    }
  }

  const cdMap = Object.fromEntries(carDrivers.map((cd) => [cd.id, cd]));
  const modalOpen = creating || editing !== null;

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>Tire Sets</h1>
        <div className="page-header-actions">
          <div className="unit-toggle-group" role="group" aria-label="List pressure unit" style={{ marginRight: '0.5rem' }}>
            <button
              type="button"
              className={`unit-toggle-btn${displayUnit === 'psi' ? ' active' : ''}`}
              onClick={() => setDisplayUnit('psi')}
            >
              PSI
            </button>
            <button
              type="button"
              className={`unit-toggle-btn${displayUnit === 'bar' ? ' active' : ''}`}
              onClick={() => setDisplayUnit('bar')}
            >
              Bar
            </button>
          </div>
          <select className="form-select" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">All</option>
            {carDrivers.map((cd) => (
              <option key={cd.id} value={cd.id}>{cd.car_identifier} / {cd.driver_name}</option>
            ))}
          </select>
          <Button onClick={openCreate}>+ Add</Button>
        </div>
      </div>

      <p className="muted" style={{ marginBottom: '1rem' }}>
        Manage your tire sets. Track usage across sessions to monitor wear.
      </p>

      {isLoading ? (
        <p className="muted">Loading...</p>
      ) : tireSets.length === 0 ? (
        <p className="muted">No tire sets yet.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr><th>Name</th><th>Car/Driver</th><th>FL</th><th>FR</th><th>RL</th><th>RR</th><th></th></tr>
          </thead>
          <tbody>
            {tireSets.map((ts) => (
              <tr key={ts.id}>
                <td>{ts.name}</td>
                <td>{ts.car_driver_id ? cdMap[ts.car_driver_id]?.car_identifier ?? '—' : 'All'}</td>
                <td>{formatPressureBar(ts.morning_pressure_fl, displayUnit)}</td>
                <td>{formatPressureBar(ts.morning_pressure_fr, displayUnit)}</td>
                <td>{formatPressureBar(ts.morning_pressure_rl, displayUnit)}</td>
                <td>{formatPressureBar(ts.morning_pressure_rr, displayUnit)}</td>
                <td className="actions">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(ts)}>Edit</Button>
                  <Button variant="danger" size="sm" onClick={() => {
                    if (confirm(`Delete tire set "${ts.name}"?`)) deleteMut.mutate(ts.id);
                  }}>Delete</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Modal open={modalOpen} onClose={closeModal} title={editing ? 'Edit Tire Set' : 'Add Tire Set'}>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.75rem' }}>
            <div className="unit-toggle-group" role="group" aria-label="Form pressure unit">
              <button
                type="button"
                className={`unit-toggle-btn${displayUnit === 'psi' ? ' active' : ''}`}
                onClick={() => setDisplayUnit('psi')}
              >
                PSI
              </button>
              <button
                type="button"
                className={`unit-toggle-btn${displayUnit === 'bar' ? ' active' : ''}`}
                onClick={() => setDisplayUnit('bar')}
              >
                Bar
              </button>
            </div>
          </div>
          <label className="form-label">
            Name
            <input className="form-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
          <label className="form-label">
            Car / Driver
            <select className="form-select" value={form.car_driver_id} onChange={(e) => setForm({ ...form, car_driver_id: e.target.value })}>
              <option value="">All (no filter)</option>
              {carDrivers.map((cd) => (
                <option key={cd.id} value={cd.id}>{cd.car_identifier} / {cd.driver_name}</option>
              ))}
            </select>
          </label>
          <div className="form-row">
            {(['fl', 'fr', 'rl', 'rr'] as const).map((pos) => (
              <label key={pos} className="form-label form-label-quarter">
                {pos.toUpperCase()} ({displayUnit === 'psi' ? 'psi' : 'bar'})
                <input
                  className="form-input"
                  type="number"
                  step={displayUnit === 'psi' ? '0.1' : '0.01'}
                  value={form[`morning_pressure_${pos}`]}
                  onChange={(e) => setForm({ ...form, [`morning_pressure_${pos}`]: e.target.value })}
                />
              </label>
            ))}
          </div>
          <div className="form-actions">
            <Button type="submit">{editing ? 'Save' : 'Create'}</Button>
            <Button type="button" variant="secondary" onClick={closeModal}>Cancel</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
