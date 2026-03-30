import { useMemo, useCallback } from 'react';
import type { TrackSection } from '../../types/models';
import type { DashboardData } from '../dashboard/Dashboard';
import { metersToDistanceDisplay, type DistanceUnit } from '../../utils/units';

/** Matches backend `CHANNEL_SIGNATURES` display strings for resolution. */
const CANONICAL_DISPLAY: Record<string, string> = {
  speed: 'Speed',
  pbrake_f: 'Brake pressure front',
};

export interface SectionMetricsProps {
  sections: TrackSection[];
  dashData: DashboardData;
  sessionId: string;
  /** Matches prefs / dashboard distance axis (meters in data → km or mi labels). */
  distanceUnit?: DistanceUnit;
  /** Zoom charts to this lap’s X extent (distance or time), same units as dashboard X axis. */
  onZoomToLap?: (min: number, max: number) => void;
}

type SectionBoundary = { name: string; start_distance: number; end_distance: number };

interface CellStats {
  duration: number | null;
  minSpeed: number | null;
  maxBrake: number | null;
}

function bisectLeft(arr: number[], x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function bisectRight(arr: number[], x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1);
  const dLon = toR(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function gpsTotalFromPoints(points: NonNullable<DashboardData['points']>): number {
  if (!points || points.length < 2) return 0;
  let cum = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a?.lat == null || a?.lng == null || b?.lat == null || b?.lng == null) continue;
    cum += haversineM(a.lat, a.lng, b.lat, b.lng);
  }
  return cum;
}

function resolveChannel(
  canonical: string,
  channelMeta: DashboardData['channel_meta'],
): string | null {
  if (canonical in channelMeta) return canonical;
  const lower = canonical.toLowerCase();
  for (const raw of Object.keys(channelMeta)) {
    if (raw.toLowerCase() === lower) return raw;
  }
  const target = CANONICAL_DISPLAY[canonical]?.toLowerCase();
  if (!target) return null;
  for (const [raw, meta] of Object.entries(channelMeta)) {
    const lab = (meta.label ?? (meta as { display?: string }).display ?? '').toLowerCase();
    if (lab === target) return raw;
  }
  return null;
}

function sliceStats(
  times: number[],
  distances: number[],
  speedKey: string | null,
  brakeKey: string | null,
  series: DashboardData['series'],
  startD: number,
  endD: number,
): CellStats {
  const iStart = bisectLeft(distances, startD);
  let iEnd = bisectRight(distances, endD);
  if (iEnd <= iStart || iStart >= times.length) {
    return { duration: null, minSpeed: null, maxBrake: null };
  }
  iEnd = Math.min(iEnd, times.length);
  const tStart = times[iStart];
  const tEnd = times[iEnd - 1];
  const duration = tEnd - tStart;
  if (duration <= 0) return { duration: null, minSpeed: null, maxBrake: null };

  const speed = speedKey ? series[speedKey] ?? [] : [];
  const brake = brakeKey ? series[brakeKey] ?? [] : [];

  let minSpeed: number | null = null;
  for (let i = iStart; i < iEnd; i++) {
    const v = speed[i];
    if (v != null && Number.isFinite(v)) {
      minSpeed = minSpeed === null ? v : Math.min(minSpeed, v);
    }
  }

  let maxBrake: number | null = null;
  for (let i = iStart; i < iEnd; i++) {
    const v = brake[i];
    if (v != null && Number.isFinite(v)) {
      maxBrake = maxBrake === null ? v : Math.max(maxBrake, v);
    }
  }

  return {
    duration: Math.round(duration * 1000) / 1000,
    minSpeed: minSpeed != null ? Math.round(minSpeed * 10) / 10 : null,
    maxBrake: maxBrake != null ? Math.round(maxBrake * 100) / 100 : null,
  };
}

/** `m:ss.SSS` if ≥ 60s, else `ss.SSS`. */
function formatSectionTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  const frac = s.toFixed(3);
  if (m > 0) return `${m}:${frac.padStart(6, '0')}`;
  return frac;
}

