import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../../api/client';
import type { TrackSection } from '../../types/models';
import TrackMap from '../maps/TrackMap';
import TelemetryChart from '../charts/TelemetryChart';
import type { TelemetryChannel } from '../charts/TelemetryChart';
import {
  ChartYAxisHeaderButton,
  normalizeYAxisGroups,
  yAxisIdForGroupIndex,
  type ChartYAxisConfig,
} from '../dashboard/modules/ChartModule';
import ChannelPickerModal from '../dashboard/ChannelPickerModal';
import { useCursorStore } from '../../contexts/CursorSyncContext';
import Button from '../ui/Button';

const CORNER_COLORS = [
  '#3b82f6', '#22c55e', '#eab308', '#ef4444', '#8b5cf6',
  '#06b6d4', '#f97316', '#ec4899', '#14b8a6', '#10b981',
  '#f43f5e', '#6366f1',
];
const STRAIGHT_COLOR = 'rgba(148,163,184,0.35)';

function isStraight(sec: TrackSection): boolean {
  return /straight/i.test(sec.name);
}

function assignSectionColors(sections: TrackSection[]): string[] {
  const colors: string[] = [];
  let cornerIdx = 0;
  for (const sec of sections) {
    if (isStraight(sec)) {
      colors.push(STRAIGHT_COLOR);
    } else {
      colors.push(CORNER_COLORS[cornerIdx % CORNER_COLORS.length]);
      cornerIdx++;
    }
  }
  return colors;
}

function hexToRgba(hex: string, alpha: number): string {
  if (hex.startsWith('rgba')) return hex.replace(/[\d.]+\)$/, `${alpha})`);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function uid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function reAutoName(sections: TrackSection[]): TrackSection[] {
  interface Group { type: 'straight' | 'corner'; gid?: number | null; items: TrackSection[] }
  const groups: Group[] = [];
  let currentGroup: Group | null = null;
  for (const sec of sections) {
    if (isStraight(sec)) {
      currentGroup = null;
      groups.push({ type: 'straight', items: [sec] });
    } else {
      const gid = sec.corner_group;
      if (currentGroup && currentGroup.type === 'corner' && currentGroup.gid === gid && gid != null) {
        currentGroup.items.push(sec);
      } else {
        currentGroup = { type: 'corner', gid, items: [sec] };
        groups.push(currentGroup);
      }
    }
  }
  let cornerNum = 0;
  let straightNum = 0;
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  for (const g of groups) {
    if (g.type === 'straight') {
      straightNum++;
      g.items[0] = { ...g.items[0], name: `Straight ${straightNum}` };
    } else {
      cornerNum++;
      if (g.items.length === 1) {
        g.items[0] = { ...g.items[0], name: `Corner ${cornerNum}` };
      } else {
        for (let j = 0; j < g.items.length; j++) {
          g.items[j] = { ...g.items[j], name: `Corner ${cornerNum}${letters[j] ?? j}` };
        }
      }
    }
  }
  const result: TrackSection[] = [];
  for (const g of groups) result.push(...g.items);
  return result.map((s, i) => ({ ...s, sort_order: i }));
}

function linkBoundary(
  secs: TrackSection[], idx: number, field: 'start_distance' | 'end_distance', val: number,
): TrackSection[] {
  const next = secs.map((s) => ({ ...s }));
  next[idx][field] = val;
  if (field === 'end_distance' && idx < next.length - 1) next[idx + 1].start_distance = val;
  if (field === 'start_distance' && idx > 0) next[idx - 1].end_distance = val;
  return next;
}

export interface SectionEditorProps {
  sessionId: string;
  trackName: string;
  points: { lat: number; lng: number; distance?: number }[];
  xValues: number[];
  xLabel: string;
  /** Pre-built default channels (proven data flow for initial display) */
  defaultChannels: TelemetryChannel[];
  /** Per-channel sliced data for the fastest lap (used when user changes channels/axes) */
  series: Record<string, number[]>;
  channelMeta: Record<string, { label: string; unit?: string; category?: string }>;
  channelsByCategory: Record<string, string[]>;
  defaultChannelKeys: string[];
  sections: TrackSection[];
  onSectionsChange?: (sections: TrackSection[]) => void;
  /** Lap segment indices for track map GPS (from session time splits). */
  referenceLapOptions?: { segmentIndex: number; label: string }[];
  appliedReferenceIndex?: number | null;
  onApplyReferenceLap?: (segmentIndex: number) => Promise<void>;
  referenceLapApplyPending?: boolean;
}

