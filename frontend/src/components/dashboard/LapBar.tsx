import { useCallback, useMemo, useRef, useState } from 'react';

const PALETTE = [
  '#3b82f6',
  '#ef4444',
  '#22c55e',
  '#f59e0b',
  '#a855f7',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
  '#f97316',
  '#6366f1',
];

export interface LapBarLapTime {
  lap: number;
  time: number;
  fast?: boolean;
}

export interface LapBarProps {
  lapTimes: LapBarLapTime[];
  /** Lap boundary values on the current X axis (distance or time). */
  lapSplitDistances: number[];
  /** Alias when X axis is time; if set and `lapSplitDistances` is empty, these splits are used. */
  lapSplits?: number[];
  hasDistance: boolean;
  onZoomRange: (min: number, max: number) => void;
  onResetZoom: () => void;
}

function fmtLapTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(3);
  return m > 0 ? `${m}:${sec.padStart(6, '0')}` : `${sec}s`;
}

function getRangeForLapIndices(
  splits: number[],
  lapTimes: LapBarLapTime[],
  loIdx: number,
  hiIdx: number,
): { min: number; max: number } | null {
  const lo = Math.min(loIdx, hiIdx);
  const hi = Math.max(loIdx, hiIdx);
  const lapLo = lapTimes[lo]?.lap;
  const lapHi = lapTimes[hi]?.lap;
  if (lapLo == null || lapHi == null) return null;
  const startI = lapLo - 1;
  const endI = lapHi;
  if (startI < 0 || endI >= splits.length) return null;
  return { min: splits[startI], max: splits[endI] };
}

/** Zoom range [min,max] on the session X axis for a single logical lap number. */
export function zoomRangeForLapNumber(
  splits: number[],
  lapTimes: LapBarLapTime[],
  lapNumber: number,
): { min: number; max: number } | null {
  const idx = lapTimes.findIndex((lt) => lt.lap === lapNumber);
  if (idx < 0) return null;
  return getRangeForLapIndices(splits, lapTimes, idx, idx);
}

export default function LapBar({
  lapTimes,
  lapSplitDistances,
  lapSplits = [],
  hasDistance,
  onZoomRange,
  onResetZoom,
}: LapBarProps) {
  const splits =
    lapSplitDistances.length > 0 ? lapSplitDistances : lapSplits;
  const anchorRef = useRef<number | null>(null);
  const [rangeIdx, setRangeIdx] = useState<{ lo: number; hi: number } | null>(null);

  const fastIndex = useMemo(() => {
    const flagged = lapTimes.findIndex((lt) => lt.fast);
    if (flagged >= 0) return flagged;
    if (!lapTimes.length) return -1;
    let best = 0;
    for (let i = 1; i < lapTimes.length; i++) {
      if (lapTimes[i].time < lapTimes[best].time) best = i;
    }
    return best;
  }, [lapTimes]);

  const totalTime = useMemo(
    () => lapTimes.reduce((acc, lt) => acc + Math.max(lt.time, 1e-6), 0),
    [lapTimes],
  );

  const applyRange = useCallback(
    (loIdx: number, hiIdx: number) => {
      const r = getRangeForLapIndices(splits, lapTimes, loIdx, hiIdx);
      if (!r || r.min >= r.max) return;
      setRangeIdx({ lo: Math.min(loIdx, hiIdx), hi: Math.max(loIdx, hiIdx) });
      onZoomRange(r.min, r.max);
    },
    [lapTimes, onZoomRange, splits],
  );

  const onAllClick = useCallback(() => {
    anchorRef.current = null;
    setRangeIdx(null);
    onResetZoom();
  }, [onResetZoom]);

  const onLapClick = useCallback(
    (index: number, e: React.MouseEvent) => {
      if (e.shiftKey && anchorRef.current != null) {
        applyRange(anchorRef.current, index);
        return;
      }
      anchorRef.current = index;
      applyRange(index, index);
    },
    [applyRange],
  );

  if (!lapTimes.length || splits.length < 2) return null;

  return (
    <div
      className="lap-bar"
      data-x-axis={hasDistance ? 'distance' : 'time'}
    >
      <button
        type="button"
        className={`lap-tab lap-all${rangeIdx == null ? ' active' : ''}`}
        onClick={onAllClick}
      >
        All
      </button>
      {lapTimes.map((lt, i) => {
        const flexGrow = Math.max(lt.time, 1e-6) / totalTime;
        const isActive =
          rangeIdx != null && i >= rangeIdx.lo && i <= rangeIdx.hi;
        return (
          <button
            key={lt.lap}
            type="button"
            className={`lap-tab${isActive ? ' active' : ''}${
              i === fastIndex ? ' fastest' : ''
            }`}
            style={{
              flex: `${flexGrow} 1 0`,
              minWidth: 32,
              backgroundColor: PALETTE[i % PALETTE.length],
            }}
            title={`Lap ${lt.lap} — ${fmtLapTime(lt.time)}`}
            onClick={(e) => onLapClick(i, e)}
          >
            L{lt.lap}
          </button>
        );
      })}
    </div>
  );
}
