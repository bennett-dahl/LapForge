import { useMemo, useState, useRef, useEffect } from 'react';
import TelemetryChart from '../../charts/TelemetryChart';
import type { TelemetryChannel } from '../../charts/TelemetryChart';
import {
  convertPressure,
  convertTemp,
  isCelsiusTelemetryChannel,
  isPressureTelemetryChannel,
  mapNumericArray,
  pressureLabel,
  storagePressureUnit,
  tempLabel,
  type DistanceUnit,
  type PressureUnit,
  type TempUnit,
} from '../../../utils/units';

export type ChartYAxisConfig = Record<
  string,
  { autoScale?: boolean; min?: number; max?: number }
>;

interface ChartModuleProps {
  xValues: number[];
  xLabel: string;
  xCursorField: 'distance' | 'time';
  series: Record<string, number[]>;
  channelMeta: Record<string, { label: string; unit?: string }>;
  channelKeys: string[];
  lapSplits?: number[];
  sections?: { name: string; start_distance: number; end_distance: number }[];
  target?: number | null;
  xRange?: { min: number; max: number } | null;
  yAxisGroups?: string[][];
  yAxisConfig?: ChartYAxisConfig;
  pressureUnit?: PressureUnit;
  tempUnit?: TempUnit;
  /** When X is distance (meters), axis ticks show km or mi. */
  distanceUnit?: DistanceUnit;
}

/** Chart.js Y scale id for group index 0 → y, 1 → y2, … */
export function yAxisIdForGroupIndex(i: number): string {
  return i === 0 ? 'y' : `y${i + 1}`;
}

export function normalizeYAxisGroups(
  channelKeys: string[],
  groups?: string[][],
): string[][] {
  const keys = channelKeys.filter((k) => k);
  if (!groups?.length) return [keys];
  const used = new Set<string>();
  const out: string[][] = groups.map((g) => {
    const row: string[] = [];
    for (const k of g) {
      if (keys.includes(k) && !used.has(k)) {
        used.add(k);
        row.push(k);
      }
    }
    return row;
  });
  for (const k of keys) {
    if (!used.has(k)) {
      if (!out[0]) out[0] = [];
      out[0].push(k);
      used.add(k);
    }
  }
  const nonEmpty = out.filter((g) => g.length > 0);
  return nonEmpty.length > 0 ? nonEmpty : [keys];
}

function groupsToChannelAxisIndex(groups: string[][]): Record<string, number> {
  const map: Record<string, number> = {};
  groups.forEach((row, gi) => {
    for (const k of row) map[k] = gi;
  });
  return map;
}

function rebuildGroupsFromAxisIndex(
  channelKeys: string[],
  axisByChannel: Record<string, number>,
  groupCount: number,
): string[][] {
  const n = Math.max(1, groupCount);
  const groups: string[][] = Array.from({ length: n }, () => []);
  for (const k of channelKeys) {
    let ai = axisByChannel[k] ?? 0;
    if (ai < 0) ai = 0;
    if (ai >= n) ai = n - 1;
    groups[ai].push(k);
  }
  return groups.filter((g) => g.length > 0);
}

function addYAxisGroup(groups: string[][]): string[][] {
  const g = groups.map((r) => [...r]);
  let donorIdx = -1;
  for (let i = g.length - 1; i >= 0; i--) {
    if (g[i].length > 0) {
      donorIdx = i;
      break;
    }
  }
  if (donorIdx < 0) return [[], []];
  const row = g[donorIdx];
  const lastKey = row[row.length - 1];
  row.pop();
  g.push([lastKey]);
  return g.filter((r) => r.length > 0);
}

function removeLastYAxisGroup(groups: string[][]): string[][] {
  if (groups.length <= 1) return groups;
  const out = groups.slice(0, -1);
  const last = groups[groups.length - 1];
  out[0] = [...out[0], ...last];
  return out;
}

