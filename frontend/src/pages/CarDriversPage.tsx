import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch, apiDelete } from '../api/client';
import type { CarDriver } from '../types/models';
import type { CarDriverCreateResponse } from '../types/api';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';

export default function CarDriversPage() {
  const qc = useQueryClient();
  const { data: carDrivers = [], isLoading } = useQuery({
    queryKey: ['car-drivers'],
    queryFn: () => apiGet<CarDriver[]>('/api/car-drivers'),
  });

  const [editing, setEditing] = useState<CarDriver | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ car_identifier: '', driver_name: '' });

  const createMut = useMutation({
    mutationFn: (data: { car_identifier: string; driver_name: string }) =>
      apiPost<CarDriverCreateResponse>('/api/car-drivers', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['car-drivers'] }); closeModal(); },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, ...data }: { id: string; car_identifier: string; driver_name: string }) =>
      apiPatch<{ ok: boolean }>(`/api/car-drivers/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['car-drivers'] }); closeModal(); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/car-drivers/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['car-drivers'] }),
  });

  function openCreate() {
    setForm({ car_identifier: '', driver_name: '' });
    setCreating(true);
  }

  function openEdit(cd: CarDriver) {
    setForm({ car_identifier: cd.car_identifier, driver_name: cd.driver_name });
    setEditing(cd);
  }

  function closeModal() {
    setCreating(false);
    setEditing(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (editing) {
      updateMut.mutate({ id: editing.id, ...form });
    } else {
      createMut.mutate(form);
    }
  }

  const modalOpen = creating || editing !== null;

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>Car / Driver</h1>
        <Button onClick={openCreate}>+ Add</Button>
      </div>

      {isLoading ? (
        <p className="text-muted">Loading...</p>
      ) : carDrivers.length === 0 ? (
        <p className="text-muted">No car/driver entries yet.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr><th>Car</th><th>Driver</th><th></th></tr>
          </thead>
          <tbody>
            {carDrivers.map((cd) => (
              <tr key={cd.id}>
                <td>{cd.car_identifier}</td>
                <td>{cd.driver_name}</td>
                <td className="actions">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(cd)}>Edit</Button>
                  <Button variant="danger" size="sm" onClick={() => {
                    if (confirm(`Delete ${cd.car_identifier} / ${cd.driver_name}?`))
                      deleteMut.mutate(cd.id);
                  }}>Delete</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Modal open={modalOpen} onClose={closeModal} title={editing ? 'Edit Car / Driver' : 'Add Car / Driver'}>
        <form onSubmit={handleSubmit}>
          <label className="form-label">
            Car Identifier
            <input
              className="form-input"
              value={form.car_identifier}
              onChange={(e) => setForm({ ...form, car_identifier: e.target.value })}
              required
            />
          </label>
          <label className="form-label">
            Driver Name
            <input
              className="form-input"
              value={form.driver_name}
              onChange={(e) => setForm({ ...form, driver_name: e.target.value })}
              required
            />
          </label>
          <div className="form-actions">
            <Button type="submit">{editing ? 'Save' : 'Create'}</Button>
            <Button type="button" variant="secondary" onClick={closeModal}>Cancel</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
