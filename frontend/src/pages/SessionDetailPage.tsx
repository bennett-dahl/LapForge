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
import Button from '../components/ui/Button';
import TirePressureChart from '../components/tools/TirePressureChart';
import SectionEditor from '../components/tools/SectionEditor';
import SectionMetrics from '../components/tools/SectionMetrics';
import {
  convertPressure,
  convertTemp,
  distanceAxisTitle,
  pressureLabel,
  storagePressureUnit,
  tempLabel,
  type DistanceUnit,
  type PressureUnit,
  type SpeedUnit,
  type TempUnit,
} from '../utils/units';
import SessionRolloutPressureModal from '../components/session/SessionRolloutPressureModal';
import { mergeSessionTypeOptions } from '../utils/sessionTypes';
import { toggleExcludedLap } from '../utils/excludedLaps';

const LS_SESSION_PRESSURE = 'session_pressure_unit';
const LS_SESSION_TEMP = 'session_temp_unit';
const LS_SESSION_SPEED = 'session_speed_unit';

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

function readLsSpeedUnit(): SpeedUnit | null {
  try {
    const v = localStorage.getItem(LS_SESSION_SPEED);
    if (v === 'km/h' || v === 'mph') return v;
  } catch {
    /* ignore */
  }
  return null;
}

type ViewMode =
  | 'dashboard'
  | 'tire-pressure'
  | 'track-map'
  | 'section-metrics'
  | 'info';