function compactYAxisConfig(
  cfg: ChartYAxisConfig | undefined,
  validIds: Set<string>,
): ChartYAxisConfig | undefined {
  if (!cfg) return undefined;
  const next: ChartYAxisConfig = {};
  for (const [id, v] of Object.entries(cfg)) {
    if (validIds.has(id)) next[id] = v;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

export interface ChartYAxisHeaderButtonProps {
  channelKeys: string[];
  channelMeta: Record<string, { label: string; unit?: string }>;
  yAxisGroups?: string[][];
  yAxisConfig?: ChartYAxisConfig;
  onApply: (patch: { yAxisGroups?: string[][]; yAxisConfig?: ChartYAxisConfig }) => void;
}

export function ChartYAxisHeaderButton({
  channelKeys,
  channelMeta,
  yAxisGroups,
  yAxisConfig,
  onApply,
}: ChartYAxisHeaderButtonProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const keys = useMemo(
    () => channelKeys.filter((k) => k),
    [channelKeys],
  );

  const normalizedGroups = useMemo(
    () => normalizeYAxisGroups(keys, yAxisGroups),
    [keys, yAxisGroups],
  );

  const axisByChannel = useMemo(
    () => groupsToChannelAxisIndex(normalizedGroups),
    [normalizedGroups],
  );

  const setGroupsAndConfig = (nextGroups: string[][]) => {
    const ids = new Set(nextGroups.map((_, i) => yAxisIdForGroupIndex(i)));
    onApply({
      yAxisGroups: nextGroups,
      yAxisConfig: compactYAxisConfig(yAxisConfig, ids) ?? {},
    });
  };

  const updateConfigForAxis = (
    axisId: string,
    patch: Partial<{ autoScale?: boolean; min?: number; max?: number }>,
  ) => {
    const prev = yAxisConfig ?? {};
    const cur = prev[axisId] ?? {};
    onApply({
      yAxisConfig: { ...prev, [axisId]: { ...cur, ...patch } },
    });
  };

  const onChannelAxisChange = (channelKey: string, axisIndex: number) => {
    const n = normalizedGroups.length;
    const nextMap = { ...axisByChannel, [channelKey]: axisIndex };
    const nextGroups = rebuildGroupsFromAxisIndex(keys, nextMap, n);
    setGroupsAndConfig(nextGroups);
  };

  const onAddAxis = () => {
    const next = addYAxisGroup(normalizedGroups);
    setGroupsAndConfig(next);
  };

  const onRemoveLastAxis = () => {
    const next = removeLastYAxisGroup(normalizedGroups);
    const ids = new Set(next.map((_, i) => yAxisIdForGroupIndex(i)));
    onApply({
      yAxisGroups: next,
      yAxisConfig: compactYAxisConfig(yAxisConfig, ids) ?? {},
    });
  };

  if (keys.length === 0) return null;

  return (
    <span className="yaxis-popover-anchor" ref={anchorRef}>
      <button
        type="button"
        className={`panel-btn${open ? ' btn-active' : ''}`}
        title="Y axis groups and scale"
        onClick={() => setOpen((o) => !o)}
      >
        Y-Axis
      </button>
      {open && (
        <div className="yaxis-popover" role="dialog" aria-label="Y axis settings">
          {normalizedGroups.map((groupKeys, gi) => {
            const axisId = yAxisIdForGroupIndex(gi);
            const cfg = yAxisConfig?.[axisId] ?? {};
            const auto = cfg.autoScale !== false;
            const side = gi % 2 === 0 ? 'left' : 'right';
            return (
              <div key={axisId} className="yaxis-popover-axis">
                <div className="yaxis-popover-axis-title">
                  Axis {gi + 1} ({side})
                </div>
                <ul className="yaxis-popover-channels-list">
                  {groupKeys.map((k) => (
                    <li key={k}>{channelMeta[k]?.label ?? k}</li>
                  ))}
                </ul>
                <label className="yaxis-popover-check">
                  <input
                    type="checkbox"
                    checked={auto}
                    onChange={(e) => {
                      if (e.target.checked) {
                        updateConfigForAxis(axisId, {
                          autoScale: true,
                          min: undefined,
                          max: undefined,
                        });
                      } else {
                        updateConfigForAxis(axisId, { autoScale: false });
                      }
                    }}
                  />
                  Auto-scale
                </label>
                <div className="yaxis-popover-minmax">
                  <label>
                    Min
                    <input
                      type="number"
                      disabled={auto}
                      value={cfg.min ?? ''}
                      placeholder="auto"
                      onChange={(e) => {
                        const v = e.target.value;
                        updateConfigForAxis(axisId, {
                          min: v === '' ? undefined : Number(v),
                          autoScale: false,
                        });
                      }}
                    />
                  </label>
                  <label>
                    Max
                    <input
                      type="number"
                      disabled={auto}
                      value={cfg.max ?? ''}
                      placeholder="auto"
                      onChange={(e) => {
                        const v = e.target.value;
                        updateConfigForAxis(axisId, {
                          max: v === '' ? undefined : Number(v),
                          autoScale: false,
                        });
                      }}
                    />
                  </label>
                </div>
              </div>
            );
          })}
          <div className="yaxis-popover-actions">
            <button type="button" className="panel-btn" onClick={onAddAxis}>
              Add Y axis
            </button>
            {normalizedGroups.length > 1 && (
              <button type="button" className="panel-btn" onClick={onRemoveLastAxis}>
                Merge last axis
              </button>
            )}
          </div>
          <div className="yaxis-popover-assign">
            <div className="yaxis-popover-assign-title">Channel → axis</div>
            {keys.map((k) => (
              <div key={k} className="yaxis-popover-assign-row">
                <span className="yaxis-popover-assign-label">
                  {channelMeta[k]?.label ?? k}
                </span>
                <select
                  className="yaxis-popover-select"
                  value={Math.min(
                    axisByChannel[k] ?? 0,
                    normalizedGroups.length - 1,
                  )}
                  onChange={(e) =>
                    onChannelAxisChange(k, Number(e.target.value))
                  }
                >
                  {normalizedGroups.map((_, gi) => (
                    <option key={gi} value={gi}>
                      {gi + 1}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}
    </span>
  );
}

export default function ChartModule({
  xValues,
  xLabel,
  xCursorField,
  series,
  channelMeta,
  channelKeys,
  lapSplits = [],
  sections = [],
  target,
  xRange = null,
  yAxisGroups,
  yAxisConfig,
  pressureUnit = 'psi',
  tempUnit = 'c',
  distanceUnit = 'km',
}: ChartModuleProps) {
  const keys = useMemo(
    () => channelKeys.filter((k) => series[k]),
    [channelKeys, series],
  );
  const groups = useMemo(
    () => normalizeYAxisGroups(keys, yAxisGroups),
    [keys, yAxisGroups],
  );

  const keyToGroupIndex = useMemo(() => {
    const m: Record<string, number> = {};
    groups.forEach((row, gi) => {
      row.forEach((k) => {
        m[k] = gi;
      });
    });
    return m;
  }, [groups]);

  const channels: TelemetryChannel[] = useMemo(() => {
    return keys.map((k) => {
      const meta = channelMeta[k];
      const raw = series[k];
      let data = raw;
      const pStore = storagePressureUnit(meta, k);
      if (isPressureTelemetryChannel(meta, k)) {
        data = mapNumericArray(raw, (v) => convertPressure(v, pStore, pressureUnit));
      } else if (isCelsiusTelemetryChannel(meta, k) && tempUnit === 'f') {
        data = mapNumericArray(raw, (v) => convertTemp(v, 'c', 'f'));
      }
      return {
        label: channelMeta[k]?.label ?? k,
        data,
        yAxisID: yAxisIdForGroupIndex(keyToGroupIndex[k] ?? 0),
      };
    });
  }, [keys, keyToGroupIndex, series, channelMeta, pressureUnit, tempUnit]);

  const yScaleTitles = useMemo(() => {
    const titles: Record<string, string> = {};
    for (let gi = 0; gi < groups.length; gi++) {
      const axisId = yAxisIdForGroupIndex(gi);
      const gk = groups[gi];
      if (!gk.length) continue;
      let pressureStore: PressureUnit | null = null;
      let allPressure = true;
      let allCelsius = true;
      for (const k of gk) {
        const meta = channelMeta[k];
        if (isPressureTelemetryChannel(meta, k)) {
          const ps = storagePressureUnit(meta, k);
          if (pressureStore == null) pressureStore = ps;
          else if (pressureStore !== ps) allPressure = false;
        } else {
          allPressure = false;
        }
        if (!isCelsiusTelemetryChannel(meta, k)) allCelsius = false;
      }
      if (allPressure && pressureStore != null) {
        titles[axisId] = pressureLabel(pressureUnit);
      } else if (allCelsius) {
        titles[axisId] = tempLabel(tempUnit);
      }
    }
    return Object.keys(titles).length > 0 ? titles : undefined;
  }, [groups, channelMeta, pressureUnit, tempUnit]);

  const yOverrides = useMemo(() => {
    const out: Record<string, { min?: number; max?: number }> = {};
    for (const [axisId, cfg] of Object.entries(yAxisConfig ?? {})) {
      if (cfg?.autoScale !== false) continue;
      const o: { min?: number; max?: number } = {};
      if (cfg.min != null && Number.isFinite(cfg.min)) o.min = cfg.min;
      if (cfg.max != null && Number.isFinite(cfg.max)) o.max = cfg.max;
      if (Object.keys(o).length > 0) out[axisId] = o;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }, [yAxisConfig]);

  const sectionOverlays = useMemo(
    () => sections.map((s) => ({
      name: s.name,
      start: s.start_distance,
      end: s.end_distance,
    })),
    [sections],
  );

  return (
    <TelemetryChart
      xValues={xValues}
      xLabel={xLabel}
      xCursorField={xCursorField}
      channels={channels}
      lapSplits={lapSplits}
      sections={sectionOverlays}
      target={target}
      xRange={xRange}
      yOverrides={yOverrides}
      yScaleTitles={yScaleTitles}
      distanceDisplayUnit={xCursorField === 'distance' ? distanceUnit : undefined}
    />
  );
}
