import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../api/client';
import type { SetupListItem, CarDriver, SessionListItem } from '../types/models';
import { setupLabel } from '../utils/setup';
import Button from '../components/ui/Button';

export default function SetupsPage() {
  const [selectedCd, setSelectedCd] = useState('');

  const { data: carDrivers = [] } = useQuery({
    queryKey: ['car-drivers'],
    queryFn: () => apiGet<CarDriver[]>('/api/car-drivers'),
  });

  const { data: setups = [], isLoading } = useQuery({
    queryKey: ['setups-list', selectedCd],
    queryFn: () =>
      apiGet<SetupListItem[]>(
        selectedCd ? `/api/setups/list?car_driver_id=${selectedCd}` : '/api/setups/list',
      ),
  });

  const { data: sessions = [] } = useQuery({
    queryKey: ['sessions-list'],
    queryFn: () => apiGet<SessionListItem[]>('/api/sessions/list'),
  });

  function cdName(cdId: string) {
    const cd = carDrivers.find(c => c.id === cdId);
    return cd ? `${cd.car_identifier} / ${cd.driver_name}` : cdId.slice(0, 8);
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Setups</h2>
        <Link to="/setups/new">
          <Button>New Setup</Button>
        </Link>
      </div>

      <div style={{ marginBottom: 16 }}>
        <select
          className="input"
          value={selectedCd}
          onChange={e => setSelectedCd(e.target.value)}
          style={{ minWidth: 200, fontSize: 13 }}
        >
          <option value="">All car / drivers</option>
          {carDrivers.map(cd => (
            <option key={cd.id} value={cd.id}>
              {cd.car_identifier} / {cd.driver_name}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div style={{ color: 'var(--text-muted)' }}>Loading...</div>
      ) : setups.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', padding: 24, textAlign: 'center' }}>
          No setups yet. Create one to get started.
        </div>
      ) : (
        <table className="data-table" style={{ width: '100%', fontSize: 13 }}>
          <thead>
            <tr>
              <th>Setup</th>
              <th>Car / Driver</th>
              <th>Created</th>
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {setups.map(s => (
              <tr key={s.id}>
                <td>
                  <Link to={`/setups/${s.id}`} style={{ color: 'var(--primary)' }}>
                    {setupLabel(s, sessions)}
                  </Link>
                  {s.parent_id && (
                    <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-muted)' }} title="Forked">↳</span>
                  )}
                </td>
                <td>{cdName(s.car_driver_id)}</td>
                <td>{s.created_at ? new Date(s.created_at).toLocaleDateString() : '—'}</td>
                <td>
                  <Link to={`/setups/${s.id}`} style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
