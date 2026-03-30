import { useMemo } from 'react';
import { useCursorSync } from '../../../contexts/CursorSyncContext';

interface ReadoutModuleProps {
  xValues: number[];
  series: Record<string, number[]>;
  channelMeta: Record<string, { label: string; unit?: string }>;
  xCursorField: 'distance' | 'time';
}

function findNearestIndex(values: number[], target: number): number {
  let lo = 0;
  let hi = values.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(values[lo - 1] - target) < Math.abs(values[lo] - target)) {
    return lo - 1;
  }
  return lo;
}

export default function ReadoutModule({ xValues, series, channelMeta, xCursorField }: ReadoutModuleProps) {
  const { distance, time } = useCursorSync();
  const cursorVal = xCursorField === 'distance' ? distance : time;

  const idx = useMemo(() => {
    if (cursorVal == null || !xValues.length) return null;
    return findNearestIndex(xValues, cursorVal);
  }, [cursorVal, xValues]);

  const channelKeys = useMemo(() => Object.keys(series), [series]);

  if (idx == null) {
    return <p className="text-muted readout-hint">Hover a chart to see values.</p>;
  }

  return (
    <div className="readout-grid">
      {channelKeys.map((key) => {
        const val = series[key]?.[idx];
        const meta = channelMeta[key];
        return (
          <div key={key} className="readout-item">
            <span className="readout-label">{meta?.label ?? key}</span>
            <span className="readout-value">
              {val != null ? val.toFixed(2) : '—'}
              {meta?.unit && <span className="readout-unit"> {meta.unit}</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}
