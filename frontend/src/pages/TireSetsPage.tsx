import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch, apiDelete } from '../api/client';
import type { TireSet, CarDriver } from '../types/models';
import type { TireSetCreateResponse } from '../types/api';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';

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

function parseP(v: string): number | null {
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

export default function TireSetsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState('');

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
      morning_pressure_fl: ts.morning_pressure_fl?.toString() ?? '',
      morning_pressure_fr: ts.morning_pressure_fr?.toString() ?? '',
      morning_pressure_rl: ts.morning_pressure_rl?.toString() ?? '',
      morning_pressure_rr: ts.morning_pressure_rr?.toString() ?? '',
    });
    setEditing(ts);
  }

  function closeModal() { setCreating(false); setEditing(null); }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      name: form.name,
      car_driver_id: form.car_driver_id || null,
      morning_pressure_fl: parseP(form.morning_pressure_fl),
      morning_pressure_fr: parseP(form.morning_pressure_fr),
      morning_pressure_rl: parseP(form.morning_pressure_rl),
      morning_pressure_rr: parseP(form.morning_pressure_rr),
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
          <select className="form-select" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">All</option>
            {carDrivers.map((cd) => (
              <option key={cd.id} value={cd.id}>{cd.car_identifier} / {cd.driver_name}</option>
            ))}
          </select>
          <Button onClick={openCreate}>+ Add</Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-muted">Loading...</p>
      ) : tireSets.length === 0 ? (
        <p className="text-muted">No tire sets yet.</p>
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
                <td>{ts.morning_pressure_fl ?? '—'}</td>
                <td>{ts.morning_pressure_fr ?? '—'}</td>
                <td>{ts.morning_pressure_rl ?? '—'}</td>
                <td>{ts.morning_pressure_rr ?? '—'}</td>
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
                {pos.toUpperCase()} (bar)
                <input
                  className="form-input"
                  type="number"
                  step="0.01"
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
