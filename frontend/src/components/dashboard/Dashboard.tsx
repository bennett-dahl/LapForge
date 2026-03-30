import { useState, useMemo, useCallback } from 'react';
import type { DashboardModule } from '../../types/models';
import ChartModule from './modules/ChartModule';
import MapModule from './modules/MapModule';
import ReadoutModule from './modules/ReadoutModule';
import LapTimesModule from './modules/LapTimesModule';
import TireSummaryModule from './modules/TireSummaryModule';
import Button from '../ui/Button';

const WIDTH_CLASSES: Record<string, string> = {
  full: 'mod-full',
  half: 'mod-half',
  third: 'mod-third',
  quarter: 'mod-quarter',
};

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

export interface DashboardData {
  times: number[];
  distances: number[];
  series: Record<string, number[]>;
  channel_meta: Record<string, { label: string; unit?: string }>;
  channels_by_category: Record<string, string[]>;
  lap_splits: number[];
  lap_split_distances: number[];
  lap_times: { lap: number; time: number; fast?: boolean }[];
  has_distance: boolean;
  reference_lap?: number | null;
  fast_lap_index?: number | null;
  sections?: { name: string; start_distance: number; end_distance: number }[];
  points?: { lat: number; lng: number; distance?: number }[];
  tire_summary?: Record<string, unknown>;
  target_pressure_psi?: number | null;
  sessions?: DashboardData[];
  comparison_id?: string;
}

interface DashboardProps {
  data: DashboardData;
  sessionId: string;
  initialLayout?: DashboardModule[] | null;
  onLayoutChange?: (layout: DashboardModule[]) => void;
}

export default function Dashboard({
  data,
  sessionId,
  initialLayout,
  onLayoutChange,
}: DashboardProps) {
  const [layout, setLayout] = useState<DashboardModule[]>(
    () => initialLayout ?? DEFAULT_LAYOUT,
  );

  const xValues = useMemo(
    () => (data.has_distance ? data.distances : data.times),
    [data],
  );
  const xLabel = data.has_distance ? 'Distance (m)' : 'Time (s)';
  const xCursorField = data.has_distance ? 'distance' as const : 'time' as const;

  const updateLayout = useCallback((newLayout: DashboardModule[]) => {
    setLayout(newLayout);
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
    const next = [...layout];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    updateLayout(next);
  }

  return (
    <div className="dashboard">
      <div className="dashboard-grid">
        {layout.map((mod, idx) => {
          const widthClass = WIDTH_CLASSES[mod.width ?? 'full'] ?? 'mod-full';
          return (
            <div key={idx} className={`dashboard-module ${widthClass}`} style={{ minHeight: mod.height ?? undefined }}>
              <div className="mod-header">
                <span className="mod-title">
                  {MODULE_LABELS[mod.type] ?? mod.type}
                  {mod.type === 'chart' && mod.channels && ` — ${(mod.channels as string[]).join(', ')}`}
                </span>
                <div className="mod-controls">
                  {idx > 0 && <button className="mod-btn" onClick={() => moveModule(idx, idx - 1)} title="Move up">↑</button>}
                  {idx < layout.length - 1 && <button className="mod-btn" onClick={() => moveModule(idx, idx + 1)} title="Move down">↓</button>}
                  <button className="mod-btn mod-btn-close" onClick={() => removeModule(idx)} title="Remove">×</button>
                </div>
              </div>
              <div className="mod-body">
                {mod.type === 'chart' && (
                  <ChartModule
                    xValues={xValues}
                    xLabel={xLabel}
                    xCursorField={xCursorField}
                    series={data.series}
                    channelMeta={data.channel_meta}
                    channelKeys={mod.channels as string[] ?? []}
                    lapSplits={data.has_distance ? data.lap_split_distances : data.lap_splits}
                    sections={data.sections}
                    height={mod.height ?? 200}
                  />
                )}
                {mod.type === 'map' && (
                  <MapModule
                    points={data.points ?? []}
                    sections={data.sections}
                    height={mod.height ?? 300}
                  />
                )}
                {mod.type === 'readout' && (
                  <ReadoutModule
                    xValues={xValues}
                    series={data.series}
                    channelMeta={data.channel_meta}
                    xCursorField={xCursorField}
                  />
                )}
                {mod.type === 'lap-times' && (
                  <LapTimesModule
                    lapTimes={data.lap_times}
                    fastIdx={data.fast_lap_index ?? null}
                  />
                )}
                {mod.type === 'tire-summary' && (
                  <TireSummaryModule summary={data.tire_summary} target={data.target_pressure_psi} />
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="dashboard-add">
        {Object.entries(MODULE_LABELS).map(([type, label]) => (
          <Button key={type} variant="ghost" size="sm" onClick={() => addModule(type)}>+ {label}</Button>
        ))}
      </div>
    </div>
  );
}
