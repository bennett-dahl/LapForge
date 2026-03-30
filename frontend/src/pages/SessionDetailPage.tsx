import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch, apiPut } from '../api/client';
import type { SessionDetailResponse, SettingsResponse } from '../types/api';
import type { DashboardModule, TrackSection } from '../types/models';
import { CursorSyncProvider } from '../contexts/CursorSyncContext';
import Dashboard from '../components/dashboard/Dashboard';
import type { DashboardData } from '../components/dashboard/Dashboard';
import DashboardTemplateModal from '../components/dashboard/DashboardTemplateModal';
import ChannelPickerModal from '../components/dashboard/ChannelPickerModal';
import ChartModule from '../components/dashboard/modules/ChartModule';
import Button from '../components/ui/Button';
import TirePressureChart from '../components/tools/TirePressureChart';
import TrackMap from '../components/maps/TrackMap';
import SectionEditor from '../components/tools/SectionEditor';
import SectionMetrics from '../components/tools/SectionMetrics';
import {
  convertTemp,
  distanceAxisTitle,
  storagePressureUnit,
  tempLabel,
  type DistanceUnit,
  type PressureUnit,
  type TempUnit,
} from '../utils/units';

const LS_SESSION_PRESSURE = 'session_pressure_unit';
const LS_SESSION_TEMP = 'session_temp_unit';

function readLsPressureUnit(): PressureUnit | null {
  try {
    const v = localStorage.getItem(LS_SESSION_PRESSURE);
    if (v === 'psi' || v === 'bar') return v;
  } catch {
    /* ignore */
  }
  return null;
}

function readLsTempUnit(): TempUnit | null {
  try {
    const v = localStorage.getItem(LS_SESSION_TEMP);
    if (v === 'c' || v === 'f') return v;
  } catch {
    /* ignore */
  }
  return null;
}

type ViewMode =
  | 'dashboard'
  | 'tire-pressure'
  | 'track-map'
  | 'channel-chart'
  | 'sections'
  | 'section-metrics'
  | 'info';

