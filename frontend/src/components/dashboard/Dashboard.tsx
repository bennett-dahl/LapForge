import { useState, useMemo, useCallback, useRef, useEffect, type DragEvent } from 'react';
import type { DashboardModule } from '../../types/models';
import { useCursorStore } from '../../contexts/CursorSyncContext';
import ChartModule, { ChartYAxisHeaderButton, SMOOTH_LEVELS } from './modules/ChartModule';
import LapBar from './LapBar';
import MapModule from './modules/MapModule';
import ReadoutModule from './modules/ReadoutModule';
import LapTimesModule from './modules/LapTimesModule';
import TireSummaryModule from './modules/TireSummaryModule';
import ChannelPickerModal from './ChannelPickerModal';
import Button from '../ui/Button';
import {
  distanceAxisTitle,
  type DistanceUnit,
  type PressureUnit,
  type TempUnit,
} from '../../utils/units';
import { zoomRangeForLapNumber } from './LapBar';

const WIDTH_CLASSES: Record<string, string> = {
  full: 'mod-full',
  half: 'mod-half',
  third: 'mod-third',
  quarter: 'mod-quarter',
};

const WIDTH_CYCLE = ['full', 'half', 'third', 'quarter'] as const;

const MODULE_LABELS: Record<string, string> = {
  chart: 'Chart',
  map: 'Track Map',
  readout: 'Values at Cursor',
  'lap-times': 'Lap Times',
  'tire-summary': 'Tire Pressure Summary',
};

const DEFAULT_LAYOUT: DashboardModule[] = [
  { type: 'chart', channels: ['speed', 'aps', 'pbrake_f', 'gear'], width: 'full', height: 200 },
  { type: 'chart', channels: ['accx', 'accy', 'asteer'], width: 'full', height: 200 },
  { type: 'map', width: 'half', height: 300 },
  { type: 'readout', width: 'quarter', height: 300 },
  { type: 'lap-times', width: 'quarter', height: 300 },
  { type: 'chart', channels: ['tpms_press_fl', 'tpms_press_fr', 'tpms_press_rl', 'tpms_press_rr'], width: 'full', height: 200 },
  { type: 'tire-summary', width: 'full', height: null },
];

function defaultModuleHeight(mod: DashboardModule): number {
  if (mod.height != null && mod.height > 0) return mod.height;
  if (mod.type === 'map' || mod.type === 'readout' || mod.type === 'lap-times') return 300;
  return 200;
}

export interface DashboardData {
  times: number[];
  distances: number[];
  series: Record<string, number[]>;
  channel_meta: Record<string, { label: string; unit?: string; category?: string }>;
  channels_by_category: Record<string, string[]>;
  lap_splits: number[];
  lap_split_distances: number[];
  lap_times: { lap: number; time: number; fast?: boolean; segment_index?: number }[];
  has_distance: boolean;
  reference_lap?: number | null;
  fast_lap_index?: number | null;
  sections?: { name: string; start_distance: number; end_distance: number }[];
  points?: { lat: number; lng: number; distance?: number }[];
  tire_summary?: Record<string, unknown>;
  target_pressure_psi?: number | null;
  raw_pressure_series?: Record<string, number[]>;
  sessions?: DashboardData[];
  comparison_id?: string;
  /** Present on comparison dashboard API payloads */
  comparison_name?: string;
  all_session_ids?: string[];
  excluded_laps?: number[];
  /** Segment index of GPS reference lap in processed session. */
  reference_lap_index?: number | null;
  /** Full-resolution time array for accurate section timing. */
  raw_times?: number[];
  /** Full-resolution distance array for accurate section timing. */
  raw_distances?: number[];
  /** Set only when user explicitly applied a map lap via PATCH. Null/undefined means auto-selected. */
  map_lap_segment_index?: number | null;
  /** Single-lap telemetry + GPS for the map reference lap (local distances, 0→lap_length). */
  map_lap?: {
    distances: number[];
    times: number[];
    series: Record<string, number[]>;
    channel_meta: Record<string, { label?: string; display?: string; unit?: string; category?: string }>;
    points: { lat: number; lng: number; distance?: number }[];
    lap_length: number;
    source: {
      lap_index?: number | null;
      lap_time?: number | null;
      driver?: string | null;
      car?: string | null;
      session_name?: string | null;
    };
  } | null;
}

interface DashboardProps {
  data: DashboardData;
  sessionId: string;
  initialLayout?: DashboardModule[] | null;
  onLayoutChange?: (layout: DashboardModule[]) => void;
  /** Override channel grouping (defaults to `data.channels_by_category`) */
  channelsByCategory?: Record<string, string[]>;
  /** Override channel labels/units (defaults to `data.channel_meta`) */
  channelMeta?: Record<string, { label: string; unit?: string; category?: string }>;
  pressureUnit?: PressureUnit;
  tempUnit?: TempUnit;
  distanceUnit?: DistanceUnit;
  excludedLaps?: number[];
  onToggleExcludeLap?: (segmentIndex: number) => void;
}

