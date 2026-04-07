import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../api/client';
import type { Plan, BoardSession } from '../../types/models';
import type { SettingsResponse } from '../../types/api';
import { CursorSyncProvider, useCursorStore } from '../../contexts/CursorSyncContext';
import ChartModule, {
  ChartYAxisHeaderButton,
  SMOOTH_LEVELS,
  type ChartYAxisConfig,
} from '../dashboard/modules/ChartModule';
import {
  convertPressure,
  convertTemp,
  distanceAxisTitle,
  isCelsiusTelemetryChannel,
  pressureDecimals,
  storagePressureUnit,
  type DistanceUnit,
  type PressureUnit,
  type TempUnit,
} from '../../utils/units';

interface Props {
  plan: Plan;
  sessions: BoardSession[];
  pressureUnit: PressureUnit;
  tempUnit: TempUnit;
}

interface TelemetryData {
  id: string;
  times: number[];
  distances: number[];
  series: Record<string, number[]>;
  channel_meta: Record<string, { label?: string; display?: string; unit?: string; category?: string }>;
  lap_splits: number[];
  lap_split_distances: number[];
  lap_times: Array<{ index: number; time: number }>;
  has_distance: boolean;
  target_psi: number | null;
  target_unit?: string;
  raw_pressure_series?: Record<string, number[]>;
}

const PRESSURE_CHANNELS = ['tpms_press_fl', 'tpms_press_fr', 'tpms_press_rl', 'tpms_press_rr'];
const TEMP_CHANNELS = ['tpms_temp_fl', 'tpms_temp_fr', 'tpms_temp_rl', 'tpms_temp_rr'];

const LS_PREFIX = 'planChartPrefs:';

interface ChartPrefs {
  smoothLevel: number;
  yAxisGroups?: string[][];
  yAxisConfig?: ChartYAxisConfig;
  groupColors?: Record<string, string>;
  showTemps: boolean;
  chartHeight: number;
}

function loadPrefs(sessionId: string): ChartPrefs {
  try {
    const raw = localStorage.getItem(LS_PREFIX + sessionId);
    if (raw) return { ...defaultPrefs(), ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return defaultPrefs();
}

function savePrefs(sessionId: string, prefs: ChartPrefs) {
  try {
    localStorage.setItem(LS_PREFIX + sessionId, JSON.stringify(prefs));
  } catch { /* ignore */ }
}

function defaultPrefs(): ChartPrefs {
  return { smoothLevel: 0, showTemps: false, chartHeight: 320 };
}

function normalizeChannelMeta(
  raw: Record<string, { label?: string; display?: string; unit?: string; category?: string }>,
): Record<string, { label: string; unit?: string; category?: string }> {
  const out: Record<string, { label: string; unit?: string; category?: string }> = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k] = { ...v, label: v.label ?? v.display ?? k };
  }
  return out;
}

export default function PlanPressureCharts({ plan, sessions, pressureUnit, tempUnit }: Props) {
  if (sessions.length === 0) {
    return (
      <div className="card" style={{ padding: 24, textAlign: 'center' }}>
        <span className="text-muted">Link sessions above to see pressure analysis charts.</span>
      </div>
    );
  }

  return (
    <div>
      <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Pressure Analysis</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {sessions.map(s => (
          <CursorSyncProvider key={s.id}>
            <SessionChartBlock session={s} plan={plan} pressureUnit={pressureUnit} tempUnit={tempUnit} />
          </CursorSyncProvider>
        ))}
      </div>
    </div>
  );
}