const TOOL_NAV: { mode: ViewMode; label: string }[] = [
  { mode: 'dashboard', label: 'Dashboard' },
  { mode: 'tire-pressure', label: 'Tire Pressure' },
  { mode: 'track-map', label: 'Track Map' },
  { mode: 'channel-chart', label: 'Channel Chart' },
  { mode: 'sections', label: 'Sections' },
  { mode: 'section-metrics', label: 'Section Metrics' },
  { mode: 'info', label: 'Session Info' },
];

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [view, setView] = useState<ViewMode>('dashboard');
  const [templateOpen, setTemplateOpen] = useState(false);
  const [dashLayout, setDashLayout] = useState<DashboardModule[] | null>(null);
  const [channelPickerOpen, setChannelPickerOpen] = useState(false);
  const [pickedChannels, setPickedChannels] = useState<string[]>(['speed', 'aps', 'pbrake_f', 'gear']);
  const [trackMapHeight, setTrackMapHeight] = useState(560);

  const { data: settingsData } = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiGet<SettingsResponse>('/api/settings'),
  });

  const sessionUnitsHydrated = useRef(false);
  const [pressureUnit, setPressureUnitState] = useState<PressureUnit>(
    () => readLsPressureUnit() ?? 'psi',
  );
  const [tempUnit, setTempUnitState] = useState<TempUnit>(() => readLsTempUnit() ?? 'c');

  useEffect(() => {
    if (!settingsData?.preferences || sessionUnitsHydrated.current) return;
    sessionUnitsHydrated.current = true;
    if (readLsPressureUnit() === null) {
      const p = String(settingsData.preferences.default_pressure_unit ?? 'psi').toLowerCase();
      setPressureUnitState(p === 'bar' ? 'bar' : 'psi');
    }
    if (readLsTempUnit() === null) {
      const t = String(settingsData.preferences.default_temp_unit ?? 'c').toLowerCase();
      setTempUnitState(t === 'f' ? 'f' : 'c');
    }
  }, [settingsData]);

  const setPressureUnit = useCallback((u: PressureUnit) => {
    setPressureUnitState(u);
    try {
      localStorage.setItem(LS_SESSION_PRESSURE, u);
    } catch {
      /* ignore */
    }
  }, []);

  const setTempUnit = useCallback((u: TempUnit) => {
    setTempUnitState(u);
    try {
      localStorage.setItem(LS_SESSION_TEMP, u);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!id) return;
    apiGet<{ layout: DashboardModule[] }>(`/api/sessions/${id}/dashboard-layout`)
      .then((r) => {
        if (r.layout?.length) setDashLayout(r.layout);
      })
      .catch(() => {});
  }, [id]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['session-detail', id],
    queryFn: () => apiGet<SessionDetailResponse>(`/api/sessions/${id}/detail`),
    enabled: !!id,
  });

  useEffect(() => {
    if (!data?.session) return;
    const s = data.session as Record<string, unknown>;
    const t = s.track != null ? String(s.track) : '';
    const ty = s.session_type != null ? String(s.session_type) : '';
    document.title = t && ty ? `LapForge - ${t} ${ty}` : 'LapForge - Session';
  }, [data?.session]);

  const updateMut = useMutation({
    mutationFn: (fields: Record<string, unknown>) =>
      apiPatch<{ ok: boolean }>(`/api/sessions/${id}`, fields),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['session-detail', id] }),
  });

  const [reprocessStream, setReprocessStream] = useState<{ pct: number; stage: string } | null>(null);
  const [reprocessErr, setReprocessErr] = useState<string | null>(null);

  const runReprocess = useCallback(async () => {
    if (!id) return;
    setReprocessErr(null);
    setReprocessStream({ pct: 0, stage: 'Starting…' });
    try {
      const resp = await fetch(`/api/sessions/${id}/reprocess`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!resp.ok) {
        let msg = 'Reprocess failed';
        try {
          const d = (await resp.json()) as { error?: string };
          if (d.error) msg = d.error;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      const reader = resp.body?.getReader();
      if (!reader) throw new Error('No response stream');
      const decoder = new TextDecoder();
      let buf = '';
      let sawComplete = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const clean = line.replace(/^data:\s*/, '').trim();
          if (!clean) continue;
          try {
            const evt = JSON.parse(clean) as {
              event: string;
              pct?: number;
              stage?: string;
              message?: string;
            };
            if (evt.event === 'progress') {
              setReprocessStream({
                pct: Math.min(100, Math.max(0, evt.pct ?? 0)),
                stage: evt.stage || 'Processing…',
              });
            } else if (evt.event === 'complete') {
              sawComplete = true;
              setReprocessStream(null);
              await qc.invalidateQueries({ queryKey: ['session-detail', id] });
            } else if (evt.event === 'error') {
              setReprocessStream(null);
              setReprocessErr(evt.message || 'Reprocess failed');
              return;
            }
          } catch {
            /* skip malformed line */
          }
        }
      }
      if (!sawComplete) {
        setReprocessStream(null);
        setReprocessErr('Stream ended unexpectedly.');
      }
    } catch (e) {
      setReprocessStream(null);
      setReprocessErr(e instanceof Error ? e.message : 'Reprocess failed');
    }
  }, [id, qc]);

  const onLayoutChange = useCallback(
    (layout: DashboardModule[]) => {
      setDashLayout(layout);
      if (id) {
        apiPut(`/api/sessions/${id}/dashboard-layout`, { layout }).catch(() => {});
      }
    },
    [id],
  );

  const session = data?.session as Record<string, string> | undefined;
  const trackName = session?.track ? String(session.track) : '';

  const { data: trackSections = [], isLoading: sectionsLoading } = useQuery({
    queryKey: ['track-sections', trackName],
    queryFn: () => apiGet<TrackSection[]>(`/api/sections/${encodeURIComponent(trackName)}`),
    enabled: !!trackName && (view === 'sections' || view === 'section-metrics'),
  });

  const dashData = data?.dashboard_data as DashboardData | null;

  const tpmsSeriesPressureUnit = useMemo((): PressureUnit => {
    const meta = dashData?.channel_meta;
    if (!meta) return 'bar';
    const k = (['tpms_press_fl', 'tpms_press_fr', 'tpms_press_rl', 'tpms_press_rr'] as const).find(
      (x) => meta[x],
    );
    if (!k) return 'bar';
    return storagePressureUnit(meta[k], k);
  }, [dashData?.channel_meta]);

  useEffect(() => {
    if (!dashData?.series) return;
    const keys = Object.keys(dashData.series);
    setPickedChannels((prev) => {
      const next = prev.filter((k) => keys.includes(k));
      if (next.length > 0) return next;
      return keys.slice(0, Math.min(4, keys.length));
    });
  }, [dashData]);

  const distanceUnit = useMemo((): DistanceUnit => {
    const u = String(settingsData?.preferences?.default_distance_unit ?? 'km').toLowerCase();
    return u === 'mi' ? 'mi' : 'km';
  }, [settingsData?.preferences?.default_distance_unit]);

  useEffect(() => {
    if (view !== 'track-map') return;
    function update() {
      setTrackMapHeight(Math.max(420, window.innerHeight - 200));
    }
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [view]);

  const xValues = useMemo(
    () => (dashData ? (dashData.has_distance ? dashData.distances : dashData.times) : []),
    [dashData],
  );
  const xLabel = dashData
    ? dashData.has_distance
      ? distanceAxisTitle(distanceUnit)
      : 'Time (s)'
    : '';
  const xCursorField = dashData?.has_distance ? ('distance' as const) : ('time' as const);
  const lapSplitsForChart = dashData
    ? dashData.has_distance
      ? dashData.lap_split_distances
      : dashData.lap_splits
    : [];

  const sectionOverlays = useMemo(
    () =>
      (dashData?.sections ?? []).map((s) => ({
        name: s.name,
        start: s.start_distance,
        end: s.end_distance,
      })),
    [dashData?.sections],
  );

  const sectionEditorChannels = useMemo(() => {
    if (!dashData?.series) return [];
    const preferred = ['speed', 'aps', 'pbrake_f'].filter((k) => dashData.series[k]);
    const fallback = Object.keys(dashData.series).slice(0, 3);
    const useKeys = preferred.length ? preferred : fallback;
    return useKeys.map((k) => ({
      label: dashData.channel_meta[k]?.label ?? k,
      data: dashData.series[k],
    }));
  }, [dashData]);

  if (isLoading) {
    return (
      <div className="page-content">
        <p className="muted">Loading session...</p>
      </div>
    );
  }
  if (error || !data || !session) {
    return (
      <div className="page-content">
        <p className="muted">Session not found.</p>
      </div>
    );
  }

  const tpmsSeries = dashData?.series;
  const tirePressureOk = Boolean(
    tpmsSeries &&
      xValues.length > 0 &&
      ['tpms_press_fl', 'tpms_press_fr', 'tpms_press_rl', 'tpms_press_rr'].every(
        (k) => Array.isArray(tpmsSeries[k]) && tpmsSeries[k].length === xValues.length,
      ),
  );

  return (
    <div className="page-content session-detail">
      <div className="session-detail-header">
        <div>
          <Link to="/sessions" className="back-link">
            ← Sessions
          </Link>
          <h1>
            {session.track} — {session.session_type}
          </h1>
          <p className="muted">
            {session.car} / {session.driver}
          </p>
        </div>
        <div className="session-detail-actions">
          {data.needs_reprocess && data.can_reprocess && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => runReprocess()}
              disabled={reprocessStream !== null}
            >
              Reprocess
            </Button>
          )}
        </div>
      </div>

      {reprocessStream && (
        <div className="card reprocess-progress-card" style={{ marginBottom: '1rem', padding: '0.75rem 1rem' }}>
          <div className="progress-bar-wrap">
            <div className="progress-bar-fill" style={{ width: `${reprocessStream.pct}%` }} />
          </div>
          <p className="muted" style={{ margin: '0.35rem 0 0' }}>
            {reprocessStream.stage} ({reprocessStream.pct}%)
          </p>
        </div>
      )}
      {reprocessErr && (
        <div className="alert alert-danger" style={{ marginBottom: '1rem' }}>
          {reprocessErr}
        </div>
      )}

      <div className="session-tabs-bar">
        <nav className="session-tabs" aria-label="Analysis tools">
          {TOOL_NAV.map(({ mode, label }) => (
            <button
              key={mode}
              type="button"
              className={`session-tab${view === mode ? ' active' : ''}`}
              onClick={() => setView(mode)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="session-tabs-right" role="toolbar" aria-label="Session display units">
          <div className="unit-toggle-group" role="group" aria-label="Pressure unit">
            <button
              type="button"
              className={`unit-toggle-btn${pressureUnit === 'psi' ? ' active' : ''}`}
              onClick={() => setPressureUnit('psi')}
            >
              PSI
            </button>
            <button
              type="button"
              className={`unit-toggle-btn${pressureUnit === 'bar' ? ' active' : ''}`}
              onClick={() => setPressureUnit('bar')}
            >
              Bar
            </button>
          </div>
          <div className="unit-toggle-group" role="group" aria-label="Temperature unit">
            <button
              type="button"
              className={`unit-toggle-btn${tempUnit === 'c' ? ' active' : ''}`}
              onClick={() => setTempUnit('c')}
            >
              {tempLabel('c')}
            </button>
            <button
              type="button"
              className={`unit-toggle-btn${tempUnit === 'f' ? ' active' : ''}`}
              onClick={() => setTempUnit('f')}
            >
              {tempLabel('f')}
            </button>
          </div>
          {view === 'dashboard' && (
            <Button variant="ghost" size="sm" onClick={() => setTemplateOpen(true)}>
              Templates
            </Button>
          )}
        </div>
      </div>

      <div className="session-detail-main">
          <CursorSyncProvider>
            {view === 'dashboard' && dashData && (
              <>
                <Dashboard
                  data={dashData}
                  sessionId={id!}
                  initialLayout={dashLayout}
                  onLayoutChange={onLayoutChange}
                  pressureUnit={pressureUnit}
                  tempUnit={tempUnit}
                  distanceUnit={distanceUnit}
                />
                <DashboardTemplateModal
                  open={templateOpen}
                  onClose={() => setTemplateOpen(false)}
                  currentLayout={dashLayout ?? []}
                  onApplyTemplate={(layout) => {
                    setDashLayout(layout);
                    onLayoutChange(layout);
                  }}
                />
              </>
            )}
            {view === 'dashboard' && !dashData && (
              <p className="muted">No dashboard data for this session.</p>
            )}

            {view === 'tire-pressure' && (
              <div className="card" style={{ padding: '1rem' }}>
                <h2 style={{ margin: '0 0 0.75rem', fontSize: '1.1rem' }}>Tire Pressure Analysis</h2>
                {!dashData || !tirePressureOk || !tpmsSeries ? (
                  <p className="muted">No TPMS pressure channels for this session.</p>
                ) : (
                  <TirePressureChart
                    xValues={xValues}
                    xLabel={xLabel}
                    pressureFL={tpmsSeries.tpms_press_fl}
                    pressureFR={tpmsSeries.tpms_press_fr}
                    pressureRL={tpmsSeries.tpms_press_rl}
                    pressureRR={tpmsSeries.tpms_press_rr}
                    target={dashData.target_pressure_psi ?? null}
                    height={320}
                    xCursorField={xCursorField}
                    seriesPressureUnit={tpmsSeriesPressureUnit}
                    displayPressureUnit={pressureUnit}
                    distanceDisplayUnit={distanceUnit}
                  />
                )}
              </div>
            )}

            {view === 'track-map' && (
              <div className="session-tool-map-fill">
                {dashData?.points && dashData.points.length >= 2 ? (
                  <TrackMap
                    points={dashData.points}
                    sections={sectionOverlays}
                    lapSplits={lapSplitsForChart}
                    height={trackMapHeight}
                  />
                ) : (
                  <p className="muted">No GPS data for this session.</p>
                )}
              </div>
            )}

            {view === 'channel-chart' && (
              <div className="session-channel-chart-tool card" style={{ padding: '1rem' }}>
                {!dashData ? (
                  <p className="muted">No telemetry for this session.</p>
                ) : (
                  <>
                    <div className="chart-toolbar">
                      <Button variant="secondary" size="sm" onClick={() => setChannelPickerOpen(true)}>
                        Channels
                      </Button>
                    </div>
                    <div style={{ height: 420 }}>
                      <ChartModule
                        xValues={xValues}
                        xLabel={xLabel}
                        xCursorField={xCursorField}
                        series={dashData.series}
                        channelMeta={dashData.channel_meta}
                        channelKeys={pickedChannels}
                        lapSplits={lapSplitsForChart}
                        sections={dashData.sections}
                        pressureUnit={pressureUnit}
                        tempUnit={tempUnit}
                        distanceUnit={distanceUnit}
                      />
                    </div>
                    <ChannelPickerModal
                      open={channelPickerOpen}
                      onClose={() => setChannelPickerOpen(false)}
                      channelsByCategory={dashData.channels_by_category}
                      channelMeta={dashData.channel_meta}
                      selected={pickedChannels}
                      onApply={setPickedChannels}
                    />
                  </>
                )}
              </div>
            )}

            {view === 'sections' && (
              <div className="card" style={{ padding: '1rem' }}>
                {!dashData ? (
                  <p className="muted">No telemetry for this session.</p>
                ) : !trackName ? (
                  <p className="muted">No track name for this session.</p>
                ) : sectionsLoading ? (
                  <p className="muted">Loading sections...</p>
                ) : (
                  <SectionEditor
                    sessionId={id!}
                    trackName={trackName}
                    points={dashData.points ?? []}
                    xValues={xValues}
                    xLabel={xLabel}
                    channels={sectionEditorChannels}
                    sections={trackSections}
                    onSectionsChange={() => qc.invalidateQueries({ queryKey: ['session-detail', id] })}
                  />
                )}
              </div>
            )}

            {view === 'section-metrics' && (
              <div className="card" style={{ padding: '1rem' }}>
                {!dashData ? (
                  <p className="muted">No telemetry for this session.</p>
                ) : sectionsLoading ? (
                  <p className="muted">Loading sections...</p>
                ) : (
                  <SectionMetrics
                    sections={trackSections}
                    dashData={dashData}
                    sessionId={id!}
                    distanceUnit={distanceUnit}
                  />
                )}
              </div>
            )}

            {view === 'info' && (
              <SessionInfoPanel
                session={data}
                tempUnit={tempUnit}
                onUpdate={(fields) => updateMut.mutate(fields)}
              />
            )}
          </CursorSyncProvider>
        </div>
    </div>
  );
}

function SessionInfoPanel({
  session: data,
  tempUnit,
  onUpdate,
}: {
  session: SessionDetailResponse;
  tempUnit: TempUnit;
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

  function fmtStoredTemp(cVal: unknown): string {
    if (cVal == null) return '—';
    const v = Number(cVal);
    if (!Number.isFinite(v)) return '—';
    const disp = tempUnit === 'f' ? convertTemp(v, 'c', 'f') : v;
    return `${disp.toFixed(1)}${tempLabel(tempUnit)}`;
  }

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
        <div>
          <dt>Track</dt>
          <dd>{String(s.track)}</dd>
        </div>
        <div>
          <dt>Type</dt>
          <dd>{String(s.session_type)}</dd>
        </div>
        <div>
          <dt>Car/Driver</dt>
          <dd>
            {data.car_driver
              ? `${data.car_driver.car_identifier} / ${data.car_driver.driver_name}`
              : '—'}
          </dd>
        </div>
        <div>
          <dt>Tire Set</dt>
          <dd>{data.tire_set?.name ?? '—'}</dd>
        </div>

        {editing ? (
          <>
            <div>
              <dt>Ambient temp ({tempLabel('c')} stored)</dt>
              <dd>
                <input
                  className="form-input form-input-sm"
                  value={form.ambient_temp_c}
                  onChange={(e) => setForm({ ...form, ambient_temp_c: e.target.value })}
                />
              </dd>
            </div>
            <div>
              <dt>Track temp ({tempLabel('c')} stored)</dt>
              <dd>
                <input
                  className="form-input form-input-sm"
                  value={form.track_temp_c}
                  onChange={(e) => setForm({ ...form, track_temp_c: e.target.value })}
                />
              </dd>
            </div>
            <div>
              <dt>Target PSI</dt>
              <dd>
                <input
                  className="form-input form-input-sm"
                  value={form.target_pressure_psi}
                  onChange={(e) => setForm({ ...form, target_pressure_psi: e.target.value })}
                />
              </dd>
            </div>
            <div>
              <dt>Tire Set</dt>
              <dd>
                <select
                  className="form-select form-select-sm"
                  value={form.tire_set_id}
                  onChange={(e) => setForm({ ...form, tire_set_id: e.target.value })}
                >
                  <option value="">None</option>
                  {data.tire_sets.map((ts) => (
                    <option key={ts.id} value={ts.id}>
                      {ts.name}
                    </option>
                  ))}
                </select>
              </dd>
            </div>
            <div>
              <dt>Track Layout</dt>
              <dd>
                <select
                  className="form-select form-select-sm"
                  value={form.track_layout_id}
                  onChange={(e) => setForm({ ...form, track_layout_id: e.target.value })}
                >
                  <option value="">None</option>
                  {data.track_layouts.map((tl) => (
                    <option key={tl.id} value={tl.id}>
                      {tl.name}
                    </option>
                  ))}
                </select>
              </dd>
            </div>
            <div>
              <dt>Lap Notes</dt>
              <dd>
                <textarea
                  className="form-input form-input-sm"
                  value={form.lap_count_notes}
                  onChange={(e) => setForm({ ...form, lap_count_notes: e.target.value })}
                />
              </dd>
            </div>
            <div className="form-actions">
              <Button size="sm" onClick={handleSave}>
                Save
              </Button>
            </div>
          </>
        ) : (
          <>
            <div>
              <dt>Ambient temp</dt>
              <dd>{fmtStoredTemp(s.ambient_temp_c)}</dd>
            </div>
            <div>
              <dt>Track temp</dt>
              <dd>{fmtStoredTemp(s.track_temp_c)}</dd>
            </div>
            <div>
              <dt>Target PSI</dt>
              <dd>{s.target_pressure_psi != null ? String(s.target_pressure_psi) : '—'}</dd>
            </div>
            <div>
              <dt>Smoothing</dt>
              <dd>{data.smoothing_level}</dd>
            </div>
            <div>
              <dt>Notes</dt>
              <dd>{String(s.lap_count_notes || '—')}</dd>
            </div>
          </>
        )}
      </dl>
    </div>
  );
}
