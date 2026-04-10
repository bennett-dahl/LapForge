import { useState, useMemo, useCallback } from 'react';
import type { TrackSection } from '../../types/models';
import type { DashboardData } from '../dashboard/Dashboard';
import {
  metersToDistanceDisplay,
  convertSpeed,
  convertPressure,
  storagePressureUnit,
  type DistanceUnit,
  type SpeedUnit,
  type PressureUnit,
} from '../../utils/units';

/** Matches backend `CHANNEL_SIGNATURES` display strings for resolution. */
const CANONICAL_DISPLAY: Record<string, string> = {
  speed: 'Speed',
  pbrake_f: 'Brake pressure front',
  aps: 'Throttle position',
};

export interface SessionMeta {
  driver?: string;
  track?: string;
  sessionType?: string;
  car?: string;
  outingNumber?: string;
  sessionNumber?: string;
  lapCount?: number | null;
  fastestLapTime?: number | null;
  tireSet?: string | null;
  ambientTempC?: number | null;
  trackTempC?: number | null;
  notes?: string | null;
}

export interface SectionMetricsProps {
  sections: TrackSection[];
  dashData: DashboardData;
  sessionId: string;
  speedUnit?: SpeedUnit;
  pressureUnit?: PressureUnit;
  onZoomToLap?: (min: number, max: number) => void;
  /** 0-based segment indices excluded from virtual best / improvement averages (includes out-lap 0). */
  excludedLaps?: number[];
  onToggleExcludeLap?: (segmentIndex: number) => void;
  hasExclusionDraft?: boolean;
  onApplyExclusions?: () => void;
  onDiscardExclusions?: () => void;
  applyExclusionsPending?: boolean;
  sessionMeta?: SessionMeta;
}

type SectionBoundary = { name: string; start_distance: number; end_distance: number };

interface CellStats {
  duration: number | null;
  minSpeed: number | null;
  maxSpeed: number | null;
  avgSpeed: number | null;
  minThrottle: number | null;
  maxThrottle: number | null;
  avgThrottle: number | null;
  minBrake: number | null;
  maxBrake: number | null;
  avgBrake: number | null;
}

const EMPTY_CELL: CellStats = {
  duration: null,
  minSpeed: null, maxSpeed: null, avgSpeed: null,
  minThrottle: null, maxThrottle: null, avgThrottle: null,
  minBrake: null, maxBrake: null, avgBrake: null,
};

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

function channelMinMaxAvg(
  arr: number[],
  cStart: number,
  cEnd: number,
): { min: number | null; max: number | null; avg: number | null } {
  let min: number | null = null;
  let max: number | null = null;
  let sum = 0;
  let count = 0;
  for (let i = cStart; i < cEnd; i++) {
    const v = arr[i];
    if (v != null && Number.isFinite(v)) {
      min = min === null ? v : Math.min(min, v);
      max = max === null ? v : Math.max(max, v);
      sum += v;
      count++;
    }
  }
  return { min, max, avg: count > 0 ? sum / count : null };
}

function sliceStats(
  rawTimes: number[],
  rawDistances: number[],
  speedKey: string | null,
  brakeKey: string | null,
  throttleKey: string | null,
  series: DashboardData['series'],
  chartDistances: number[],
  startD: number,
  endD: number,
): CellStats {
  const iStart = bisectLeft(rawDistances, startD);
  let iEnd = bisectRight(rawDistances, endD);
  if (iEnd <= iStart || iStart >= rawTimes.length) return EMPTY_CELL;
  iEnd = Math.min(iEnd, rawTimes.length);
  const tStart = rawTimes[iStart];
  const tEnd = rawTimes[iEnd - 1];
  const duration = tEnd - tStart;
  if (duration <= 0) return EMPTY_CELL;

  const cStart = bisectLeft(chartDistances, startD);
  let cEnd = bisectRight(chartDistances, endD);
  cEnd = Math.min(cEnd, chartDistances.length);

  const sp = channelMinMaxAvg(speedKey ? series[speedKey] ?? [] : [], cStart, cEnd);
  const br = channelMinMaxAvg(brakeKey ? series[brakeKey] ?? [] : [], cStart, cEnd);
  const th = channelMinMaxAvg(throttleKey ? series[throttleKey] ?? [] : [], cStart, cEnd);

  const r1 = (v: number | null) => (v != null ? Math.round(v * 10) / 10 : null);
  const r2 = (v: number | null) => (v != null ? Math.round(v * 100) / 100 : null);
  const r0 = (v: number | null) => (v != null ? Math.round(v) : null);

  return {
    duration: Math.round(duration * 1000) / 1000,
    minSpeed: r1(sp.min), maxSpeed: r1(sp.max), avgSpeed: r1(sp.avg),
    minThrottle: r0(th.min), maxThrottle: r0(th.max), avgThrottle: r0(th.avg),
    minBrake: r2(br.min), maxBrake: r2(br.max), avgBrake: r2(br.avg),
  };
}

