import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPost, apiDelete } from '../api/client';
import type { Weekend } from '../types/models';
import type { WeekendCreateResponse } from '../types/api';
import Button from '../components/ui/Button';

export default function PlanListPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => { document.title = 'LapForge - Plan'; }, []);

  const { data: weekends = [] } = useQuery({
    queryKey: ['weekends'],
    queryFn: () => apiGet<Weekend[]>('/api/weekends'),
  });

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [track, setTrack] = useState('');
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');

  const createMut = useMutation({
    mutationFn: (data: { name: string; track: string; date_start: string; date_end: string }) =>
      apiPost<WeekendCreateResponse>('/api/weekends', data),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['weekends'] });
      navigate(`/plan/${res.id}`);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/weekends/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['weekends'] }),
  });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    createMut.mutate({ name: name.trim(), track: track.trim(), date_start: dateStart, date_end: dateEnd });
  }

  return (
    <div className="page-plan-list">
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <h1 style={{ margin: 0, flex: 1 }}>Weekends</h1>
        <Button onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : '+ New Weekend'}
        </Button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="card" style={{ marginBottom: 24, padding: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 180px' }}>
            <span className="text-muted" style={{ fontSize: 12 }}>Name *</span>
            <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Snetterton Apr 2026" autoFocus />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 140px' }}>
            <span className="text-muted" style={{ fontSize: 12 }}>Track</span>
            <input className="input" value={track} onChange={e => setTrack(e.target.value)} placeholder="Snetterton" />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '0 1 140px' }}>
            <span className="text-muted" style={{ fontSize: 12 }}>Start date</span>
            <input className="input" type="date" value={dateStart} onChange={e => setDateStart(e.target.value)} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '0 1 140px' }}>
            <span className="text-muted" style={{ fontSize: 12 }}>End date</span>
            <input className="input" type="date" value={dateEnd} onChange={e => setDateEnd(e.target.value)} />
          </label>
          <Button type="submit" disabled={!name.trim() || createMut.isPending}>
            {createMut.isPending ? 'Creating...' : 'Create'}
          </Button>
        </form>
      )}

      {weekends.length === 0 ? (
        <div className="card" style={{ padding: 32, textAlign: 'center' }}>
          <p className="text-muted">No weekends yet. Create one to start planning tire pressures.</p>
        </div>
      ) : (
        <div className="card" style={{ overflow: 'auto' }}>
          <table className="data-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Track</th>
                <th>Dates</th>
                <th>Plans</th>
                <th style={{ width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {weekends.map(w => (
                <tr
                  key={w.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/plan/${w.id}`)}
                >
                  <td style={{ fontWeight: 500 }}>{w.name}</td>
                  <td className="text-muted">{w.track || '—'}</td>
                  <td className="text-muted">
                    {w.date_start ? `${w.date_start}${w.date_end ? ` – ${w.date_end}` : ''}` : '—'}
                  </td>
                  <td>{w.plan_count ?? 0}</td>
                  <td>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete "${w.name}" and all its plans?`)) {
                          deleteMut.mutate(w.id);
                        }
                      }}
                    >
                      ×
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