export default function SectionEditor({
  sessionId, trackName, points, xValues, xLabel,
  defaultChannels, series, channelMeta, channelsByCategory, defaultChannelKeys,
  sections: initialSections, onSectionsChange,
  referenceLapOptions = [],
  appliedReferenceIndex = null,
  onApplyReferenceLap,
  referenceLapApplyPending = false,
}: SectionEditorProps) {
  const qc = useQueryClient();
  const [selectedRefLap, setSelectedRefLap] = useState(appliedReferenceIndex ?? 0);
  useEffect(() => {
    if (appliedReferenceIndex != null) setSelectedRefLap(appliedReferenceIndex);
  }, [appliedReferenceIndex]);
  const [sections, setSections] = useState<TrackSection[]>(initialSections);
  const [activeIdx, setActiveIdx] = useState<number>(-1);
  const groupCounter = useRef(
    initialSections.reduce((max, s) => (s.corner_group != null && s.corner_group >= max ? s.corner_group + 1 : max), 0)
  );
  const cursorStore = useCursorStore();

  // Channel & Y-Axis state — tracks whether user has customized channels/axes
  const [channelKeys, setChannelKeys] = useState<string[]>(defaultChannelKeys);
  const [userChanged, setUserChanged] = useState(false);
  const [channelColors, setChannelColors] = useState<Record<string, string>>({});
  const [channelPickerOpen, setChannelPickerOpen] = useState(false);
  const [yAxisGroups, setYAxisGroups] = useState<string[][] | undefined>(undefined);
  const [yAxisConfig, setYAxisConfig] = useState<ChartYAxisConfig | undefined>(undefined);
  const [groupColors, setGroupColors] = useState<Record<string, string> | undefined>(undefined);

  const maxDist = useMemo(() => {
    if (xValues.length > 0) return xValues[xValues.length - 1];
    if (points.length > 0) return points[points.length - 1].distance ?? 0;
    return 0;
  }, [xValues, points]);

  function newGroupId(): number { return groupCounter.current++; }

  function splitSection(idx: number) {
    const sec = sections[idx];
    let splitAt: number | null = cursorStore.getSnapshot().distance;
    if (splitAt == null || splitAt <= sec.start_distance || splitAt >= sec.end_distance)
      splitAt = Math.round((sec.start_distance + sec.end_distance) / 2);
    const wasStraight = isStraight(sec);
    const gid = sec.corner_group ?? newGroupId();
    const first: TrackSection = {
      ...sec, id: uid(), name: wasStraight ? 'Straight X' : 'Corner X',
      end_distance: Math.round(splitAt), sort_order: idx,
      corner_group: wasStraight ? null : gid,
    };
    const second: TrackSection = {
      ...sec, id: uid(), name: wasStraight ? 'Straight X' : 'Corner X',
      start_distance: Math.round(splitAt), sort_order: idx + 1,
      corner_group: wasStraight ? null : gid,
    };
    const next = [...sections];
    next.splice(idx, 1, first, second);
    setSections(reAutoName(next));
  }

  function deleteSection(idx: number) {
    const removed = sections[idx];
    const next = sections.filter((_, i) => i !== idx).map((s) => ({ ...s }));
    const prev = idx > 0 ? next[idx - 1] : null;
    const nextSec = idx < next.length ? next[idx] : null;
    if (prev && nextSec) {
      const mid = Math.round((removed.start_distance + removed.end_distance) / 2);
      prev.end_distance = mid;
      nextSec.start_distance = mid;
    } else if (prev) {
      prev.end_distance = removed.end_distance;
    } else if (nextSec) {
      nextSec.start_distance = removed.start_distance;
    }
    if (activeIdx === idx) setActiveIdx(-1);
    else if (activeIdx > idx) setActiveIdx((p) => p - 1);
    setSections(reAutoName(next));
  }

  function toggleType(idx: number) {
    const next = sections.map((s) => ({ ...s }));
    const sec = next[idx];
    if (isStraight(sec)) { sec.name = 'Corner X'; sec.corner_group = newGroupId(); }
    else { sec.name = 'Straight X'; sec.corner_group = null; }
    setSections(reAutoName(next));
  }

  function addSection() {
    const lastEnd = sections.length > 0 ? sections[sections.length - 1].end_distance : 0;
    const newSec: TrackSection = {
      id: uid(), track_name: trackName, name: 'Corner X',
      start_distance: Math.round(lastEnd),
      end_distance: Math.round(Math.min(lastEnd + 100, maxDist)),
      section_type: 'manual', sort_order: sections.length, corner_group: newGroupId(),
    };
    setSections(reAutoName([...sections, newSec]));
  }

  const handleBoundaryDrag = useCallback(
    (secIdx: number, edge: 'start' | 'end', value: number) => {
      const clamped = Math.max(0, Math.min(maxDist, Math.round(value)));
      const field = edge === 'start' ? 'start_distance' as const : 'end_distance' as const;
      setSections((prev) => linkBoundary(prev, secIdx, field, clamped));
    }, [maxDist],
  );

  const handleFieldEdit = useCallback(
    (idx: number, field: 'start_distance' | 'end_distance', val: number) => {
      const clamped = Math.max(0, Math.min(maxDist, val));
      setSections((prev) => linkBoundary(prev, idx, field, clamped));
    }, [maxDist],
  );

  const saveMut = useMutation({
    mutationFn: () => apiPost<{ ok: boolean; sections: TrackSection[] }>(`/api/sections/${trackName}`, { sections }),
    onSuccess: (result) => {
      setSections(result.sections);
      onSectionsChange?.(result.sections);
      qc.invalidateQueries({ queryKey: ['session-detail', sessionId] });
    },
  });

  const autoMut = useMutation({
    mutationFn: () => apiGet<TrackSection[]>(`/api/sections/${trackName}/auto-detect?session_id=${sessionId}`),
    onSuccess: (result) => { setSections(result); setActiveIdx(-1); },
  });

  const sectionColors = useMemo(() => assignSectionColors(sections), [sections]);

  const mapOverlays = useMemo(() =>
    sections.map((s, i) => ({
      name: s.name, start: s.start_distance, end: s.end_distance, color: sectionColors[i],
    })), [sections, sectionColors],
  );

  const chartBands = useMemo(() =>
    sections.map((s, i) => ({
      name: s.name, start: s.start_distance, end: s.end_distance,
      color: hexToRgba(sectionColors[i], 0.12),
    })), [sections, sectionColors],
  );

  // Build TelemetryChannel[] from selected keys + Y-axis groups
  const groups = useMemo(() => normalizeYAxisGroups(channelKeys, yAxisGroups), [channelKeys, yAxisGroups]);
  const keyToGroupIndex = useMemo(() => {
    const m: Record<string, number> = {};
    groups.forEach((row, gi) => { row.forEach((k) => { m[k] = gi; }); });
    return m;
  }, [groups]);

  const channels: TelemetryChannel[] = useMemo(() => {
    // Use pre-built channels when user hasn't customized anything
    if (!userChanged && defaultChannels.length > 0) return defaultChannels;
    const expectedLen = xValues.length;
    return channelKeys.filter((k) => series[k]?.length > 0).map((k) => {
      let data = series[k];
      if (data.length !== expectedLen) {
        data = data.length > expectedLen ? data.slice(0, expectedLen) : data;
      }
      return {
        label: (channelMeta[k] as { label?: string; display?: string })?.label
          ?? (channelMeta[k] as { display?: string })?.display
          ?? k,
        data,
        yAxisID: yAxisIdForGroupIndex(keyToGroupIndex[k] ?? 0),
        ...(channelColors[k] ? { color: channelColors[k] } : {}),
      };
    });
  }, [userChanged, defaultChannels, channelKeys, series, channelMeta, keyToGroupIndex, channelColors, xValues]);

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

  const yAxisColorMap = useMemo(() => {
    if (!groupColors || Object.keys(groupColors).length === 0) return undefined;
    const map: Record<string, string> = {};
    for (let gi = 0; gi < groups.length; gi++) {
      const c = groupColors[String(gi)];
      if (c) map[yAxisIdForGroupIndex(gi)] = c;
    }
    return Object.keys(map).length > 0 ? map : undefined;
  }, [groups, groupColors]);

  const handleChannelApply = useCallback((keys: string[], colors: Record<string, string>) => {
    setChannelKeys(keys);
    setChannelColors(colors);
    setUserChanged(true);
    setChannelPickerOpen(false);
  }, []);

  const handleYAxisApply = useCallback((patch: {
    yAxisGroups?: string[][]; yAxisConfig?: ChartYAxisConfig; groupColors?: Record<string, string>;
  }) => {
    setYAxisGroups(patch.yAxisGroups);
    setYAxisConfig(patch.yAxisConfig);
    setGroupColors(patch.groupColors);
    setUserChanged(true);
  }, []);

  return (
    <div className="sec-editor">
      <div className="sec-top-row">
        <div className="sec-panel sec-map-panel">
          <TrackMap points={points} sections={mapOverlays} />
        </div>
        <div className="sec-panel sec-table-panel">
          <div className="sec-toolbar">
            <Button size="sm" variant="secondary"
              onClick={() => { if (confirm('Regenerate sections? This replaces current sections.')) autoMut.mutate(); }}>
              Regenerate Sections
            </Button>
            <Button size="sm" variant="secondary" onClick={addSection}>+ Add</Button>
            <Button size="sm" onClick={() => saveMut.mutate()}>
              {saveMut.isPending ? 'Saving...' : 'Save'}
            </Button>
            {referenceLapOptions.length > 0 && onApplyReferenceLap && (
              <>
                <label className="sec-ref-lap-field">
                  <span className="sec-ref-lap-label">Map lap</span>
                  <select
                    className="sec-ref-lap-select"
                    value={selectedRefLap}
                    onChange={(e) => setSelectedRefLap(Number(e.target.value))}
                  >
                    {referenceLapOptions.map((o) => (
                      <option key={o.segmentIndex} value={o.segmentIndex}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={
                    referenceLapApplyPending
                    || selectedRefLap === appliedReferenceIndex
                  }
                  onClick={() => onApplyReferenceLap(selectedRefLap)}
                >
                  {referenceLapApplyPending ? 'Applying…' : 'Apply map lap'}
                </Button>
                <span className="sec-ref-lap-applied">
                  {appliedReferenceIndex != null
                    ? `Current: Lap ${appliedReferenceIndex + 1}`
                    : 'Current: Auto'}
                </span>
              </>
            )}
          </div>
          <div className="sec-table-scroll">
            <table className="sec-table">
              <thead>
                <tr>
                  <th style={{ width: '1.5rem' }} />
                  <th>Section</th>
                  <th style={{ width: '2rem' }}>Type</th>
                  <th>Start (m)</th>
                  <th>End (m)</th>
                  <th>Len</th>
                  <th style={{ width: '4.5rem' }} />
                </tr>
              </thead>
              <tbody>
                {sections.map((sec, i) => {
                  const c = sectionColors[i];
                  const st = isStraight(sec);
                  return (
                    <tr key={sec.id}
                      className={`section-row${i === activeIdx ? ' active' : ''}`}
                      onClick={() => setActiveIdx(i === activeIdx ? -1 : i)}>
                      <td><span className="sec-color-dot" style={{ background: c }} /></td>
                      <td>
                        <input className="sec-name-input" value={sec.name}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            const next = sections.map((s, j) => j === i ? { ...s, name: e.target.value } : s);
                            setSections(next);
                          }} />
                      </td>
                      <td>
                        <button type="button"
                          className={`sec-type-btn ${st ? 'is-straight' : 'is-corner'}`}
                          title="Toggle Corner / Straight"
                          onClick={(e) => { e.stopPropagation(); toggleType(i); }}>
                          {st ? 'S' : 'C'}
                        </button>
                      </td>
                      <td>
                        <input className="sec-num-input" type="number"
                          value={Math.round(sec.start_distance)}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => handleFieldEdit(i, 'start_distance', parseFloat(e.target.value) || 0)} />
                      </td>
                      <td>
                        <input className="sec-num-input" type="number"
                          value={Math.round(sec.end_distance)}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => handleFieldEdit(i, 'end_distance', parseFloat(e.target.value) || 0)} />
                      </td>
                      <td className="sec-len-cell">{Math.round(sec.end_distance - sec.start_distance)}</td>
                      <td className="sec-actions">
                        <button type="button" className="btn-icon" title="Split at cursor"
                          onClick={(e) => { e.stopPropagation(); splitSection(i); }}>&#9986;</button>
                        <button type="button" className="btn-icon btn-del" title="Delete"
                          onClick={(e) => { e.stopPropagation(); deleteSection(i); }}>&#10005;</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div className="sec-chart-row">
        <div className="sec-chart-controls">
          <button type="button"
            className={`panel-btn${channelPickerOpen ? ' btn-active' : ''}`}
            onClick={() => setChannelPickerOpen((o) => !o)}>
            Channels
          </button>
          <ChartYAxisHeaderButton
            channelKeys={channelKeys}
            channelMeta={channelMeta}
            yAxisGroups={yAxisGroups}
            yAxisConfig={yAxisConfig}
            groupColors={groupColors}
            onApply={handleYAxisApply}
          />
        </div>
        <div className="sec-chart-wrap">
          <TelemetryChart xValues={xValues} xLabel={xLabel} channels={channels}
            sections={chartBands}
            yOverrides={yOverrides}
            yAxisColors={yAxisColorMap}
            xCursorField="distance" onBoundaryDrag={handleBoundaryDrag}
            disableClickPin />
        </div>
      </div>
      <ChannelPickerModal
        open={channelPickerOpen}
        onClose={() => setChannelPickerOpen(false)}
        channelsByCategory={channelsByCategory}
        channelMeta={channelMeta}
        selected={channelKeys}
        channelColors={channelColors}
        onApply={handleChannelApply}
      />
    </div>
  );
}