const TOOL_NAV: { mode: ViewMode; label: string }[] = [
  { mode: 'dashboard', label: 'Dashboard' },
  { mode: 'tire-pressure', label: 'Tire Pressure' },
  { mode: 'track-map', label: 'Track Map' },
  { mode: 'section-metrics', label: 'Section Metrics' },
  { mode: 'info', label: 'Session Info' },
];

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [view, setView] = useState<ViewMode>('dashboard');
  const [templateOpen, setTemplateOpen] = useState(false);
  const [dashLayout, setDashLayout] = useState<DashboardModule[] | null>(null);
  const [rolloutModalOpen, setRolloutModalOpen] = useState(false);

  const { data: settingsData } = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiGet<SettingsResponse>('/api/settings'),
  });

  const sessionUnitsHydrated = useRef(false);
  const [pressureUnit, setPressureUnitState] = useState<PressureUnit>(
    () => readLsPressureUnit() ?? 'psi',
  );
  const [tempUnit, setTempUnitState] = useState<TempUnit>(() => readLsTempUnit() ?? 'c');
  const [speedUnit, setSpeedUnitState] = useState<SpeedUnit>(() => readLsSpeedUnit() ?? 'km/h');

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
    if (readLsSpeedUnit() === null) {
      const d = String(settingsData.preferences.default_distance_unit ?? 'km').toLowerCase();
      setSpeedUnitState(d === 'mi' ? 'mph' : 'km/h');
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

  const setSpeedUnit = useCallback((u: SpeedUnit) => {
    setSpeedUnitState(u);
    try {
      localStorage.setItem(LS_SESSION_SPEED, u);
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
    staleTime: 30_000,
    refetchOnWindowFocus: false,
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

  const sessionTypeOptions = useMemo(
    () =>
      mergeSessionTypeOptions(
        settingsData?.preferences?.session_type_options as string[] | undefined,
        session ? String(session.session_type ?? '') : undefined,
      ),
    [settingsData?.preferences?.session_type_options, session?.session_type],
  );

  const { data: trackSections = [], isLoading: sectionsLoading } = useQuery({
    queryKey: ['track-sections', trackName],
    queryFn: () => apiGet<TrackSection[]>(`/api/sections/${encodeURIComponent(trackName)}`),
    enabled: !!trackName && (view === 'track-map' || view === 'section-metrics'),
  });

  const dashData = data?.dashboard_data as DashboardData | null;

  const savedExcludedLaps = useMemo(() => {
    if (dashData && Array.isArray(dashData.excluded_laps)) {
      return [...new Set((dashData.excluded_laps as unknown[]).map((x) => Number(x)))].sort(
        (a, b) => a - b,
      );
    }
    return [0];
  }, [dashData && Array.isArray(dashData.excluded_laps) ? JSON.stringify(dashData.excluded_laps) : null]);

  const [pendingExclusions, setPendingExclusions] = useState<number[] | null>(null);
  const excludedLaps = pendingExclusions ?? savedExcludedLaps;
  const hasExclusionDraft = pendingExclusions !== null;

  const onToggleExcludeLap = useCallback(
    (segmentIndex: number) => {
      setPendingExclusions((prev) =>
        toggleExcludedLap(prev ?? savedExcludedLaps, segmentIndex),
      );
    },
    [savedExcludedLaps],
  );

  const applyExclusionsMut = useMutation({
    mutationFn: (laps: number[]) =>
      apiPatch<{ ok?: boolean; excluded_laps: number[] }>(`/api/sessions/${id!}`, {
        excluded_laps: laps,
      }),
    onSuccess: () => {
      setPendingExclusions(null);
      qc.invalidateQueries({ queryKey: ['session-detail', id] });
    },
  });

  const onApplyExclusions = useCallback(() => {
    if (pendingExclusions == null || !id) return;
    applyExclusionsMut.mutate(pendingExclusions);
  }, [pendingExclusions, id, applyExclusionsMut]);

  const onDiscardExclusions = useCallback(() => {
    setPendingExclusions(null);
  }, []);

  const referenceLapOptions = useMemo(() => {
    const splits = dashData?.lap_splits;
    if (!splits?.length) return [];
    const out: { segmentIndex: number; label: string }[] = [];
    for (let i = 0; i < splits.length - 1; i++) {
      const dt = splits[i + 1]! - splits[i]!;
      if (dt <= 0) continue;
      const m = Math.floor(dt / 60);
      const sec = dt % 60;
      const timeStr = m > 0 ? `${m}:${sec.toFixed(3).padStart(6, '0')}` : dt.toFixed(3);
      out.push({ segmentIndex: i, label: `Lap ${i + 1} (${timeStr}s)` });
    }
    return out;
  }, [dashData?.lap_splits]);

  const refLapMut = useMutation({
    mutationFn: (lapIndex: number) =>
      apiPatch<{ ok?: boolean; reference_lap_index?: number }>(`/api/sessions/${id!}`, {
        apply_reference_lap_index: lapIndex,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['session-detail', id] }),
  });

  const handleApplyReferenceLap = useCallback(
    async (segmentIndex: number) => {
      await refLapMut.mutateAsync(segmentIndex);
    },
    [refLapMut],
  );

  const tpmsSeriesPressureUnit = useMemo((): PressureUnit => {
    const meta = dashData?.channel_meta;
    if (!meta) return 'bar';
    const k = (['tpms_press_fl', 'tpms_press_fr', 'tpms_press_rl', 'tpms_press_rr'] as const).find(
      (x) => meta[x],
    );
    if (!k) return 'bar';
    return storagePressureUnit(meta[k], k);
  }, [dashData?.channel_meta]);


  const distanceUnit = useMemo((): DistanceUnit => {
    const u = String(settingsData?.preferences?.default_distance_unit ?? 'km').toLowerCase();
    return u === 'mi' ? 'mi' : 'km';
  }, [settingsData?.preferences?.default_distance_unit]);


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


  const sectionEditorData = useMemo(() => {
    if (!dashData?.has_distance) return null;

    const mapLapRaw = view === 'track-map' ? dashData.map_lap : null;
    const mapLapHasSeries = mapLapRaw != null && Object.keys(mapLapRaw.series ?? {}).length > 0;
    const mapLap = mapLapHasSeries ? mapLapRaw : null;
    const distances = mapLap?.distances ?? dashData.distances;
    const series = mapLap?.series ?? dashData.series;
    const rawMeta = mapLap?.channel_meta ?? dashData.channel_meta;
    const meta: Record<string, { label: string; unit?: string; category?: string }> = {};
    for (const [k, v] of Object.entries(rawMeta)) {
      meta[k] = { ...v, label: v.label ?? (v as { display?: string }).display ?? k };
    }

    if (!series || !distances?.length) return null;

    const validSeries: Record<string, number[]> = {};
    for (const k of Object.keys(series)) {
      const arr = series[k];
      if (Array.isArray(arr) && arr.length > 0) validSeries[k] = arr;
    }

    const seriesKeys = Object.keys(validSeries);
    const lowerMap: Record<string, string> = {};
    for (const k of seriesKeys) lowerMap[k.toLowerCase()] = k;

    const preferredLower = ['speed', 'aps', 'pbrake_f'];
    const preferred = preferredLower
      .map((p) => lowerMap[p])
      .filter((k): k is string => k != null && validSeries[k]?.length > 0);
    const fallback = seriesKeys.filter((k) => validSeries[k]?.length > 0).slice(0, 3);
    const defaultKeys = preferred.length ? preferred : fallback;

    const defaultChannels = defaultKeys.map((k) => ({
      label: (meta[k] as { label?: string; display?: string })?.label
        ?? (meta[k] as { display?: string })?.display
        ?? k,
      data: validSeries[k],
    }));

    const byCat: Record<string, string[]> = {};
    for (const k of seriesKeys) {
      if (!validSeries[k]?.length) continue;
      const cat = meta[k]?.category ?? 'Other';
      (byCat[cat] ??= []).push(k);
    }

    return {
      distances,
      series: validSeries,
      defaultChannels,
      channelMeta: meta,
      channelsByCategory: byCat,
      defaultChannelKeys: defaultKeys,
    };
  }, [dashData, view]);

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
            {session.created_at ? (
              <span style={{ marginLeft: 12, opacity: 0.7 }}>
                {new Date(session.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
              </span>
            ) : null}
          </p>
        </div>
        <div className="session-detail-actions">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => runReprocess()}
            disabled={reprocessStream !== null}
          >
            Reprocess
          </Button>
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
          <div className="unit-toggle-group" role="group" aria-label="Speed unit">
            {(['km/h', 'mph'] as SpeedUnit[]).map((u) => (
              <button
                key={u}
                type="button"
                className={`unit-toggle-btn${speedUnit === u ? ' active' : ''}`}
                onClick={() => setSpeedUnit(u)}
              >
                {u}
              </button>
            ))}
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
                  excludedLaps={excludedLaps}
                  onToggleExcludeLap={onToggleExcludeLap}
                  hasExclusionDraft={hasExclusionDraft}
                  onApplyExclusions={onApplyExclusions}
                  onDiscardExclusions={onDiscardExclusions}
                  applyExclusionsPending={applyExclusionsMut.isPending}
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
              <>
                <RolloutCard
                  session={data.session}
                  pressureUnit={pressureUnit}
                  onEdit={() => setRolloutModalOpen(true)}
                />
                <SessionRolloutPressureModal
                  open={rolloutModalOpen}
                  onClose={() => setRolloutModalOpen(false)}
                  onSuccess={() => qc.invalidateQueries({ queryKey: ['session-detail', id] })}
                  sessionId={id!}
                  displayUnit={pressureUnit}
                  initialCorners={{
                    fl: safeBarToDisplay(data.session.roll_out_pressure_fl, pressureUnit),
                    fr: safeBarToDisplay(data.session.roll_out_pressure_fr, pressureUnit),
                    rl: safeBarToDisplay(data.session.roll_out_pressure_rl, pressureUnit),
                    rr: safeBarToDisplay(data.session.roll_out_pressure_rr, pressureUnit),
                  }}
                />
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
              </>
            )}

            {view === 'track-map' && (
              !dashData?.points || dashData.points.length < 2 ? (
                <p className="muted">No GPS data for this session.</p>
              ) : !trackName ? (
                <p className="muted">No track name for this session.</p>
              ) : sectionsLoading ? (
                <p className="muted">Loading sections...</p>
              ) : (
                <SectionEditor
                  sessionId={id!}
                  trackName={trackName}
                  points={sectionEditorData && dashData.map_lap?.points && dashData.map_lap.points.length >= 2 && Object.keys(dashData.map_lap.series ?? {}).length > 0 ? dashData.map_lap.points : dashData.points}
                  xValues={sectionEditorData?.distances ?? xValues}
                  xLabel="Distance (m)"
                  defaultChannels={sectionEditorData?.defaultChannels ?? []}
                  series={sectionEditorData?.series ?? {}}
                  channelMeta={sectionEditorData?.channelMeta ?? dashData.channel_meta}
                  channelsByCategory={sectionEditorData?.channelsByCategory ?? {}}
                  defaultChannelKeys={sectionEditorData?.defaultChannelKeys ?? []}
                  sections={trackSections}
                  onSectionsChange={() => qc.invalidateQueries({ queryKey: ['session-detail', id] })}
                  referenceLapOptions={referenceLapOptions}
                  appliedReferenceIndex={dashData.map_lap_segment_index ?? dashData.reference_lap_index ?? null}
                  onApplyReferenceLap={handleApplyReferenceLap}
                  referenceLapApplyPending={refLapMut.isPending}
                  trackLayouts={data.track_layouts}
                  trackLayoutId={(session.track_layout_id as string | null | undefined) ?? null}
                />
              )
            )}

            {view === 'section-metrics' && (
              !dashData ? (
                <p className="muted">No telemetry for this session.</p>
              ) : sectionsLoading ? (
                <p className="muted">Loading sections...</p>
              ) : (
                <SectionMetrics
                  sections={trackSections}
                  dashData={dashData}
                  sessionId={id!}
                  speedUnit={speedUnit}
                  pressureUnit={pressureUnit}
                  excludedLaps={excludedLaps}
                  onToggleExcludeLap={onToggleExcludeLap}
                  hasExclusionDraft={hasExclusionDraft}
                  onApplyExclusions={onApplyExclusions}
                  onDiscardExclusions={onDiscardExclusions}
                  applyExclusionsPending={applyExclusionsMut.isPending}
                  sessionMeta={{
                    driver: data.car_driver?.driver_name ?? String(session.driver ?? ''),
                    track: String(session.track ?? ''),
                    sessionType: String(session.session_type ?? ''),
                    car: data.car_driver?.car_identifier ?? String(session.car ?? ''),
                    outingNumber: session.outing_number ? String(session.outing_number) : undefined,
                    sessionNumber: session.session_number ? String(session.session_number) : undefined,
                    lapCount: data.session_summary?.lap_count ?? null,
                    fastestLapTime: data.session_summary?.fastest_lap_time ?? null,
                    tireSet: data.tire_set?.name ?? null,
                    ambientTempC: session.ambient_temp_c != null ? Number(session.ambient_temp_c) : null,
                    trackTempC: session.track_temp_c != null ? Number(session.track_temp_c) : null,
                    notes: session.lap_count_notes ? String(session.lap_count_notes) : null,
                  }}
                />
              )
            )}

            {view === 'info' && (
              <SessionInfoPanel
                session={data}
                tempUnit={tempUnit}
                sessionTypeOptions={sessionTypeOptions}
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
  sessionTypeOptions,
  onUpdate,
}: {
  session: SessionDetailResponse;
  tempUnit: TempUnit;
  sessionTypeOptions: string[];
  onUpdate: (fields: Record<string, unknown>) => void;
}) {
  const s = data.session as Record<string, unknown>;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    track: String(s.track ?? ''),
    session_type: String(s.session_type ?? ''),
    car_driver_id: String(s.car_driver_id ?? ''),
    outing_number: String(s.outing_number ?? ''),
    session_number: String(s.session_number ?? ''),
    ambient_temp_c: String(s.ambient_temp_c ?? ''),
    track_temp_c: String(s.track_temp_c ?? ''),
    weather_condition: String(s.weather_condition ?? ''),
    tire_set_id: String(s.tire_set_id ?? ''),
    track_layout_id: String(s.track_layout_id ?? ''),
    target_pressure_psi: String(s.target_pressure_psi ?? ''),
    lap_count_notes: String(s.lap_count_notes ?? ''),
  });

  const ss = data.session_summary;

  function fmtStoredTemp(cVal: unknown): string {
    if (cVal == null) return '—';
    const v = Number(cVal);
    if (!Number.isFinite(v)) return '—';
    const disp = tempUnit === 'f' ? convertTemp(v, 'c', 'f') : v;
    return `${disp.toFixed(1)}${tempLabel(tempUnit)}`;
  }

  function fmtDuration(totalSec: number): string {
    const m = Math.floor(totalSec / 60);
    const sec = totalSec - m * 60;
    return m > 0 ? `${m}m ${sec.toFixed(1)}s` : `${sec.toFixed(1)}s`;
  }

  function fmtRollOut(corner: string, val: unknown) {
    if (val == null) return null;
    const v = Number(val);
    if (!Number.isFinite(v)) return null;
    const psi = v * 14.5038;
    return (
      <div key={corner}>
        <dt>Roll-out {corner}</dt>
        <dd>{psi.toFixed(1)} psi</dd>
      </div>
    );
  }

  function handleSave() {
    onUpdate({
      track: form.track || null,
      session_type: form.session_type || null,
      car_driver_id: form.car_driver_id || null,
      outing_number: form.outing_number || null,
      session_number: form.session_number || null,
      ambient_temp_c: parseFloat(form.ambient_temp_c) || null,
      track_temp_c: parseFloat(form.track_temp_c) || null,
      weather_condition: form.weather_condition || null,
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
        <Button variant="ghost" size="sm" onClick={() => {
          if (!editing) {
            setForm({
              track: String(s.track ?? ''),
              session_type: String(s.session_type ?? ''),
              car_driver_id: String(s.car_driver_id ?? ''),
              outing_number: String(s.outing_number ?? ''),
              session_number: String(s.session_number ?? ''),
              ambient_temp_c: String(s.ambient_temp_c ?? ''),
              track_temp_c: String(s.track_temp_c ?? ''),
              weather_condition: String(s.weather_condition ?? ''),
              tire_set_id: String(s.tire_set_id ?? ''),
              track_layout_id: String(s.track_layout_id ?? ''),
              target_pressure_psi: String(s.target_pressure_psi ?? ''),
              lap_count_notes: String(s.lap_count_notes ?? ''),
            });
          }
          setEditing(!editing);
        }}>
          {editing ? 'Cancel' : 'Edit'}
        </Button>
      </div>

      <dl className="session-info-dl">
        {editing ? (
          <>
            <div>
              <dt>Track</dt>
              <dd>
                <input
                  className="form-input form-input-sm"
                  value={form.track}
                  onChange={(e) => setForm({ ...form, track: e.target.value })}
                />
              </dd>
            </div>
            <div>
              <dt>Type</dt>
              <dd>
                <select
                  className="form-select form-select-sm"
                  value={form.session_type}
                  onChange={(e) => setForm({ ...form, session_type: e.target.value })}
                >
                  {sessionTypeOptions.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </dd>
            </div>
            <div>
              <dt>Car / Driver</dt>
              <dd>
                <select
                  className="form-select form-select-sm"
                  value={form.car_driver_id}
                  onChange={(e) => setForm({ ...form, car_driver_id: e.target.value })}
                >
                  <option value="">None</option>
                  {data.car_drivers.map((cd) => (
                    <option key={cd.id} value={cd.id}>
                      {cd.car_identifier} / {cd.driver_name}
                    </option>
                  ))}
                </select>
              </dd>
            </div>
            <div>
              <dt>Outing #</dt>
              <dd>
                <input
                  className="form-input form-input-sm"
                  value={form.outing_number}
                  onChange={(e) => setForm({ ...form, outing_number: e.target.value })}
                />
              </dd>
            </div>
            <div>
              <dt>Session #</dt>
              <dd>
                <input
                  className="form-input form-input-sm"
                  value={form.session_number}
                  onChange={(e) => setForm({ ...form, session_number: e.target.value })}
                />
              </dd>
            </div>
          </>
        ) : (
          <>
            <div>
              <dt>Track</dt>
              <dd>{String(s.track || '—')}</dd>
            </div>
            <div>
              <dt>Type</dt>
              <dd>{String(s.session_type || '—')}</dd>
            </div>
            <div>
              <dt>Car</dt>
              <dd>{data.car_driver?.car_identifier ?? String(s.car || '—')}</dd>
            </div>
            <div>
              <dt>Driver</dt>
              <dd>{data.car_driver?.driver_name ?? String(s.driver || '—')}</dd>
            </div>
            {s.outing_number ? (
              <div>
                <dt>Outing #</dt>
                <dd>{String(s.outing_number)}</dd>
              </div>
            ) : null}
            {s.session_number ? (
              <div>
                <dt>Session #</dt>
                <dd>{String(s.session_number)}</dd>
              </div>
            ) : null}
          </>
        )}

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
              <dt>Weather</dt>
              <dd>
                <select
                  className="form-select form-select-sm"
                  value={form.weather_condition}
                  onChange={(e) => setForm({ ...form, weather_condition: e.target.value })}
                >
                  <option value="">—</option>
                  <option value="Clear">Clear</option>
                  <option value="Mixed">Mixed</option>
                  <option value="Overcast">Overcast</option>
                  <option value="Light Rain">Light Rain</option>
                  <option value="Med Rain">Med Rain</option>
                  <option value="Heavy Rain">Heavy Rain</option>
                </select>
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
              <dt>Tire Set</dt>
              <dd>{data.tire_set?.name ?? '—'}</dd>
            </div>
            <div>
              <dt>Ambient Temp</dt>
              <dd>{fmtStoredTemp(s.ambient_temp_c)}</dd>
            </div>
            <div>
              <dt>Track Temp</dt>
              <dd>{fmtStoredTemp(s.track_temp_c)}</dd>
            </div>
            <div>
              <dt>Weather</dt>
              <dd>{String(s.weather_condition || '—')}</dd>
            </div>
            <div>
              <dt>Target PSI</dt>
              <dd>{s.target_pressure_psi != null ? String(s.target_pressure_psi) : '—'}</dd>
            </div>
            {fmtRollOut('FL', s.roll_out_pressure_fl)}
            {fmtRollOut('FR', s.roll_out_pressure_fr)}
            {fmtRollOut('RL', s.roll_out_pressure_rl)}
            {fmtRollOut('RR', s.roll_out_pressure_rr)}
            <div>
              <dt>Laps</dt>
              <dd>{ss?.lap_count != null ? String(ss.lap_count) : '—'}</dd>
            </div>
            {ss?.fastest_lap_time != null && (
              <div>
                <dt>Fastest Lap</dt>
                <dd>{Number(ss.fastest_lap_time).toFixed(3)}s</dd>
              </div>
            )}
            {ss?.duration_s != null && (
              <div>
                <dt>Duration</dt>
                <dd>{fmtDuration(ss.duration_s)}</dd>
              </div>
            )}
            <div>
              <dt>Channels</dt>
              <dd>{ss?.channel_count ?? '—'}</dd>
            </div>
            {ss?.sample_count != null && (
              <div>
                <dt>Samples</dt>
                <dd>{ss.sample_count.toLocaleString()}</dd>
              </div>
            )}
            {ss?.has_gps && (
              <div>
                <dt>GPS</dt>
                <dd>Yes</dd>
              </div>
            )}
            {ss?.available_categories && ss.available_categories.length > 0 && (
              <div>
                <dt>Categories</dt>
                <dd>{ss.available_categories.join(', ')}</dd>
              </div>
            )}
            <div>
              <dt>Smoothing</dt>
              <dd>{data.smoothing_level}</dd>
            </div>
            {(() => {
              const tl = data.track_layouts.find((l) => l.id === s.track_layout_id);
              return tl ? (
                <div>
                  <dt>Track Layout</dt>
                  <dd>{tl.name}</dd>
                </div>
              ) : null;
            })()}
            {s.created_at ? (
              <div>
                <dt>Added</dt>
                <dd>{new Date(String(s.created_at)).toLocaleString()}</dd>
              </div>
            ) : null}
            {s.file_path ? (() => {
              const raw = String(s.file_path).trim();
              let names: string[];
              if (raw.startsWith('[')) {
                try {
                  names = (JSON.parse(raw) as string[]).map((p) => p.split(/[\\/]/).pop() || p);
                } catch {
                  names = [raw.split(/[\\/]/).pop() || raw];
                }
              } else {
                names = [raw.split(/[\\/]/).pop() || raw];
              }
              return (
                <div>
                  <dt>{names.length > 1 ? `Source Files (${names.length})` : 'Source File'}</dt>
                  <dd className="session-info-file">{names.join(', ')}</dd>
                </div>
              );
            })() : null}
            <div>
              <dt>Notes</dt>
              <dd>{String(s.lap_count_notes || '—')}</dd>
            </div>

            {ss?.file_metadata && Object.keys(ss.file_metadata).length > 0 && (
              <>
                <div className="session-info-divider" />
                <div className="session-info-section-header">
                  <dt>File Metadata</dt>
                  <dd />
                </div>
                {Object.entries(ss.file_metadata).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v || '—'}</dd>
                  </div>
                ))}
              </>
            )}

            <div className="session-info-divider" />
            <div>
              <dt>Session ID</dt>
              <dd className="session-info-id">{String(s.id)}</dd>
            </div>
          </>
        )}
      </dl>
    </div>
  );
}

