import { useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiGet, apiPatch } from '../api/client';
import type { DashboardModule } from '../types/models';
import { CursorSyncProvider } from '../contexts/CursorSyncContext';
import Dashboard from '../components/dashboard/Dashboard';
import type { DashboardData } from '../components/dashboard/Dashboard';
import DashboardTemplateModal from '../components/dashboard/DashboardTemplateModal';
import Button from '../components/ui/Button';

export default function CompareDashboardPage() {
  const { id } = useParams<{ id: string }>();
  const [templateOpen, setTemplateOpen] = useState(false);
  const [dashLayout, setDashLayout] = useState<DashboardModule[] | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['compare-dashboard', id],
    queryFn: () => apiGet<Record<string, unknown>>(`/api/comparisons/${id}/dashboard-data`),
    enabled: !!id,
  });

  const onLayoutChange = useCallback((layout: DashboardModule[]) => {
    setDashLayout(layout);
    if (id) {
      apiPatch(`/api/comparisons/${id}/dashboard-layout`, { layout }).catch(() => {});
    }
  }, [id]);

  if (isLoading) return <div className="page-content"><p className="text-muted">Loading comparison...</p></div>;
  if (error || !data) return <div className="page-content"><p className="text-muted">Comparison not found.</p></div>;

  const dashData = data as unknown as DashboardData;

  return (
    <div className="page-content compare-dashboard">
      <div className="session-detail-header">
        <div>
          <Link to="/compare" className="back-link">← Comparisons</Link>
          <h1>{String(data.comparison_name ?? 'Compare')}</h1>
          <p className="text-muted">{(data.all_session_ids as string[])?.length ?? 0} sessions</p>
        </div>
        <div className="session-detail-actions">
          <Button variant="ghost" size="sm" onClick={() => setTemplateOpen(true)}>Templates</Button>
        </div>
      </div>

      <CursorSyncProvider>
        <Dashboard
          data={dashData}
          sessionId={id ?? 'compare'}
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
    </div>
  );
}