/** `m:ss.SSS` if >= 60s, else `ss.SSS`. */
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

export default function SectionMetrics({
  sections: sectionsProp,
  dashData,
  sessionId,
  speedUnit = 'km/h',
  pressureUnit = 'psi',
  onZoomToLap,
  excludedLaps,
  onToggleExcludeLap,
  hasExclusionDraft,
  onApplyExclusions,
  onDiscardExclusions,
  applyExclusionsPending,
  sessionMeta,
}: SectionMetricsProps) {
  const [selectedCell, setSelectedCell] = useState<{ li: number; si: number } | null>(null);
  const distanceUnit: DistanceUnit = speedUnit === 'mph' ? 'mi' : 'km';

  const computed = useMemo(() => {
    const excludedSet = new Set(excludedLaps ?? [0]);
    const chartTimes = dashData.times ?? [];
    const chartDistances = dashData.distances ?? [];
    const rawTimes = dashData.raw_times?.length ? dashData.raw_times : chartTimes;
    const rawDistances = dashData.raw_distances?.length ? dashData.raw_distances : chartDistances;
    const series = dashData.series ?? {};
    const channelMeta = dashData.channel_meta ?? {};

    if (!rawTimes.length || !rawDistances.length || rawTimes.length !== rawDistances.length) {
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
    const throttleKey = resolveChannel('aps', channelMeta);
    if (!speedKey) {
      return { error: 'Speed channel is required for section metrics.' as const };
    }

    const brakeStorageUnit: PressureUnit = brakeKey
      ? storagePressureUnit(channelMeta[brakeKey], brakeKey)
      : 'bar';

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
        return sliceStats(
          rawTimes, rawDistances, speedKey, brakeKey, throttleKey,
          series, chartDistances, secStart, secEnd,
        );
      });
    });

    const nLaps = grid.length;
    const nSec = sectionDefs.length;
    const lapTimesSeg = dashData.lap_times ?? [];

    const bestDur: (number | null)[] = Array(nSec).fill(null);
    for (let si = 0; si < nSec; si++) {
      for (let li = 0; li < nLaps; li++) {
        const rowSeg = lapTimesSeg[li]?.segment_index ?? li;
        if (excludedSet.has(rowSeg)) continue;
        const d = grid[li][si]?.duration;
        if (d == null) continue;
        if (bestDur[si] === null || d < bestDur[si]!) {
          bestDur[si] = d;
        }
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
      for (let li = 0; li < nLaps; li++) {
        const rowSeg = lapTimesSeg[li]?.segment_index ?? li;
        if (excludedSet.has(rowSeg)) continue;
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

    /** Per section: up to three fastest laps by section time (ascending). */
    const sectionTopThree: { lap: number; duration: number }[][] = sectionDefs.map(() => []);
    for (let si = 0; si < nSec; si++) {
      const pairs: { lap: number; duration: number }[] = [];
      for (let li = 0; li < nLaps; li++) {
        const rowSeg = lapTimesSeg[li]?.segment_index ?? li;
        if (excludedSet.has(rowSeg)) continue;
        const d = grid[li][si]?.duration;
        if (d == null) continue;
        pairs.push({ lap: lapTimesSeg[li]?.lap ?? li + 1, duration: d });
      }
      pairs.sort((a, b) => a.duration - b.duration);
      sectionTopThree[si] = pairs.slice(0, 3);
    }

    let fastestLapTime: number | null = null;
    for (let li = 0; li < lapTimesSeg.length; li++) {
      const segIdx = lapTimesSeg[li]?.segment_index ?? li;
      if (excludedSet.has(segIdx)) continue;
      const t = lapTimesSeg[li]?.time;
      if (t != null && Number.isFinite(t)) {
        fastestLapTime = fastestLapTime === null ? t : Math.min(fastestLapTime, t);
      }
    }

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
      sectionTopThree,
      splits,
      fastestLapTime,
      brakeStorageUnit,
    };
  }, [dashData, sectionsProp, excludedLaps]);

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
    sectionTopThree,
    fastestLapTime,
    brakeStorageUnit,
  } = computed;

  const lapTimes = dashData.lap_times ?? [];
  const fastIdx = dashData.fast_lap_index ?? null;
  const excludedSetRender = new Set(excludedLaps ?? [0]);

  const fmtSpd = (v: number | null) =>
    v != null ? convertSpeed(v, speedUnit).toFixed(1) : '—';
  const fmtThr = (v: number | null) =>
    v != null ? String(Math.round(v)) : '—';
  const fmtBrk = (v: number | null) =>
    v != null ? convertPressure(v, brakeStorageUnit, pressureUnit).toFixed(2) : '—';

  const excludedLapLabels = useMemo(() => {
    const set = new Set(excludedLaps ?? [0]);
    if (set.size === 0) return '';
    const lt = dashData.lap_times ?? [];
    const labels: string[] = [];
    for (const seg of [...set].sort((a, b) => a - b)) {
      const entry = lt.find((l, i) => (l.segment_index ?? i) === seg);
      const lapNum = entry?.lap ?? seg + 1;
      labels.push(seg === 0 ? `Lap ${lapNum} (out-lap)` : `Lap ${lapNum}`);
    }
    return labels.join(', ');
  }, [excludedLaps, dashData.lap_times]);

  const handleDownloadPdf = useCallback(() => {
    const scrollEl = document.querySelector('.section-grid-scroll') as HTMLElement | null;
    const tableEl = scrollEl?.querySelector('.section-grid') as HTMLElement | null;

    if (scrollEl && tableEl) {
      const fullWidth = tableEl.scrollWidth;
      // A4 landscape usable width: 297mm − 24mm margins = 273mm ≈ 1032px @96dpi
      const usableWidth = 1032;
      if (fullWidth > usableWidth) {
        const ratio = Math.floor((usableWidth / fullWidth) * 1000) / 1000;
        scrollEl.style.setProperty('--print-table-zoom', String(ratio));
      }
    }

    const cleanup = () => {
      scrollEl?.style.removeProperty('--print-table-zoom');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);

    window.print();
  }, []);

  return (
    <div className="section-metrics" data-session={sessionId}>
      {sessionMeta && (
        <div className="section-metrics-print-header print-only">
          <h1 className="print-title">Section Metrics Report</h1>
          <dl className="print-meta-grid">
            {sessionMeta.track && <><dt>Track</dt><dd>{sessionMeta.track}</dd></>}
            {sessionMeta.sessionType && <><dt>Session</dt><dd>{sessionMeta.sessionType}</dd></>}
            {sessionMeta.driver && <><dt>Driver</dt><dd>{sessionMeta.driver}</dd></>}
            {sessionMeta.car && <><dt>Car</dt><dd>{sessionMeta.car}</dd></>}
            {sessionMeta.outingNumber && <><dt>Outing #</dt><dd>{sessionMeta.outingNumber}</dd></>}
            {sessionMeta.sessionNumber && <><dt>Session #</dt><dd>{sessionMeta.sessionNumber}</dd></>}
            {sessionMeta.lapCount != null && <><dt>Total Laps</dt><dd>{sessionMeta.lapCount}</dd></>}
            {sessionMeta.fastestLapTime != null && (
              <><dt>Fastest Lap</dt><dd>{formatSectionTime(sessionMeta.fastestLapTime)}</dd></>
            )}
            {sessionMeta.tireSet && <><dt>Tire Set</dt><dd>{sessionMeta.tireSet}</dd></>}
            {sessionMeta.ambientTempC != null && (
              <><dt>Ambient Temp</dt><dd>{sessionMeta.ambientTempC.toFixed(1)} °C</dd></>
            )}
            {sessionMeta.trackTempC != null && (
              <><dt>Track Temp</dt><dd>{sessionMeta.trackTempC.toFixed(1)} °C</dd></>
            )}
            {excludedLapLabels && <><dt>Excluded Laps</dt><dd>{excludedLapLabels}</dd></>}
            {sessionMeta.notes && <><dt>Notes</dt><dd>{sessionMeta.notes}</dd></>}
          </dl>
        </div>
      )}

      <div className="section-metrics-toolbar no-print">
        <button type="button" className="btn btn-secondary btn-sm" onClick={handleDownloadPdf}>
          Download PDF
        </button>
      </div>

      <div className="vbl-card-row">
        <div className="vbl-card vbl-card-actual">
          <span className="vbl-card-label">Actual Best Lap</span>
          <span className="vbl-card-time vbl-card-time-actual">
            {fastestLapTime != null ? formatSectionTime(fastestLapTime) : '—'}
          </span>
          <span className="vbl-card-hint">Fastest lap</span>
        </div>
        <div className="vbl-card">
          <span className="vbl-card-label">Virtual Best Lap</span>
          <span className="vbl-card-time">
            {virtualBestTotal != null ? formatSectionTime(virtualBestTotal) : '—'}
          </span>
          <span className="vbl-card-hint">Sum of best sector times</span>
        </div>
        {virtualBestTotal != null && fastestLapTime != null && (
          <div className="vbl-card vbl-card-delta">
            <span className="vbl-card-label">Potential Gain</span>
            <span className="vbl-card-time vbl-card-time-delta">
              {formatDelta(Math.round((virtualBestTotal - fastestLapTime) * 1000) / 1000)}
            </span>
            <span className="vbl-card-hint">Virtual − Actual</span>
          </div>
        )}
      </div>

      {improvement.length > 0 && (
        <div className="improvement-block">
          <h4 className="improvement-heading">Improvement opportunities</h4>
          <div className="improvement-tiles">
            {improvement.map((row, rank) => (
              <div key={row.index} className={`improvement-tile${rank < 3 ? ' improvement-tile-top' : ''}`}>
                <span className="improvement-tile-rank">{rank + 1}</span>
                <span className="improvement-tile-name">{row.name}</span>
                <span className="improvement-tile-delta">Avg. Δ +{row.avgDelta.toFixed(3)}s</span>
                <span className="improvement-tile-best">{formatSectionTime(row.vbDuration)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="improvement-block">
        <h4 className="improvement-heading">Fastest sections</h4>
        <p className="muted improvement-subhint">Top three section times per sector (fastest first).</p>
        <div className="improvement-tiles">
          {sectionDefs.map((s, si) => (
            <div
              key={`${s.name}-${si}`}
              className="improvement-tile section-best-tile"
              title={`${metersToDistanceDisplay(s.start_distance, distanceUnit).toFixed(3)}–${metersToDistanceDisplay(s.end_distance, distanceUnit).toFixed(3)} ${distanceUnit}`}
            >
              <span className="improvement-tile-name">{s.name}</span>
              {sectionTopThree[si].length === 0 ? (
                <span className="section-best-tile-time">—</span>
              ) : (
                <ol className="section-best-top3">
                  {sectionTopThree[si].map((row, ri) => (
                    <li key={`${si}-${row.lap}-${ri}`}>
                      <span className="section-best-tile-time">{formatSectionTime(row.duration)}</span>
                      <span className="section-best-tile-lap">Lap {row.lap}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ))}
        </div>
      </div>

      {hasExclusionDraft && onApplyExclusions && (
        <div className="lap-excl-actions">
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={onApplyExclusions}
            disabled={applyExclusionsPending}
          >
            {applyExclusionsPending ? 'Applying…' : 'Recalc metrics'}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={onDiscardExclusions}
            disabled={applyExclusionsPending}
          >
            Discard
          </button>
        </div>
      )}

      <div className="section-grid-scroll">
        <table className="section-grid">
          <thead>
            <tr>
              {onToggleExcludeLap && (
                <th className="section-grid-sticky section-excl-col" title="Exclude from analysis">
                  Excl
                </th>
              )}
              <th className="section-grid-sticky section-lap-col-header">Lap</th>
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
              const segIdx = lt?.segment_index ?? li;
              const lapLabel = lt ? String(lt.lap) : String(li + 1);
              const lapTime = lt?.time ?? null;
              const lapDelta =
                lapTime != null && fastestLapTime != null
                  ? Math.round((lapTime - fastestLapTime) * 1000) / 1000
                  : null;
              const isOut = li === 0;
              const isFast = fastIdx != null && li === fastIdx;
              const rowExcluded = excludedSetRender.has(segIdx);
              return (
                <tr
                  key={`lap-${li}`}
                  className={`section-grid-row${isOut ? ' section-row-outlap' : ''}${isFast ? ' section-row-fast' : ''}${rowExcluded ? ' section-row-excluded' : ''}${onZoomToLap ? ' section-grid-row-clickable' : ''}`}
                  onClick={() => onRowClick(li)}
                >
                  {onToggleExcludeLap && (
                    <td
                      className="section-grid-sticky section-excl-col"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={rowExcluded}
                        title="Exclude lap from virtual best / averages"
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => onToggleExcludeLap(segIdx)}
                        aria-label={`Exclude lap ${lapLabel} from analysis`}
                      />
                    </td>
                  )}
                  <th className="section-grid-sticky section-lap-col" scope="row">
                    <div className="section-lap-col-label">
                      {lapLabel}
                      {isFast && <span className="section-lap-fast">★</span>}
                    </div>
                    <div className="section-lap-col-time">
                      {lapTime != null ? formatSectionTime(lapTime) : '—'}
                    </div>
                    {lapDelta != null && (
                      <div
                        className={`section-lap-col-delta ${deltaClass(lapDelta, lapDelta < 0.0005)}`}
                      >
                        Δ {formatDelta(lapDelta)}
                      </div>
                    )}
                  </th>
                  {row.map((cell, si) => {
                    const vb = bestDur[si];
                    const dur = cell.duration;
                    const delta =
                      dur != null && vb != null
                        ? Math.round((dur - vb) * 1000) / 1000
                        : null;
                    const isBest = delta != null && delta < 0.0005;
                    const dClass = deltaClass(delta, isBest);
                    const isExpanded =
                      selectedCell?.li === li && selectedCell?.si === si;
                    return (
                      <td
                        key={`c-${li}-${si}`}
                        role="button"
                        tabIndex={0}
                        aria-expanded={isExpanded}
                        aria-label={`${sectionDefs[si].name}, Lap ${lapLabel}: ${dur != null ? formatSectionTime(dur) : 'no data'}${delta != null ? `, delta ${formatDelta(delta)}` : ''}`}
                        className={`section-grid-cell${si > 0 ? ' section-grid-sec-start' : ''}${isExpanded ? ' section-cell-expanded' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedCell(isExpanded ? null : { li, si });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelectedCell(isExpanded ? null : { li, si });
                          }
                        }}
                      >
                        <div className="section-cell-stack">
                          <div className="section-cell-time">
                            {dur != null ? formatSectionTime(dur) : '—'}
                          </div>
                          <div className={`section-cell-delta ${dClass}`}>
                            {delta != null ? `Δ ${formatDelta(delta)}` : '—'}
                          </div>
                          {isExpanded && (
                            <div className="section-cell-detail">
                              <div className="section-detail-grid">
                                <span className="section-detail-hdr" />
                                <span className="section-detail-hdr">Min</span>
                                <span className="section-detail-hdr">Max</span>
                                <span className="section-detail-hdr">Avg</span>
                                <span className="section-detail-hdr" />

                                <span className="section-detail-label">Speed</span>
                                <span>{fmtSpd(cell.minSpeed)}</span>
                                <span>{fmtSpd(cell.maxSpeed)}</span>
                                <span>{fmtSpd(cell.avgSpeed)}</span>
                                <span className="section-detail-unit">{speedUnit}</span>

                                <span className="section-detail-label">Throttle</span>
                                <span>{fmtThr(cell.minThrottle)}</span>
                                <span>{fmtThr(cell.maxThrottle)}</span>
                                <span>{fmtThr(cell.avgThrottle)}</span>
                                <span className="section-detail-unit">%</span>

                                <span className="section-detail-label">Brake</span>
                                <span>{fmtBrk(cell.minBrake)}</span>
                                <span>{fmtBrk(cell.maxBrake)}</span>
                                <span>{fmtBrk(cell.avgBrake)}</span>
                                <span className="section-detail-unit">{pressureUnit}</span>
                              </div>
                            </div>
                          )}
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