function formatDelta(delta: number): string {
  if (!Number.isFinite(delta)) return '—';
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta.toFixed(3)}`;
}

function deltaClass(delta: number | null, isBest: boolean): string {
  if (delta == null || !Number.isFinite(delta)) return '';
  if (isBest || delta < 0.0005) return 'delta-best';
  if (delta < 0.1) return 'delta-negative';
  return 'delta-positive';
}

function normalizeSections(
  sections: TrackSection[],
  dashSections: DashboardData['sections'],
): SectionBoundary[] {
  if (sections.length > 0) {
    return sections.map((s) => ({
      name: s.name,
      start_distance: s.start_distance,
      end_distance: s.end_distance,
    }));
  }
  return (dashSections ?? []).map((s) => ({
    name: s.name,
    start_distance: s.start_distance,
    end_distance: s.end_distance,
  }));
}

const KMH_TO_MPH = 0.621371192237334;

export default function SectionMetrics({
  sections: sectionsProp,
  dashData,
  sessionId,
  distanceUnit = 'km',
  onZoomToLap,
}: SectionMetricsProps) {
  const computed = useMemo(() => {
    const times = dashData.times ?? [];
    const distances = dashData.distances ?? [];
    const series = dashData.series ?? {};
    const channelMeta = dashData.channel_meta ?? {};

    if (!times.length || !distances.length || times.length !== distances.length) {
      return { error: 'Section metrics need aligned time and distance telemetry.' as const };
    }

    const sectionDefs = normalizeSections(sectionsProp, dashData.sections);
    if (!sectionDefs.length) {
      return { error: 'No track sections defined. Add sections for this track first.' as const };
    }

    if (!dashData.has_distance) {
      return {
        error:
          'Section metrics use distance-based lap splits and integrated distance. This session has no distance channel.',
      } as const;
    }

    const splits = dashData.lap_split_distances ?? [];
    if (splits.length < 2) {
      return { error: 'Need lap boundary splits to compute per-lap sections.' as const };
    }

    const speedKey = resolveChannel('speed', channelMeta);
    const brakeKey = resolveChannel('pbrake_f', channelMeta);
    if (!speedKey) {
      return { error: 'Speed channel is required for section metrics.' as const };
    }

    let gpsTotal = gpsTotalFromPoints(dashData.points ?? []);
    if (gpsTotal <= 0) {
      const secMax = Math.max(...sectionDefs.map((s) => s.end_distance), 0);
      gpsTotal = secMax > 0 ? secMax : 1;
    }

    const lapRanges: { start: number; end: number }[] = [];
    for (let i = 0; i < splits.length - 1; i++) {
      lapRanges.push({ start: splits[i], end: splits[i + 1] });
    }

    const grid: CellStats[][] = lapRanges.map(({ start: lapD0, end: lapD1 }) => {
      const lapLen = lapD1 - lapD0;
      const scale = lapLen / gpsTotal;
      return sectionDefs.map((sec) => {
        const secStart = lapD0 + sec.start_distance * scale;
        let secEnd = lapD0 + sec.end_distance * scale;
        secEnd = Math.min(secEnd, lapD1);
        return sliceStats(times, distances, speedKey, brakeKey, series, secStart, secEnd);
      });
    });

    const nLaps = grid.length;
    const nSec = sectionDefs.length;
    const bestDur: (number | null)[] = Array(nSec).fill(null);
    for (let si = 0; si < nSec; si++) {
      for (let li = 1; li < nLaps; li++) {
        const d = grid[li][si]?.duration;
        if (d == null) continue;
        bestDur[si] = bestDur[si] === null ? d : Math.min(bestDur[si]!, d);
      }
    }

    let virtualBestTotal = 0;
    let vbParts = 0;
    for (let si = 0; si < nSec; si++) {
      if (bestDur[si] != null) {
        virtualBestTotal += bestDur[si]!;
        vbParts++;
      }
    }
    if (vbParts === 0) virtualBestTotal = NaN;

    const improvement: {
      name: string;
      avgDelta: number;
      vbDuration: number;
      index: number;
    }[] = [];

    for (let si = 0; si < nSec; si++) {
      const vb = bestDur[si];
      if (vb == null) continue;
      const deltas: number[] = [];
      for (let li = 1; li < nLaps; li++) {
        const d = grid[li][si]?.duration;
        if (d != null) deltas.push(Math.round((d - vb) * 1000) / 1000);
      }
      if (!deltas.length) continue;
      const avgDelta = Math.round((deltas.reduce((a, b) => a + b, 0) / deltas.length) * 1000) / 1000;
      improvement.push({
        index: si,
        name: sectionDefs[si].name,
        vbDuration: vb,
        avgDelta,
      });
    }
    improvement.sort((a, b) => b.avgDelta - a.avgDelta);

    const sectionBestTimes = sectionDefs.map((_, si) => bestDur[si]);

    return {
      error: null as null,
      sectionDefs,
      grid,
      lapRanges,
      bestDur,
      virtualBestTotal: Number.isFinite(virtualBestTotal)
        ? Math.round(virtualBestTotal * 1000) / 1000
        : null,
      improvement,
      sectionBestTimes,
      splits,
    };
  }, [dashData, sectionsProp]);

  const onRowClick = useCallback(
    (lapRowIndex: number) => {
      if (!onZoomToLap) return;
      if (!computed || computed.error) return;
      const lt = dashData.lap_times[lapRowIndex];
      const lapNum = lt?.lap ?? lapRowIndex + 1;
      const { splits } = computed;
      const lo = lapNum - 1;
      const hi = lapNum;
      if (lo < 0 || hi >= splits.length) return;
      const min = splits[lo];
      const max = splits[hi];
      if (min < max) onZoomToLap(min, max);
    },
    [onZoomToLap, dashData.lap_times, computed],
  );

  if ('error' in computed && computed.error) {
    return (
      <div className="section-metrics" data-session={sessionId}>
        <p className="muted">{computed.error}</p>
      </div>
    );
  }

  const {
    sectionDefs,
    grid,
    bestDur,
    virtualBestTotal,
    improvement,
    sectionBestTimes,
  } = computed;

  const lapTimes = dashData.lap_times ?? [];
  const fastIdx = dashData.fast_lap_index ?? null;

  return (
    <div className="section-metrics" data-session={sessionId}>
      <div className="vbl-card">
        <span className="vbl-card-label">Virtual Best Lap</span>
        <span className="vbl-card-time">
          {virtualBestTotal != null ? formatSectionTime(virtualBestTotal) : '—'}
        </span>
        <span className="vbl-card-hint">Sum of best sector times (excl. out-lap)</span>
      </div>

      {improvement.length > 0 && (
        <div className="improvement-block">
          <h4 className="improvement-heading">Improvement opportunities</h4>
          <ul className="improvement-list">
            {improvement.slice(0, 12).map((row, rank) => (
              <li key={row.index} className={`improvement-item${rank < 3 ? ' improvement-item-top' : ''}`}>
                <span className="improvement-rank">{rank + 1}</span>
                <div className="improvement-body">
                  <div className="improvement-title">{row.name}</div>
                  <div className="improvement-meta">
                    <span>Avg loss vs best: +{row.avgDelta.toFixed(3)}s</span>
                    <span className="improvement-sep">·</span>
                    <span>Best in section: {formatSectionTime(row.vbDuration)}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="section-badge-row">
        {sectionDefs.map((s, si) => (
          <span
            key={`${s.name}-${si}`}
            className="section-badge"
            title={`${metersToDistanceDisplay(s.start_distance, distanceUnit).toFixed(3)}–${metersToDistanceDisplay(s.end_distance, distanceUnit).toFixed(3)} ${distanceUnit}`}
          >
            <span className="section-badge-name">{s.name}</span>
            <span className="section-badge-time">
              {sectionBestTimes[si] != null ? formatSectionTime(sectionBestTimes[si]!) : '—'}
            </span>
          </span>
        ))}
      </div>

      <div className="section-grid-scroll">
        <table className="section-grid">
          <thead>
            <tr>
              <th className="section-grid-sticky">Lap</th>
              {sectionDefs.map((s, si) => (
                <th key={`h-${si}`} className={si > 0 ? 'section-grid-sec-start' : ''}>
                  <div className="section-grid-th-inner">{s.name}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((row, li) => {
              const lt = lapTimes[li];
              const lapLabel = lt ? String(lt.lap) : String(li + 1);
              const isOut = li === 0;
              const isFast = fastIdx != null && li === fastIdx;
              return (
                <tr
                  key={`lap-${li}`}
                  className={`section-grid-row${isOut ? ' section-row-outlap' : ''}${isFast ? ' section-row-fast' : ''}${onZoomToLap ? ' section-grid-row-clickable' : ''}`}
                  onClick={() => onRowClick(li)}
                >
                  <th className="section-grid-sticky" scope="row">
                    {lapLabel}
                    {isFast && <span className="section-lap-fast">★</span>}
                  </th>
                  {row.map((cell, si) => {
                    const vb = bestDur[si];
                    const dur = cell.duration;
                    const delta = dur != null && vb != null ? Math.round((dur - vb) * 1000) / 1000 : null;
                    const isBest = delta != null && delta < 0.0005;
                    const dClass = deltaClass(delta, isBest);
                    return (
                      <td
                        key={`c-${li}-${si}`}
                        className={`section-grid-cell${si > 0 ? ' section-grid-sec-start' : ''}`}
                      >
                        <div className="section-cell-stack">
                          <div className="section-cell-time">{dur != null ? formatSectionTime(dur) : '—'}</div>
                          <div className="section-cell-sub">
                            <span>
                              {cell.minSpeed != null
                                ? (distanceUnit === 'mi'
                                    ? (cell.minSpeed * KMH_TO_MPH).toFixed(1)
                                    : cell.minSpeed.toFixed(1))
                                : '—'}{' '}
                              {distanceUnit === 'mi' ? 'mph' : 'km/h'} min
                            </span>
                            <span className="section-cell-sep">·</span>
                            <span>Brk {cell.maxBrake != null ? cell.maxBrake.toFixed(2) : '—'}</span>
                          </div>
                          <div className={`section-cell-delta ${dClass}`}>
                            {delta != null ? `Δ ${formatDelta(delta)}` : '—'}
                          </div>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