function SessionChartBlock({ session, plan, pressureUnit, tempUnit }: { session: BoardSession; plan: Plan; pressureUnit: PressureUnit; tempUnit: TempUnit }) {
  const { data: telemetry, isLoading } = useQuery({
    queryKey: ['session-telemetry', session.id],
    queryFn: () => apiGet<TelemetryData>(`/api/sessions/${session.id}/telemetry`),
    staleTime: 5 * 60_000,
  });

  const { data: settingsData } = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiGet<SettingsResponse>('/api/settings'),
  });

  const distanceUnit = (settingsData?.preferences?.default_distance_unit ?? 'km') as DistanceUnit;

  const [prefs, setPrefs] = useState(() => loadPrefs(session.id));
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const updatePrefs = useCallback((patch: Partial<ChartPrefs>) => {
    setPrefs(prev => {
      const next = { ...prev, ...patch };
      savePrefs(session.id, next);
      return next;
    });
  }, [session.id]);

  const resizeDragRef = useRef(false);

  const beginResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startH = prefsRef.current.chartHeight;
    resizeDragRef.current = true;
    const onMove = (ev: MouseEvent) => {
      const h = Math.max(120, Math.round(startH + (ev.clientY - startY)));
      setPrefs(prev => ({ ...prev, chartHeight: h }));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      resizeDragRef.current = false;
      savePrefs(session.id, prefsRef.current);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [session.id]);

  const channelMeta = useMemo(
    () => telemetry ? normalizeChannelMeta(telemetry.channel_meta) : {},
    [telemetry],
  );

  const hasDistance = telemetry?.has_distance ?? (telemetry?.distances?.length ? telemetry.distances.length > 0 : false);
  const xValues = useMemo(
    () => telemetry ? (hasDistance ? telemetry.distances : telemetry.times) : [],
    [telemetry, hasDistance],
  );
  const xLabel = hasDistance ? distanceAxisTitle(distanceUnit) : 'Time (s)';
  const xCursorField: 'distance' | 'time' = hasDistance ? 'distance' : 'time';
  const lapSplits = useMemo(
    () => telemetry ? (hasDistance ? (telemetry.lap_split_distances ?? []) : (telemetry.lap_splits ?? [])) : [],
    [telemetry, hasDistance],
  );

  const seriesRef = telemetry?.series;
  const channelKeys = useMemo(() => {
    if (!seriesRef) return [];
    const keys = PRESSURE_CHANNELS.filter(ch => seriesRef[ch]);
    if (prefs.showTemps) {
      for (const ch of TEMP_CHANNELS) {
        if (seriesRef[ch]) keys.push(ch);
      }
    }
    return keys;
  }, [seriesRef, prefs.showTemps]);

  const yAxisGroups = useMemo(() => {
    if (prefs.yAxisGroups) return prefs.yAxisGroups;
    if (!prefs.showTemps) return undefined;
    const pressures = channelKeys.filter(k => PRESSURE_CHANNELS.includes(k));
    const temps = channelKeys.filter(k => TEMP_CHANNELS.includes(k));
    if (temps.length === 0) return undefined;
    return [pressures, temps];
  }, [prefs.yAxisGroups, prefs.showTemps, channelKeys]);

  const target = telemetry?.target_psi ?? plan.qual_plan?.target ?? plan.race_plan?.target ?? null;
  const hasTemps = seriesRef ? TEMP_CHANNELS.some(ch => seriesRef[ch]) : false;

  if (isLoading) {
    return (
      <div className="dash-module" style={{ height: 80, width: '100%' }}>
        <div className="dash-module-header">
          <span className="module-title">{session.label}</span>
        </div>
        <div className="module-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span className="text-muted">Loading...</span>
        </div>
      </div>
    );
  }

  if (!telemetry) {
    return (
      <div className="dash-module" style={{ height: 80, width: '100%' }}>
        <div className="dash-module-header">
          <span className="module-title">{session.label}</span>
        </div>
        <div className="module-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span className="text-muted">No telemetry data</span>
        </div>
      </div>
    );
  }

  return (
    <div className="dash-module" style={{ height: prefs.chartHeight, width: '100%' }}>
      <div className="dash-module-header">
        <span className="module-title">{session.label}</span>
        <div className="module-actions">
          {hasTemps && (
            <button
              type="button"
              className={`panel-btn${prefs.showTemps ? ' btn-active' : ''}`}
              title="Toggle tire temperature channels"
              onClick={() => updatePrefs({ showTemps: !prefs.showTemps, yAxisGroups: undefined })}
            >
              Temps
            </button>
          )}
          <ChartYAxisHeaderButton
            channelKeys={channelKeys}
            channelMeta={channelMeta}
            yAxisGroups={yAxisGroups}
            yAxisConfig={prefs.yAxisConfig}
            groupColors={prefs.groupColors}
            onApply={(patch) => {
              updatePrefs({
                ...(patch.yAxisGroups !== undefined ? { yAxisGroups: patch.yAxisGroups } : {}),
                ...(patch.yAxisConfig !== undefined ? { yAxisConfig: patch.yAxisConfig } : {}),
                ...(patch.groupColors !== undefined ? { groupColors: patch.groupColors } : {}),
              });
            }}
          />
          <select
            className="panel-select smooth-select"
            title="TPMS Smoothing"
            value={prefs.smoothLevel}
            onChange={e => updatePrefs({ smoothLevel: Number(e.target.value) })}
          >
            {SMOOTH_LEVELS.map((lvl, li) => (
              <option key={li} value={li}>{lvl.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="module-body" style={{ position: 'relative' }}>
        <ChartModule
          xValues={xValues}
          xLabel={xLabel}
          xCursorField={xCursorField}
          series={telemetry.series}
          channelMeta={channelMeta}
          channelKeys={channelKeys}
          lapSplits={lapSplits}
          target={target}
          yAxisGroups={yAxisGroups}
          yAxisConfig={prefs.yAxisConfig}
          pressureUnit={pressureUnit}
          tempUnit={tempUnit}
          distanceUnit={distanceUnit}
          rawPressureSeries={telemetry.raw_pressure_series}
          smoothLevel={prefs.smoothLevel}
          groupColors={prefs.groupColors}
        />
        <PlanChartReadout
          xValues={xValues}
          xCursorField={xCursorField}
          series={telemetry.series}
          channelMeta={channelMeta}
          target={target}
          pressureUnit={pressureUnit}
          showTemps={prefs.showTemps}
          tempUnit={tempUnit}
        />
      </div>
      <div
        className={`resize-handle${resizeDragRef.current ? ' dragging' : ''}`}
        onMouseDown={beginResize}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize chart height"
      />
    </div>
  );
}

interface ReadoutCorner {
  label: string;
  pressure: number;
  delta: number | null;
  temp: number | null;
  color: string;
}

const CORNER_COLORS: Record<string, string> = {
  fl: '#3b82f6',
  fr: '#ef4444',
  rl: '#10b981',
  rr: '#f59e0b',
};

function PlanChartReadout({
  xValues,
  xCursorField,
  series,
  channelMeta,
  target,
  pressureUnit,
  showTemps,
  tempUnit,
}: {
  xValues: number[];
  xCursorField: 'distance' | 'time';
  series: Record<string, number[]>;
  channelMeta: Record<string, { label: string; unit?: string; category?: string }>;
  target: number | null;
  pressureUnit: PressureUnit;
  showTemps: boolean;
  tempUnit: TempUnit;
}) {
  const store = useCursorStore();
  const [corners, setCorners] = useState<ReadoutCorner[] | null>(null);

  useEffect(() => {
    return store.subscribe(() => {
      const snap = store.getSnapshot();
      const cx = xCursorField === 'distance' ? snap.distance : snap.time;
      if (cx == null) { setCorners(null); return; }

      let idx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < xValues.length; i++) {
        const d = Math.abs(xValues[i] - cx);
        if (d < bestDist) { bestDist = d; idx = i; }
      }

      const out: ReadoutCorner[] = [];
      for (const ch of PRESSURE_CHANNELS) {
        const arr = series[ch];
        if (!arr || idx >= arr.length) continue;
        const rawP = arr[idx];
        if (rawP == null) continue;
        const corner = ch.replace('tpms_press_', '');
        const meta = channelMeta[ch];
        const pStorage = storagePressureUnit(meta, ch);
        const displayP = convertPressure(rawP, pStorage, pressureUnit);
        const displayTarget = target != null ? convertPressure(target, pStorage, pressureUnit) : null;

        const tempCh = `tpms_temp_${corner}`;
        const tempArr = series[tempCh];
        let tempVal: number | null = showTemps && tempArr && idx < tempArr.length ? tempArr[idx] : null;
        if (tempVal != null && Number.isFinite(tempVal)) {
          const tempMeta = channelMeta[tempCh];
          const isCelsius = isCelsiusTelemetryChannel(tempMeta, tempCh);
          if (isCelsius && tempUnit === 'f') {
            tempVal = convertTemp(tempVal, 'c', 'f');
          } else if (!isCelsius && tempUnit === 'c') {
            tempVal = convertTemp(tempVal, 'f', 'c');
          }
        } else {
          tempVal = null;
        }

        out.push({
          label: meta?.label ?? corner.toUpperCase(),
          pressure: displayP,
          delta: displayTarget != null ? displayP - displayTarget : null,
          temp: tempVal,
          color: CORNER_COLORS[corner] ?? '#888',
        });
      }
      setCorners(out.length > 0 ? out : null);
    });
  }, [store, xValues, xCursorField, series, channelMeta, target, showTemps]);

  if (!corners) return null;

  const dec = pressureDecimals(pressureUnit);
  const hasTemps = corners.some(c => c.temp != null);
  const avgPressure = corners.reduce((s, c) => s + c.pressure, 0) / corners.length;
  const deltaCandidates = corners.filter(c => c.delta != null);
  const avgDelta = deltaCandidates.length > 0
    ? deltaCandidates.reduce((s, c) => s + c.delta!, 0) / deltaCandidates.length
    : null;
  const tempCandidates = corners.filter(c => c.temp != null);
  const avgTemp = tempCandidates.length > 0
    ? tempCandidates.reduce((s, c) => s + c.temp!, 0) / tempCandidates.length
    : null;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 6,
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(26,26,30,0.92)',
        border: '1px solid var(--border)',
        borderRadius: 4,
        padding: '5px 10px',
        fontSize: 11,
        fontVariantNumeric: 'tabular-nums',
        pointerEvents: 'none',
        zIndex: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
      }}
    >
      {/* Pressure row */}
      <div style={{ display: 'flex', gap: 12 }}>
        {corners.map(c => (
          <span key={c.label} style={{ color: c.color }}>
            <strong>{c.label}</strong>{' '}
            {c.pressure.toFixed(dec)} {pressureUnit}
            {c.delta != null && (
              <span style={{
                color: Math.abs(c.delta) <= 0.5 ? '#22c55e' : c.delta > 0 ? '#ef4444' : '#3b82f6',
                marginLeft: 3,
              }}>
                Δ{c.delta > 0 ? '+' : ''}{c.delta.toFixed(dec)}
              </span>
            )}
          </span>
        ))}
        <span style={{ color: 'var(--text-muted)', borderLeft: '1px solid var(--border)', paddingLeft: 8 }}>
          <strong>Avg</strong>{' '}{avgPressure.toFixed(dec)} {pressureUnit}
          {avgDelta != null && (
            <span style={{
              color: Math.abs(avgDelta) <= 0.5 ? '#22c55e' : avgDelta > 0 ? '#ef4444' : '#3b82f6',
              marginLeft: 3,
            }}>
              Δ{avgDelta > 0 ? '+' : ''}{avgDelta.toFixed(dec)}
            </span>
          )}
        </span>
      </div>
      {/* Temperature row */}
      {hasTemps && (
        <div style={{ display: 'flex', gap: 12 }}>
          {corners.map(c => (
            <span key={c.label} style={{ color: c.color, opacity: 0.8 }}>
              <strong>{c.label}</strong>{' '}
              {c.temp != null ? `${c.temp.toFixed(1)}°${tempUnit.toUpperCase()}` : '—'}
            </span>
          ))}
          {avgTemp != null && (
            <span style={{ color: 'var(--text-muted)', opacity: 0.8, borderLeft: '1px solid var(--border)', paddingLeft: 8 }}>
              <strong>Avg</strong> {avgTemp.toFixed(1)}°{tempUnit.toUpperCase()}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
