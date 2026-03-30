import { useState, useCallback, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPut, apiDelete } from '../api/client';
import type { SettingsResponse } from '../types/api';
import type { SessionListItem, DashboardModule } from '../types/models';
import type { DistanceUnit } from '../utils/units';
import { CursorSyncProvider } from '../contexts/CursorSyncContext';
import Dashboard from '../components/dashboard/Dashboard';
import type { DashboardData } from '../components/dashboard/Dashboard';
import DashboardTemplateModal from '../components/dashboard/DashboardTemplateModal';
import Button from '../components/ui/Button';

function mergeComparisonSessions(raw: Record<string, unknown>): DashboardData {
  const sessions = raw.sessions as DashboardData[] | undefined;
  if (!sessions?.length) return raw as unknown as DashboardData;
  const first = sessions[0];
  const merged: DashboardData = {
    times: first.times ?? [],
    distances: first.distances ?? [],
    series: {},
    channel_meta: {},
    channels_by_category: (raw.channels_by_category as Record<string, string[]>) ?? first.channels_by_category ?? {},
    lap_splits: first.lap_splits ?? [],
    lap_split_distances: first.lap_split_distances ?? [],
    lap_times: first.lap_times ?? [],
    has_distance: first.has_distance ?? false,
    sessions,
    comparison_id: raw.comparison_id as string,
    comparison_name: raw.comparison_name as string | undefined,
    all_session_ids: raw.all_session_ids as string[] | undefined,
  };
  sessions.forEach((s, si) => {
    const prefix = sessions.length > 1 ? `S${si + 1} ` : '';
    if (s.series) {
      for (const [k, v] of Object.entries(s.series)) {
        merged.series[`${prefix}${k}`] = v;
      }
    }
    if (s.channel_meta) {
      for (const [k, meta] of Object.entries(s.channel_meta)) {
        merged.channel_meta[`${prefix}${k}`] = { ...meta, label: `${prefix}${meta.label}` };
      }
    }
  });
  return merged;
}

export default function CompareDashboardPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [templateOpen, setTemplateOpen] = useState(false);
  const [dashLayout, setDashLayout] = useState<DashboardModule[] | null>(null);

  useEffect(() => {
    if (!id) return;
    apiGet<{ layout: DashboardModule[] }>(`/api/comparisons/${id}/dashboard-layout`)
      .then((r) => { if (r.layout?.length) setDashLayout(r.layout); })
      .catch(() => {});
  }, [id]);

  const { data: rawData, isLoading, error } = useQuery({
    queryKey: ['compare-dashboard', id],
    queryFn: () => apiGet<Record<string, unknown>>(`/api/comparisons/${id}/dashboard-data`),
    enabled: !!id,
  });

  const { data: sessionsList = [] } = useQuery({
    queryKey: ['sessions-list'],
    queryFn: () => apiGet<SessionListItem[]>('/api/sessions/list'),
    enabled: !!id,
  });

  const { data: settingsData } = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiGet<SettingsResponse>('/api/settings'),
  });

  const distanceUnit = useMemo((): DistanceUnit => {
    const u = String(settingsData?.preferences?.default_distance_unit ?? 'km').toLowerCase();
    return u === 'mi' ? 'mi' : 'km';
  }, [settingsData?.preferences?.default_distance_unit]);

  const data = useMemo(() => rawData ? mergeComparisonSessions(rawData) : null, [rawData]);

  useEffect(() => {
    if (!rawData) return;
    const name = String(rawData.comparison_name ?? 'Compare');
    document.title = `LapForge - Compare: ${name}`;
  }, [rawData]);

  const sessionLabelById = useMemo(
    () => Object.fromEntries(sessionsList.map((s) => [s.id, s.label] as const)),
    [sessionsList],
  );

  const removeSessionMut = useMutation({
    mutationFn: (sessionId: string) => apiDelete(`/api/comparisons/${id}/sessions/${sessionId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['compare-dashboard', id] }),
  });

  const onLayoutChange = useCallback((layout: DashboardModule[]) => {
    setDashLayout(layout);
    if (id) {
      apiPut(`/api/comparisons/${id}/dashboard-layout`, { layout }).catch(() => {});
    }
  }, [id]);

  if (isLoading) return <div className="page-content"><p className="muted">Loading comparison...</p></div>;
  if (error || !data) return <div className="page-content"><p className="muted">Comparison not found.</p></div>;

  const dashData = data;
  const allSessionIds = (data.all_session_ids as string[]) ?? [];

  return (
    <div className="page-content compare-dashboard">
      <div className="session-detail-header">
        <div>
          <Link to="/compare" className="back-link">← Comparisons</Link>
          <h1>{String(data.comparison_name ?? 'Compare')}</h1>
          <p className="muted">{allSessionIds.length} sessions</p>
        </div>
        <div className="session-detail-actions">
          <Button variant="ghost" size="sm" onClick={() => setTemplateOpen(true)}>Templates</Button>
        </div>
      </div>

      {allSessionIds.length > 0 && (
        <div className="compare-session-badges" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '1rem' }}>
          {allSessionIds.map((sid) => (
            <span key={sid} className="compare-badge">
              <span className="compare-badge-label" title={sessionLabelById[sid] ?? sid}>
                {sessionLabelById[sid] ?? sid.slice(0, 8)}
              </span>
              <button
                type="button"
                className="compare-badge-remove"
                aria-label={`Remove session ${sessionLabelById[sid] ?? sid}`}
                disabled={removeSessionMut.isPending}
                onClick={() => removeSessionMut.mutate(sid)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <CursorSyncProvider>
        <Dashboard
          data={dashData}
          sessionId={id ?? 'compare'}
          initialLayout={dashLayout}
          onLayoutChange={onLayoutChange}
          distanceUnit={distanceUnit}
        />
        <DashboardTemplateModal
          open={templateOpen}
          onClose={() => setTemplateOpen(false)}
          currentLayout={dashLayout ?? []}
          onApplyTemplate={(layout) => { setDashLayout(layout); onLayoutChange(layout); }}
        />
      </CursorSyncProvider>
    </div>
  );
}