function safeBarToDisplay(raw: unknown, unit: PressureUnit): number | null {
  const v = Number(raw ?? undefined);
  if (!Number.isFinite(v)) return null;
  return convertPressure(v, 'bar', unit);
}

function RolloutCard({
  session,
  pressureUnit,
  onEdit,
}: {
  session: Record<string, unknown>;
  pressureUnit: PressureUnit;
  onEdit: () => void;
}) {
  const corners = (['fl', 'fr', 'rl', 'rr'] as const).map(c => ({
    label: c.toUpperCase(),
    value: safeBarToDisplay(session[`roll_out_pressure_${c}`], pressureUnit),
  }));
  const hasAny = corners.some(c => c.value != null);

  return (
    <div className="card" style={{ padding: '10px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 16 }}>
      <span style={{ fontSize: 13, fontWeight: 600, flexShrink: 0 }}>Roll-out</span>
      <div style={{ display: 'flex', gap: 16, flex: 1 }}>
        {corners.map(c => (
          <span key={c.label} style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
            <span className="text-muted" style={{ marginRight: 4 }}>{c.label}</span>
            {c.value != null ? `${c.value.toFixed(1)} ${pressureLabel(pressureUnit)}` : '—'}
          </span>
        ))}
      </div>
      <Button variant="ghost" size="sm" onClick={onEdit}>
        {hasAny ? 'Edit' : 'Set roll-out'}
      </Button>
    </div>
  );
}
