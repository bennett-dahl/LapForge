import { useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch, apiPost } from '../api/client';
import type { SessionDetailResponse } from '../types/api';
import type { DashboardModule } from '../types/models';
import { CursorSyncProvider } from '../contexts/CursorSyncContext';
import Dashboard from '../components/dashboard/Dashboard';
import type { DashboardData } from '../components/dashboard/Dashboard';
import DashboardTemplateModal from '../components/dashboard/DashboardTemplateModal';
import Button from '../components/ui/Button';

type ViewMode = 'dashboard' | 'info';

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [view, setView] = useState<ViewMode>('dashboard');
  const [templateOpen, setTemplateOpen] = useState(false);
  const [dashLayout, setDashLayout] = useState<DashboardModule[] | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['session-detail', id],
    queryFn: () => apiGet<SessionDetailResponse>(`/api/sessions/${id}/detail`),
    enabled: !!id,
  });

  const updateMut = useMutation({
    mutationFn: (fields: Record<string, unknown>) =>
      apiPatch<{ ok: boolean }>(`/api/sessions/${id}`, fields),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['session-detail', id] }),
  });

  const reprocessMut = useMutation({
    mutationFn: () => apiPost<{ ok: boolean }>(`/api/sessions/${id}/reprocess`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['session-detail', id] }),
  });

  const onLayoutChange = useCallback((layout: DashboardModule[]) => {
    setDashLayout(layout);
    if (id) {
      apiPatch(`/api/sessions/${id}/dashboard-layout`, { layout }).catch(() => {});
    }
  }, [id]);

  if (isLoading) return <div className="page-content"><p className="text-muted">Loading session...</p></div>;
  if (error || !data) return <div className="page-content"><p className="text-muted">Session not found.</p></div>;

  const session = data.session as Record<string, string>;
  const dashData = data.dashboard_data as DashboardData | null;

  return (
    <div className="page-content session-detail">
      <div className="session-detail-header">
        <div>
          <Link to="/sessions" className="back-link">← Sessions</Link>
          <h1>{session.track} — {session.session_type}</h1>
          <p className="text-muted">{session.car} / {session.driver}</p>
        </div>
        <div className="session-detail-actions">
          <Button
            variant={view === 'dashboard' ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setView('dashboard')}
          >Dashboard</Button>
          <Button
            variant={view === 'info' ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setView('info')}
          >Info</Button>
          {view === 'dashboard' && (
            <Button variant="ghost" size="sm" onClick={() => setTemplateOpen(true)}>
              Templates
            </Button>
          )}
          {data.needs_reprocess && data.can_reprocess && (
            <Button variant="secondary" size="sm" onClick={() => reprocessMut.mutate()}>
              Reprocess
            </Button>
          )}
        </div>
      </div>

      {view === 'dashboard' && dashData ? (
        <CursorSyncProvider>
          <Dashboard
            data={dashData}
            sessionId={id!}
            initialLayout={dashLayout}
            onLayoutChange={onLayoutChange}
          />
          <DashboardTemplateModal
            open={templateOpen}
            onClose={() => setTemplateOpen(false)}
            currentLayout={dashLayout ?? []}
            onApplyTemplate={(layout) => { setDashLayout(layout); onLayoutChange(layout); }}
          />
        </CursorSyncProvider>
      ) : view === 'dashboard' ? (
        <p className="text-muted">No dashboard data for this session.</p>
      ) : (
        <SessionInfoPanel session={data} onUpdate={(fields) => updateMut.mutate(fields)} />
      )}
    </div>
  );
}