export default function Dashboard({
  data,
  sessionId,
  initialLayout,
  onLayoutChange,
  channelsByCategory: channelsByCategoryProp,
  channelMeta: channelMetaProp,
  pressureUnit = 'psi',
  tempUnit = 'c',
  distanceUnit = 'km',
  excludedLaps,
  onToggleExcludeLap,
}: DashboardProps) {
  const cursorStore = useCursorStore();
  const setSyncedXRange = useCallback((min: number, max: number) => cursorStore.setXRange(min, max), [cursorStore]);
  const resetSyncedZoom = useCallback(() => cursorStore.resetZoom(), [cursorStore]);
  const [lapRangeIdx, setLapRangeIdx] = useState<{ lo: number; hi: number } | null>(null);

  const onLapZoomRange = useCallback(
    (min: number, max: number) => {
      setSyncedXRange(min, max);
    },
    [setSyncedXRange],
  );

  const onLapResetZoom = useCallback(() => {
    setLapRangeIdx(null);
    resetSyncedZoom();
  }, [resetSyncedZoom]);

  const handleUserZoom = useCallback(() => {
    setLapRangeIdx(null);
  }, []);

  useEffect(() => {
    setLapRangeIdx(null);
    resetSyncedZoom();
  }, [sessionId, resetSyncedZoom]);

  const [layout, setLayout] = useState<DashboardModule[]>(
    () => initialLayout ?? DEFAULT_LAYOUT,
  );
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [channelPickerIdx, setChannelPickerIdx] = useState<number | null>(null);
  const [resizeDragIdx, setResizeDragIdx] = useState<number | null>(null);

  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const channelsByCategory = channelsByCategoryProp ?? data.channels_by_category ?? {};
  const channelMetaResolved = channelMetaProp ?? data.channel_meta ?? {};

  const xValues = useMemo(
    () => (data.has_distance ? data.distances : data.times),
    [data],
  );
  const xLabel = data.has_distance ? distanceAxisTitle(distanceUnit) : 'Time (s)';
  const xCursorField = data.has_distance ? 'distance' as const : 'time' as const;

  const onLapTimesRowClick = useCallback(
    (lap: number) => {
      const splits = data.has_distance ? data.lap_split_distances : data.lap_splits;
      const r = zoomRangeForLapNumber(splits, data.lap_times, lap);
      if (r && r.min < r.max) {
        onLapZoomRange(r.min, r.max);
        const idx = data.lap_times.findIndex((lt) => lt.lap === lap);
        if (idx >= 0) setLapRangeIdx({ lo: idx, hi: idx });
      }
    },
    [data.has_distance, data.lap_split_distances, data.lap_splits, data.lap_times, onLapZoomRange],
  );

  const visibleChartChannelKeys = useMemo(() => {
    const u = new Set<string>();
    for (const m of layout) {
      if (m.type === 'chart' && Array.isArray(m.channels)) {
        for (const k of m.channels) {
          if (k && data.series[k] != null) u.add(k);
        }
      }
    }
    return u.size > 0 ? Array.from(u) : undefined;
  }, [layout, data.series]);

  const readoutSessions = data.sessions?.length ? data.sessions : undefined;

  const updateLayout = useCallback((newLayout: DashboardModule[]) => {
    setLayout(newLayout);
    layoutRef.current = newLayout;
    onLayoutChange?.(newLayout);
    localStorage.setItem(`dashboard_layout_${sessionId}`, JSON.stringify(newLayout));
  }, [sessionId, onLayoutChange]);

  function removeModule(idx: number) {
    const next = layout.filter((_, i) => i !== idx);
    updateLayout(next);
  }

  function addModule(type: string) {
    const mod: DashboardModule = { type };
    if (type === 'chart') mod.channels = ['speed'];
    if (type === 'map') mod.height = 300;
    mod.width = type === 'chart' ? 'full' : 'half';
    updateLayout([...layout, mod]);
  }

  function moveModule(from: number, to: number) {
    if (from === to) return;
    const next = [...layout];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    updateLayout(next);
  }

  function cycleWidth(idx: number) {
    const mod = layout[idx];
    const cur = mod.width ?? 'full';
    const i = WIDTH_CYCLE.indexOf(cur as (typeof WIDTH_CYCLE)[number]);
    const nextW = WIDTH_CYCLE[(i < 0 ? 0 : i + 1) % WIDTH_CYCLE.length];
    const next = layout.map((m, i) => (i === idx ? { ...m, width: nextW } : m));
    updateLayout(next);
  }

  function handleDragStart(e: DragEvent<HTMLDivElement>, idx: number) {
    const target = e.target as HTMLElement;
    if (!target.closest('.dash-module-header') || target.closest('.module-actions')) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
    setDragIdx(idx);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  function handleDrop(e: DragEvent<HTMLDivElement>, toIdx: number) {
    e.preventDefault();
    const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (Number.isNaN(from)) return;
    moveModule(from, toIdx);
  }

  function handleDragEnd() {
    setDragIdx(null);
  }

  function beginResize(e: React.MouseEvent, idx: number) {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startH = defaultModuleHeight(layout[idx]);
    setResizeDragIdx(idx);
    const onMove = (ev: MouseEvent) => {
      const h = Math.max(80, Math.round(startH + (ev.clientY - startY)));
      setLayout((prev) => {
        const n = [...prev];
        n[idx] = { ...n[idx], height: h };
        layoutRef.current = n;
        return n;
      });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setResizeDragIdx(null);
      updateLayout(layoutRef.current);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function applyChartChannels(channels: string[], channelColors: Record<string, string>) {
    if (channelPickerIdx === null) return;
    const idx = channelPickerIdx;
    const next = layout.map((m, i) =>
      i === idx
        ? {
            ...m,
            channels,
            channelColors: Object.keys(channelColors).length > 0 ? channelColors : undefined,
          }
        : m,
    );
    updateLayout(next);
  }

  const pickerMod = channelPickerIdx !== null ? layout[channelPickerIdx] : null;
  const pickerSelected =
    pickerMod?.type === 'chart' ? (pickerMod.channels as string[] | undefined) ?? [] : [];

  return (
    <div className="dashboard">
      <LapBar
        lapTimes={data.lap_times}
        lapSplitDistances={data.has_distance ? data.lap_split_distances : data.lap_splits}
        hasDistance={data.has_distance}
        onZoomRange={onLapZoomRange}
        onResetZoom={onLapResetZoom}
        rangeIdx={lapRangeIdx}
        onRangeIdxChange={setLapRangeIdx}
      />
      <div className="dash-modules">
        {layout.map((mod, idx) => {
          const widthClass = WIDTH_CLASSES[mod.width ?? 'full'] ?? 'mod-full';
          const dragging = dragIdx === idx;
          return (
            <div
              key={idx}
              className={`dash-module ${widthClass}${dragging ? ' dragging' : ''}`}
              style={{ height: defaultModuleHeight(mod) }}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, idx)}
              onDragEnd={handleDragEnd}
            >
              <div
                className="dash-module-header"
                draggable
                onDragStart={(e) => handleDragStart(e, idx)}
              >
                <span className="module-title">
                  {MODULE_LABELS[mod.type] ?? mod.type}
                  {mod.type === 'chart' && mod.channels && ` — ${(mod.channels as string[]).join(', ')}`}
                </span>
                <div className="module-actions">
                  {mod.type === 'chart' && (
                    <>
                      <button
                        type="button"
                        className="panel-btn"
                        title="Channels"
                        onClick={() => setChannelPickerIdx(idx)}
                      >
                        Channels
                      </button>
                      <ChartYAxisHeaderButton
                        channelKeys={(mod.channels as string[] | undefined) ?? []}
                        channelMeta={channelMetaResolved}
                        yAxisGroups={mod.yAxisGroups as string[][] | undefined}
                        yAxisConfig={
                          mod.yAxisConfig as
                            | Record<string, { autoScale?: boolean; min?: number; max?: number }>
                            | undefined
                        }
                        groupColors={
                          mod.groupColors as Record<string, string> | undefined
                        }
                        onApply={(patch) => {
                          const cur = layoutRef.current;
                          updateLayout(
                            cur.map((m, i) => {
                              if (i !== idx) return m;
                              return {
                                ...m,
                                ...(patch.yAxisGroups !== undefined
                                  ? { yAxisGroups: patch.yAxisGroups }
                                  : {}),
                                ...(patch.yAxisConfig !== undefined
                                  ? { yAxisConfig: patch.yAxisConfig }
                                  : {}),
                                ...(patch.groupColors !== undefined
                                  ? { groupColors: patch.groupColors }
                                  : {}),
                              };
                            }),
                          );
                        }}
                      />
                      {(() => {
                        const chans = (mod.channels as string[] | undefined) ?? [];
                        const hasPressure = chans.some((c) => {
                          const cat = channelMetaResolved[c]?.category;
                          return cat === 'pressure' || /tpms_press/i.test(c);
                        });
                        if (!hasPressure) return null;
                        return (
                          <select
                            className="panel-select smooth-select"
                            title="TPMS Smoothing"
                            value={(mod.smoothLevel as number | undefined) ?? 0}
                            onChange={(e) => {
                              const cur = layoutRef.current;
                              updateLayout(
                                cur.map((m, i) =>
                                  i === idx ? { ...m, smoothLevel: Number(e.target.value) } : m,
                                ),
                              );
                            }}
                          >
                            {SMOOTH_LEVELS.map((lvl, li) => (
                              <option key={li} value={li}>{lvl.label}</option>
                            ))}
                          </select>
                        );
                      })()}
                    </>
                  )}
                  <button
                    type="button"
                    className="panel-btn"
                    title="Cycle width"
                    onClick={() => cycleWidth(idx)}
                  >
                    ↔
                  </button>
                  {idx > 0 && (
                    <button type="button" className="panel-btn" onClick={() => moveModule(idx, idx - 1)} title="Move up">
                      ↑
                    </button>
                  )}
                  {idx < layout.length - 1 && (
                    <button type="button" className="panel-btn" onClick={() => moveModule(idx, idx + 1)} title="Move down">
                      ↓
                    </button>
                  )}
                  <button type="button" className="panel-btn btn-remove" onClick={() => removeModule(idx)} title="Remove">
                    ×
                  </button>
                </div>
              </div>
              <div className="module-body">
                {mod.type === 'chart' && (
                  <ChartModule
                    xValues={xValues}
                    xLabel={xLabel}
                    xCursorField={xCursorField}
                    series={data.series}
                    channelMeta={channelMetaResolved}
                    channelKeys={mod.channels as string[] ?? []}
                    lapSplits={data.has_distance ? data.lap_split_distances : data.lap_splits}
                    sections={data.sections}
                    yAxisGroups={mod.yAxisGroups as string[][] | undefined}
                    yAxisConfig={
                      mod.yAxisConfig as
                        | Record<string, { autoScale?: boolean; min?: number; max?: number }>
                        | undefined
                    }
                    pressureUnit={pressureUnit}
                    tempUnit={tempUnit}
                    distanceUnit={distanceUnit}
                    rawPressureSeries={data.raw_pressure_series}
                    smoothLevel={(mod.smoothLevel as number | undefined) ?? 0}
                    channelColors={
                      mod.channelColors as Record<string, string> | undefined
                    }
                    groupColors={
                      mod.groupColors as Record<string, string> | undefined
                    }
                    onUserZoom={handleUserZoom}
                  />
                )}
                {mod.type === 'map' && (
                  <MapModule
                    points={data.map_lap?.points ?? data.points ?? []}
                    sections={data.sections}
                    lapSplits={data.has_distance ? data.lap_split_distances : data.lap_splits}
                    lapSplitDistances={data.has_distance ? data.lap_split_distances : undefined}
                    lapLength={data.map_lap?.lap_length}
                  />
                )}
                {mod.type === 'readout' && (
                  <ReadoutModule
                    xValues={xValues}
                    series={data.series}
                    channelMeta={channelMetaResolved}
                    xCursorField={xCursorField}
                    pressureUnit={pressureUnit}
                    tempUnit={tempUnit}
                    lapSplits={data.lap_splits}
                    lapSplitDistances={data.lap_split_distances}
                    visibleChannels={visibleChartChannelKeys}
                    sessions={readoutSessions}
                  />
                )}
                {mod.type === 'lap-times' && (
                  <LapTimesModule
                    lapTimes={data.lap_times}
                    fastIdx={data.fast_lap_index ?? null}
                    onLapClick={onLapTimesRowClick}
                    excludedLaps={excludedLaps}
                    onToggleExcludeLap={onToggleExcludeLap}
                  />
                )}
                {mod.type === 'tire-summary' && (
                  <TireSummaryModule
                    summary={data.tire_summary}
                    target={data.target_pressure_psi}
                    pressureUnit={pressureUnit}
                  />
                )}
              </div>
              <div
                className={`resize-handle${resizeDragIdx === idx ? ' dragging' : ''}`}
                onMouseDown={(e) => beginResize(e, idx)}
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize module height"
              />
            </div>
          );
        })}
      </div>
      <div className="dash-add-row">
        {Object.entries(MODULE_LABELS).map(([type, label]) => (
          <Button key={type} variant="ghost" size="sm" onClick={() => addModule(type)}>
            + {label}
          </Button>
        ))}
      </div>
      <ChannelPickerModal
        open={channelPickerIdx !== null}
        onClose={() => setChannelPickerIdx(null)}
        channelsByCategory={channelsByCategory}
        channelMeta={channelMetaResolved}
        selected={pickerSelected}
        channelColors={
          pickerMod?.channelColors as Record<string, string> | undefined
        }
        onApply={applyChartChannels}
      />
    </div>
  );
}
