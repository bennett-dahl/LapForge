import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiGet } from '../api/client';
import type { CarDriver } from '../types/models';
import type { SessionsFullResponse, SyncStatusResponse } from '../types/api';
import { syncStatusLabel } from '../utils/syncStatus';

const MAX_RECENT = 5;

export default function IndexPage() {
  useEffect(() => {
    document.title = 'LapForge - Home';
  }, []);

  const { data: carDrivers = [] } = useQuery({
    queryKey: ['car-drivers'],
    queryFn: () => apiGet<CarDriver[]>('/api/car-drivers'),
  });

  const { data: sessionsData } = useQuery({
    queryKey: ['sessions-full'],
    queryFn: () => apiGet<SessionsFullResponse>('/api/sessions-full'),
  });

  const { data: syncStatus } = useQuery({
    queryKey: ['sync-status'],
    queryFn: () => apiGet<SyncStatusResponse>('/api/sync/status'),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const recentSessions = useMemo(() => {
    if (!sessionsData?.sessions?.length) return [];
    const all = sessionsData.sessions;
    const withDate = all.filter((s) => s.created_at?.trim());
    const withoutDate = all.filter((s) => !s.created_at?.trim());
    const byCreated = [...withDate].sort((a, b) => b.created_at.localeCompare(a.created_at));
    const byLabel = [...withoutDate].sort((a, b) =>
      `${a.track} ${a.session_type} ${a.id}`.localeCompare(`${b.track} ${b.session_type} ${b.id}`),
    );
    return [...byCreated, ...byLabel].slice(0, MAX_RECENT);
  }, [sessionsData]);

  return (
    <div className="page-content">
      <h1>LapForge</h1>
      <p className="muted">Telemetry analysis for motorsport data.</p>

      {syncStatus && (
        <div data-testid="home-sync-summary" style={{ marginBottom: '0.75rem', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          {(syncStatus.status === 'oauth_not_configured' || syncStatus.status === 'not_logged_in') ? (
            <span className="muted">
              Cloud sync not configured —{' '}
              <Link to="/settings?tab=sync" style={{ color: 'var(--muted)' }}>Settings</Link>
            </span>
          ) : (
            <>
              <span className={`sync-badge sync-${syncStatus.status}`}>
                {syncStatusLabel(syncStatus.status)}
              </span>
              {syncStatus.last_synced_at && (
                <span className="muted">— last synced {new Date(syncStatus.last_synced_at).toLocaleString()}</span>
              )}
              <Link to="/settings?tab=sync" style={{ color: 'var(--muted)', marginLeft: 4 }}>Sync settings</Link>
            </>
          )}
        </div>
      )}

      {carDrivers.length === 0 && (
        <section className="home-section">
          <h2>Get Started</h2>
          <p className="muted" style={{ marginBottom: '0.75rem' }}>
            Set up a car &amp; driver, then upload your first session.
          </p>
          <div className="card-grid">
            <Link to="/car-drivers" className="card card-link">
              <div className="card-title">Add Car / Driver</div>
              <div className="card-subtitle">Create your first car &amp; driver entry</div>
            </Link>
            <Link to="/upload" className="card card-link">
              <div className="card-title">Upload Session</div>
              <div className="card-subtitle">Import Pi Toolbox export data</div>
            </Link>
          </div>
        </section>
      )}

      {carDrivers.length > 0 && (
        <section className="home-section">
          <h2>Car / Driver</h2>
          <div className="card-grid">
            {carDrivers.map((cd) => (
              <Link key={cd.id} to={`/sessions?car_driver_id=${cd.id}`} className="card card-link">
                <div className="card-title">{cd.car_identifier}</div>
                <div className="card-subtitle">{cd.driver_name}</div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {recentSessions.length > 0 && (
        <section className="home-section">
          <h2>Recent Sessions</h2>
          <div className="card-grid">
            {recentSessions.map((s) => (
              <Link key={s.id} to={`/sessions/${s.id}`} className="card card-link">
                <div className="card-title">{s.track} — {s.session_type}</div>
                <div className="card-subtitle">
                  {s.car} / {s.driver}
                  {s.created_at && (
                    <span style={{ marginLeft: 8, opacity: 0.7 }}>
                      {new Date(s.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="home-section">
        <h2>Quick Actions</h2>
        <div className="card-grid">
          <Link to="/upload" className="card card-link">
            <div className="card-title">Upload Session</div>
            <div className="card-subtitle">Import Pi Toolbox export data</div>
          </Link>
          <Link to="/sessions" className="card card-link">
            <div className="card-title">View Sessions</div>
            <div className="card-subtitle">Browse and analyze telemetry</div>
          </Link>
          <Link to="/compare" className="card card-link">
            <div className="card-title">Compare</div>
            <div className="card-subtitle">Multi-session overlay analysis</div>
          </Link>
          <Link to="/plan" className="card card-link">
            <div className="card-title">Pressure Plans</div>
            <div className="card-subtitle">Weekend tire pressure planning</div>
          </Link>
          <Link to="/tire-sets" className="card card-link">
            <div className="card-title">Tire Sets</div>
            <div className="card-subtitle">Manage tire set inventory</div>
          </Link>
          <Link to="/track-layouts" className="card card-link">
            <div className="card-title">Track Layouts</div>
            <div className="card-subtitle">Saved track maps and geometry</div>
          </Link>
        </div>
      </section>
    </div>
  );
}