function SessionInfoPanel({
  session: data,
  onUpdate,
}: {
  session: SessionDetailResponse;
  onUpdate: (fields: Record<string, unknown>) => void;
}) {
  const s = data.session as Record<string, unknown>;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    ambient_temp_c: String(s.ambient_temp_c ?? ''),
    track_temp_c: String(s.track_temp_c ?? ''),
    tire_set_id: String(s.tire_set_id ?? ''),
    track_layout_id: String(s.track_layout_id ?? ''),
    target_pressure_psi: String(s.target_pressure_psi ?? ''),
    lap_count_notes: String(s.lap_count_notes ?? ''),
  });

  function handleSave() {
    onUpdate({
      ambient_temp_c: parseFloat(form.ambient_temp_c) || null,
      track_temp_c: parseFloat(form.track_temp_c) || null,
      tire_set_id: form.tire_set_id || null,
      track_layout_id: form.track_layout_id || null,
      target_pressure_psi: parseFloat(form.target_pressure_psi) || null,
      lap_count_notes: form.lap_count_notes || null,
    });
    setEditing(false);
  }

  return (
    <div className="card session-info-panel">
      <div className="session-info-header">
        <h3>Session Info</h3>
        <Button variant="ghost" size="sm" onClick={() => setEditing(!editing)}>
          {editing ? 'Cancel' : 'Edit'}
        </Button>
      </div>

      <dl className="session-info-dl">
        <div><dt>Track</dt><dd>{String(s.track)}</dd></div>
        <div><dt>Type</dt><dd>{String(s.session_type)}</dd></div>
        <div><dt>Car/Driver</dt><dd>{data.car_driver ? `${data.car_driver.car_identifier} / ${data.car_driver.driver_name}` : '—'}</dd></div>
        <div><dt>Tire Set</dt><dd>{data.tire_set?.name ?? '—'}</dd></div>

        {editing ? (
          <>
            <div>
              <dt>Ambient Temp (°C)</dt>
              <dd><input className="form-input form-input-sm" value={form.ambient_temp_c} onChange={(e) => setForm({ ...form, ambient_temp_c: e.target.value })} /></dd>
            </div>
            <div>
              <dt>Track Temp (°C)</dt>
              <dd><input className="form-input form-input-sm" value={form.track_temp_c} onChange={(e) => setForm({ ...form, track_temp_c: e.target.value })} /></dd>
            </div>
            <div>
              <dt>Target PSI</dt>
              <dd><input className="form-input form-input-sm" value={form.target_pressure_psi} onChange={(e) => setForm({ ...form, target_pressure_psi: e.target.value })} /></dd>
            </div>
            <div>
              <dt>Tire Set</dt>
              <dd>
                <select className="form-select form-select-sm" value={form.tire_set_id} onChange={(e) => setForm({ ...form, tire_set_id: e.target.value })}>
                  <option value="">None</option>
                  {data.tire_sets.map((ts) => <option key={ts.id} value={ts.id}>{ts.name}</option>)}
                </select>
              </dd>
            </div>
            <div>
              <dt>Track Layout</dt>
              <dd>
                <select className="form-select form-select-sm" value={form.track_layout_id} onChange={(e) => setForm({ ...form, track_layout_id: e.target.value })}>
                  <option value="">None</option>
                  {data.track_layouts.map((tl) => <option key={tl.id} value={tl.id}>{tl.name}</option>)}
                </select>
              </dd>
            </div>
            <div>
              <dt>Lap Notes</dt>
              <dd><textarea className="form-input form-input-sm" value={form.lap_count_notes} onChange={(e) => setForm({ ...form, lap_count_notes: e.target.value })} /></dd>
            </div>
            <div className="form-actions">
              <Button size="sm" onClick={handleSave}>Save</Button>
            </div>
          </>
        ) : (
          <>
            <div><dt>Ambient Temp</dt><dd>{s.ambient_temp_c != null ? `${s.ambient_temp_c}°C` : '—'}</dd></div>
            <div><dt>Track Temp</dt><dd>{s.track_temp_c != null ? `${s.track_temp_c}°C` : '—'}</dd></div>
            <div><dt>Target PSI</dt><dd>{s.target_pressure_psi != null ? String(s.target_pressure_psi) : '—'}</dd></div>
            <div><dt>Smoothing</dt><dd>{data.smoothing_level}</dd></div>
            <div><dt>Notes</dt><dd>{String(s.lap_count_notes || '—')}</dd></div>
          </>
        )}
      </dl>
    </div>
  );
}
