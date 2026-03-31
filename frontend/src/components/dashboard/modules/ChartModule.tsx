import { useMemo, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
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

export const SMOOTH_LEVELS = [
  { label: 'Raw', window: 1 },
  { label: 'Light', window: 10 },
  { label: 'Medium', window: 25 },
  { label: 'Heavy', window: 50 },
  { label: 'Ultra', window: 100 },
] as const;

export function smoothMovingAvg(values: number[], windowSize: number): number[] {
  if (windowSize <= 1) return values;
  const half = Math.floor(windowSize / 2);
  const out = new Array<number>(values.length);
  for (let i = 0; i < values.length; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(values.length, i + half + 1);
    let sum = 0;
    let count = 0;
    for (let j = lo; j < hi; j++) {
      if (values[j] != null) {
        sum += values[j];
        count++;
      }
    }
    out[i] = count > 0 ? sum / count : values[i];
  }
  return out;
}

interface ChartModuleProps {
  xValues: number[];
  xLabel: string;
  xCursorField: 'distance' | 'time';
  series: Record<string, number[]>;
  channelMeta: Record<string, { label: string; unit?: string; category?: string }>;
  channelKeys: string[];
  lapSplits?: number[];
  sections?: { name: string; start_distance: number; end_distance: number }[];
  target?: number | null;
  xRange?: { min: number; max: number } | null;
  yAxisGroups?: string[][];
  yAxisConfig?: ChartYAxisConfig;
  pressureUnit?: PressureUnit;
  tempUnit?: TempUnit;
  distanceUnit?: DistanceUnit;
  rawPressureSeries?: Record<string, number[]>;
  smoothLevel?: number;
  channelColors?: Record<string, string>;
  groupColors?: Record<string, string>;
  onUserZoom?: () => void;
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

export function groupsToChannelAxisIndex(groups: string[][]): Record<string, number> {
  const map: Record<string, number> = {};
  groups.forEach((row, gi) => {
    for (const k of row) map[k] = gi;
  });
  return map;
}

export function rebuildGroupsFromAxisIndex(
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

export function addYAxisGroup(groups: string[][]): string[][] {
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

export function removeLastYAxisGroup(groups: string[][]): string[][] {
  if (groups.length <= 1) return groups;
  const out = groups.slice(0, -1);
  const last = groups[groups.length - 1];
  out[0] = [...out[0], ...last];
  return out;
}

export function compactYAxisConfig(
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
  groupColors?: Record<string, string>;
  onApply: (patch: {
    yAxisGroups?: string[][];
    yAxisConfig?: ChartYAxisConfig;
    groupColors?: Record<string, string>;
  }) => void;
}

const GROUP_LABELS = ['A', 'B', 'C', 'D'] as const;
const GROUP_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#c8960c'];

interface DraftScaleCfg {
  min: string;
  max: string;
  zero: boolean;
}

function buildDraftAssign(
  keys: string[],
  groups: string[][] | undefined,
): Record<string, number> {
  const normalized = normalizeYAxisGroups(keys, groups);
  const map: Record<string, number> = {};
  normalized.forEach((row, gi) => {
    for (const k of row) map[k] = gi;
  });
  for (const k of keys) {
    if (!(k in map)) map[k] = 0;
  }
  return map;
}

function buildDraftScales(
  config: ChartYAxisConfig | undefined,
): DraftScaleCfg[] {
  return GROUP_LABELS.map((_, gi) => {
    const axisId = yAxisIdForGroupIndex(gi);
    const cfg = config?.[axisId];
    const hasMin = cfg?.min != null && Number.isFinite(cfg.min);
    const hasMax = cfg?.max != null && Number.isFinite(cfg.max);
    return {
      min: hasMin ? String(cfg!.min) : '',
      max: hasMax ? String(cfg!.max) : '',
      zero: hasMin && cfg!.min === 0,
    };
  });
}

export function ChartYAxisHeaderButton({
  channelKeys,
  channelMeta,
  yAxisGroups,
  yAxisConfig,
  groupColors,
  onApply,
}: ChartYAxisHeaderButtonProps) {
  const [open, setOpen] = useState(false);

  const keys = useMemo(() => channelKeys.filter((k) => k), [channelKeys]);

  const [draftAssign, setDraftAssign] = useState<Record<string, number>>(() =>
    buildDraftAssign(keys, yAxisGroups),
  );
  const [draftScales, setDraftScales] = useState<DraftScaleCfg[]>(() =>
    buildDraftScales(yAxisConfig),
  );
  const [draftGroupColors, setDraftGroupColors] = useState<Record<string, string>>(() =>
    ({ ...(groupColors ?? {}) }),
  );

  useEffect(() => {
    if (open) {
      setDraftAssign(buildDraftAssign(keys, yAxisGroups));
      setDraftScales(buildDraftScales(yAxisConfig));
      setDraftGroupColors({ ...(groupColors ?? {}) });
    }
  }, [open, keys, yAxisGroups, yAxisConfig, groupColors]);

  const usedGroups = useMemo(() => {
    const used = new Set<number>();
    for (const gi of Object.values(draftAssign)) used.add(gi);
    return used;
  }, [draftAssign]);

  function resolveGroupColor(gi: number): string {
    return draftGroupColors[String(gi)] ?? GROUP_COLORS[gi] ?? GROUP_COLORS[0];
  }

  function handleApply() {
    const groups: string[][] = GROUP_LABELS.map(() => []);
    for (const k of keys) {
      const gi = draftAssign[k] ?? 0;
      groups[gi].push(k);
    }
    const nonEmpty = groups.filter((g) => g.length > 0);

    const config: ChartYAxisConfig = {};
    GROUP_LABELS.forEach((_, gi) => {
      const axisId = yAxisIdForGroupIndex(gi);
      if (!usedGroups.has(gi)) return;
      const s = draftScales[gi];
      const hasMin = s.min !== '';
      const hasMax = s.max !== '';
      if (hasMin || hasMax || s.zero) {
        config[axisId] = {
          autoScale: false,
          ...(hasMin ? { min: Number(s.min) } : {}),
          ...(hasMax ? { max: Number(s.max) } : {}),
          ...(s.zero && !hasMin ? { min: 0 } : {}),
        };
      }
    });

    const compactColors: Record<string, string> = {};
    for (const [gi, color] of Object.entries(draftGroupColors)) {
      const idx = Number(gi);
      if (usedGroups.has(idx) && color !== GROUP_COLORS[idx]) {
        compactColors[gi] = color;
      }
    }

    onApply({
      yAxisGroups: nonEmpty,
      yAxisConfig: Object.keys(config).length > 0 ? config : {},
      groupColors: Object.keys(compactColors).length > 0 ? compactColors : undefined,
    });
    setOpen(false);
  }

  function handleReset() {
    const fresh: Record<string, number> = {};
    for (const k of keys) fresh[k] = 0;
    setDraftAssign(fresh);
    setDraftScales(GROUP_LABELS.map(() => ({ min: '', max: '', zero: false })));
    setDraftGroupColors({});
  }

  if (keys.length === 0) return null;

  return (
    <>
      <button
        type="button"
        className={`panel-btn${open ? ' btn-active' : ''}`}
        title="Y axis groups and scale"
        onClick={() => setOpen((o) => !o)}
      >
        Y-Axis
      </button>
      {open && createPortal(
        <div className="yaxis-modal-overlay" onClick={() => setOpen(false)}>
          <div
            className="yaxis-modal"
            role="dialog"
            aria-label="Y-Axis Groups"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="yaxis-modal-header">
              <h3>Y-Axis Groups</h3>
              <button
                type="button"
                className="yaxis-modal-close"
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </div>

            <p className="yaxis-modal-desc">
              Assign channels to groups. Each group gets its own Y-axis scale.
            </p>

            <div className="yaxis-modal-channels">
              {keys.map((k) => {
                const active = draftAssign[k] ?? 0;
                return (
                  <div key={k} className="ygroup-row">
                    <span
                      className="ygroup-label"
                      style={{ color: resolveGroupColor(active) }}
                    >
                      {channelMeta[k]?.label ?? k}
                    </span>
                    <div className="ygroup-btns">
                      {GROUP_LABELS.map((lbl, gi) => (
                        <button
                          key={lbl}
                          type="button"
                          className={`ygroup-btn${active === gi ? ' active' : ''}`}
                          style={
                            { '--gc': resolveGroupColor(gi) } as React.CSSProperties
                          }
                          onClick={() =>
                            setDraftAssign((prev) => ({ ...prev, [k]: gi }))
                          }
                        >
                          {lbl}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="yaxis-modal-scales">
              <p className="yaxis-modal-scales-title">
                Scale limits (leave blank for auto)
              </p>
              {GROUP_LABELS.map((lbl, gi) => {
                if (!usedGroups.has(gi)) return null;
                const s = draftScales[gi];
                return (
                  <div key={lbl} className="yscale-row">
                    <span
                      className="yscale-label"
                      style={{ color: resolveGroupColor(gi) }}
                    >
                      <input
                        type="color"
                        className="group-color-picker"
                        value={resolveGroupColor(gi)}
                        title={`Color for Group ${lbl}`}
                        onChange={(e) => {
                          setDraftGroupColors((prev) => ({
                            ...prev,
                            [String(gi)]: e.target.value,
                          }));
                        }}
                      />
                      Group {lbl}
                    </span>
                    <div className="yscale-inputs">
                      <span>Min</span>
                      <input
                        type="number"
                        className="yscale-input"
                        placeholder="Auto"
                        value={s.zero && s.min === '' ? '0' : s.min}
                        onChange={(e) => {
                          const next = [...draftScales];
                          next[gi] = {
                            ...s,
                            min: e.target.value,
                            zero: e.target.value === '0',
                          };
                          setDraftScales(next);
                        }}
                      />
                      <span>–</span>
                      <span>Max</span>
                      <input
                        type="number"
                        className="yscale-input"
                        placeholder="Auto"
                        value={s.max}
                        onChange={(e) => {
                          const next = [...draftScales];
                          next[gi] = { ...s, max: e.target.value };
                          setDraftScales(next);
                        }}
                      />
                      <label className="yscale-zero-label">
                        <input
                          type="checkbox"
                          checked={s.zero}
                          onChange={(e) => {
                            const next = [...draftScales];
                            next[gi] = {
                              ...s,
                              zero: e.target.checked,
                              min: e.target.checked ? '0' : '',
                            };
                            setDraftScales(next);
                          }}
                        />
                        Zero
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="yaxis-modal-footer">
              <button
                type="button"
                className="panel-btn"
                onClick={handleReset}
              >
                Reset all
              </button>
              <button
                type="button"
                className="yaxis-modal-apply"
                onClick={handleApply}
              >
                Apply
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
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
  rawPressureSeries,
  smoothLevel = 0,
  channelColors,
  groupColors,
  onUserZoom,
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

  const smoothWin = SMOOTH_LEVELS[smoothLevel]?.window ?? 1;

  const channels: TelemetryChannel[] = useMemo(() => {
    return keys.map((k) => {
      const meta = channelMeta[k];
      let data: number[];
      const isPressure = isPressureTelemetryChannel(meta, k);
      if (isPressure && rawPressureSeries?.[k]) {
        data = smoothWin > 1
          ? smoothMovingAvg(rawPressureSeries[k], smoothWin)
          : rawPressureSeries[k];
      } else {
        data = series[k];
      }
      const pStore = storagePressureUnit(meta, k);
      if (isPressure) {
        data = mapNumericArray(data, (v) => convertPressure(v, pStore, pressureUnit));
      } else if (isCelsiusTelemetryChannel(meta, k) && tempUnit === 'f') {
        data = mapNumericArray(data, (v) => convertTemp(v, 'c', 'f'));
      }
      return {
        label: channelMeta[k]?.label ?? k,
        data,
        yAxisID: yAxisIdForGroupIndex(keyToGroupIndex[k] ?? 0),
        ...(channelColors?.[k] ? { color: channelColors[k] } : {}),
      };
    });
  }, [keys, keyToGroupIndex, series, channelMeta, pressureUnit, tempUnit, rawPressureSeries, smoothWin, channelColors]);

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

  const yAxisColors = useMemo(() => {
    if (!groupColors || Object.keys(groupColors).length === 0) return undefined;
    const map: Record<string, string> = {};
    for (let gi = 0; gi < groups.length; gi++) {
      const axisId = yAxisIdForGroupIndex(gi);
      const c = groupColors[String(gi)];
      if (c) map[axisId] = c;
    }
    return Object.keys(map).length > 0 ? map : undefined;
  }, [groups, groupColors]);

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
      yAxisColors={yAxisColors}
      distanceDisplayUnit={xCursorField === 'distance' ? distanceUnit : undefined}
      onUserZoom={onUserZoom}
    />
  );
}
