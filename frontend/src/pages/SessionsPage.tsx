import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams, Link } from 'react-router-dom';
import { apiGet, apiDelete } from '../api/client';
import type { SessionsFullResponse } from '../types/api';
import Button from '../components/ui/Button';
import { tempLabel } from '../utils/units';

export default function SessionsPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const filterCd = params.get('car_driver_id') ?? '';

  useEffect(() => {
    document.title = 'LapForge - Sessions';
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ['sessions-full'],
    queryFn: () => apiGet<SessionsFullResponse>('/api/sessions-full'),
  });

  const [compareIds, setCompareIds] = useState<Set<string>>(new Set());

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/sessions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions-full'] }),
  });

  const sessions = data?.sessions ?? [];
  const carDrivers = data?.car_drivers ?? [];

  const filtered = filterCd
    ? sessions.filter((s) => s.car_driver_id === filterCd)
    : sessions;

  const cdMap = Object.fromEntries(carDrivers.map((cd) => [cd.id, cd]));

  function toggleCompare(id: string) {
    setCompareIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>Sessions</h1>
        <div className="page-header-actions">
          <select
            className="form-select"
            value={filterCd}
            onChange={(e) => {
              const v = e.target.value;
              if (v) setParams({ car_driver_id: v });
              else setParams({});
            }}
          >
            <option value="">All</option>
            {carDrivers.map((cd) => (
              <option key={cd.id} value={cd.id}>{cd.car_identifier} / {cd.driver_name}</option>
            ))}
          </select>
          {compareIds.size >= 1 && (
            <Link to={`/compare?ids=${[...compareIds].join(',')}`}>
              <Button>Compare ({compareIds.size})</Button>
            </Link>
          )}
        </div>
      </div>

      {isLoading ? (
        <p className="muted">Loading...</p>
      ) : filtered.length === 0 ? (
        <p className="muted">No sessions yet. <Link to="/upload">Upload</Link> a Pi Toolbox export to get started.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th className="col-check"></th>
              <th>Track</th>
              <th>Type</th>
              <th>Car (session)</th>
              <th>Driver (session)</th>
              <th>Car / Driver</th>
              <th>Laps</th>
              <th>Temps</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => {
              const cd = cdMap[s.car_driver_id];
              return (
                <tr key={s.id}>
                  <td className="col-check">
                    <input
                      type="checkbox"
                      checked={compareIds.has(s.id)}
                      onChange={() => toggleCompare(s.id)}
                    />
                  </td>
                  <td><Link to={`/sessions/${s.id}`}>{s.track}</Link></td>
                  <td>{s.session_type}</td>
                  <td>{s.car?.trim() ? s.car : '—'}</td>
                  <td>{s.driver?.trim() ? s.driver : '—'}</td>
                  <td>{cd ? `${cd.car_identifier} / ${cd.driver_name}` : '—'}</td>
                  <td>{s.lap_count}</td>
                  <td>
                    {s.ambient_temp_c != null && `${s.ambient_temp_c}${tempLabel('c')}`}
                    {s.ambient_temp_c != null && s.track_temp_c != null && ' / '}
                    {s.track_temp_c != null && `${s.track_temp_c}${tempLabel('c')}`}
                  </td>
                  <td className="actions">
                    <Link to={`/sessions/${s.id}`}><Button variant="ghost" size="sm">View</Button></Link>
                    <Button variant="danger" size="sm" onClick={() => {
                      if (confirm('Delete this session?')) deleteMut.mutate(s.id);
                    }}>Delete</Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
