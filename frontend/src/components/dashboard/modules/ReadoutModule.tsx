import { useMemo } from 'react';
import { useCursorSync } from '../../../contexts/CursorSyncContext';
import {
  convertPressure,
  convertTemp,
  isCelsiusTelemetryChannel,
  isPressureTelemetryChannel,
  pressureLabel,
  storagePressureUnit,
  tempLabel,
  type PressureUnit,
  type TempUnit,
} from '../../../utils/units';

/** Per-session slice for comparison dashboards (matches `DashboardData` session entries). */
export interface ReadoutSessionSlice {
  series: Record<string, number[]>;
  channel_meta: Record<string, { label: string; unit?: string; category?: string }>;
  times: number[];
  distances: number[];
  has_distance: boolean;
}

interface ReadoutModuleProps {
  xValues: number[];
  series: Record<string, number[]>;
  channelMeta: Record<string, { label: string; unit?: string; category?: string }>;
  xCursorField: 'distance' | 'time';
  pressureUnit?: PressureUnit;
  tempUnit?: TempUnit;
  lapSplits?: number[];
  lapSplitDistances?: number[];
  visibleChannels?: string[];
  sessions?: ReadoutSessionSlice[];
}

function interpolateSeriesAt(
  xValues: number[],
  series: number[],
  xTarget: number,
): number | null {
  const n = Math.min(xValues.length, series.length);
  if (n === 0) return null;
  if (n === 1) return series[0] ?? null;
  if (xTarget <= xValues[0]) return series[0] ?? null;
  if (xTarget >= xValues[n - 1]) return series[n - 1] ?? null;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (xValues[mid] <= xTarget) lo = mid;
    else hi = mid;
  }
  const i = lo;
  const x0 = xValues[i];
  const x1 = xValues[i + 1];
  const y0 = series[i];
  const y1 = series[i + 1];
  if (!Number.isFinite(y0) || !Number.isFinite(y1)) return null;
  const t = x1 > x0 ? (xTarget - x0) / (x1 - x0) : 0;
  return y0 + t * (y1 - y0);
}

function resolveLapNumber(x: number, splits: number[]): number | null {
  if (splits.length < 2) return null;
  for (let k = 1; k < splits.length; k++) {
    const lo = splits[k - 1];
    const hi = splits[k];
    const atLast = k === splits.length - 1;
    if (x >= lo && (atLast ? x <= hi : x < hi)) return k;
  }
  if (x < splits[0]) return 1;
  if (x >= splits[splits.length - 1]) return splits.length - 1;
  return null;
}

function buildHeaderLine(
  xCursorField: 'distance' | 'time',
  cursorVal: number,
  lapSplits: number[] | undefined,
  lapSplitDistances: number[] | undefined,
): string {
  const splits =
    lapSplitDistances != null && lapSplitDistances.length > 0
      ? lapSplitDistances
      : lapSplits ?? [];
  const lap = splits.length >= 2 ? resolveLapNumber(cursorVal, splits) : null;
  if (xCursorField === 'distance') {
    const distStr = `${cursorVal.toFixed(1)} m`;
    return lap != null ? `Lap ${lap} / ${distStr}` : distStr;
  }
  const timeStr = `${cursorVal.toFixed(3)} s`;
  return lap != null ? `Lap ${lap} / ${timeStr}` : timeStr;
}

function keysForReadout(
  series: Record<string, number[]>,
  visibleChannels: string[] | undefined,
  sessionIndex: number,
  sessionCount: number,
): string[] {
  const all = Object.keys(series);
  if (!visibleChannels?.length) return all;
  if (sessionCount <= 1) {
    return visibleChannels.filter((k) => series[k] != null);
  }
  const prefix = `S${sessionIndex + 1} `;
  const stripped: string[] = [];
  for (const k of visibleChannels) {
    if (!k.startsWith(prefix)) continue;
    const base = k.slice(prefix.length);
    if (base && series[base] != null) stripped.push(base);
  }
  return stripped;
}

interface ReadoutRowsProps {
  xValues: number[];
  series: Record<string, number[]>;
  channelMeta: Record<string, { label: string; unit?: string; category?: string }>;
  channelKeys: string[];
  cursorVal: number;
  pressureUnit: PressureUnit;
  tempUnit: TempUnit;
}

function ReadoutRows({
  xValues,
  series,
  channelMeta,
  channelKeys,
  cursorVal,
  pressureUnit,
  tempUnit,
}: ReadoutRowsProps) {
  return (
    <>
      {channelKeys.map((key) => {
        const arr = series[key];
        const raw =
          arr != null ? interpolateSeriesAt(xValues, arr, cursorVal) : null;
        const meta = channelMeta[key];
        let displayVal = raw;
        let unitStr: string | undefined = meta?.unit;
        if (raw != null && Number.isFinite(raw)) {
          if (isPressureTelemetryChannel(meta, key)) {
            const from = storagePressureUnit(meta, key);
            displayVal = convertPressure(raw, from, pressureUnit);
            unitStr = pressureLabel(pressureUnit);
          } else if (isCelsiusTelemetryChannel(meta, key)) {
            displayVal = tempUnit === 'f' ? convertTemp(raw, 'c', 'f') : raw;
            unitStr = tempLabel(tempUnit);
          }
        }
        return (
          <div key={key} className="cr-row">
            <span className="cr-label">{meta?.label ?? key}</span>
            <span className="cr-val">
              {displayVal != null && Number.isFinite(displayVal) ? displayVal.toFixed(2) : '—'}
              {unitStr != null && unitStr !== '' && <span> {unitStr}</span>}
            </span>
          </div>
        );
      })}
    </>
  );
}

export default function ReadoutModule({
  xValues,
  series,
  channelMeta,
  xCursorField,
  pressureUnit = 'psi',
  tempUnit = 'c',
  lapSplits,
  lapSplitDistances,
  visibleChannels,
  sessions,
}: ReadoutModuleProps) {
  const { distance, time } = useCursorSync();
  const cursorVal = xCursorField === 'distance' ? distance : time;

  const headerLine = useMemo(() => {
    if (cursorVal == null) return null;
    return buildHeaderLine(xCursorField, cursorVal, lapSplits, lapSplitDistances);
  }, [cursorVal, xCursorField, lapSplits, lapSplitDistances]);

  const singleChannelKeys = useMemo(() => {
    const all = Object.keys(series);
    if (!visibleChannels?.length) return all;
    return visibleChannels.filter((k) => series[k] != null);
  }, [series, visibleChannels]);

  if (cursorVal == null) {
    return <p className="muted">Hover a chart to see values.</p>;
  }

  if (sessions != null && sessions.length > 0) {
    return (
      <div className="cursor-readout">
        {headerLine != null && <div className="cr-header">{headerLine}</div>}
        {sessions.map((sess, si) => {
          const sx = sess.has_distance ? sess.distances : sess.times;
          const keys = keysForReadout(
            sess.series,
            visibleChannels,
            si,
            sessions.length,
          );
          if (keys.length === 0) {
            return (
              <div key={si} className="readout-session-block">
                <div className="readout-session-title">Session {si + 1}</div>
                <p className="muted">No channels in view.</p>
              </div>
            );
          }
          return (
            <div key={si} className="readout-session-block">
              <div className="readout-session-title">Session {si + 1}</div>
              <ReadoutRows
                xValues={sx}
                series={sess.series}
                channelMeta={sess.channel_meta}
                channelKeys={keys}
                cursorVal={cursorVal}
                pressureUnit={pressureUnit}
                tempUnit={tempUnit}
              />
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="cursor-readout">
      {headerLine != null && <div className="cr-header">{headerLine}</div>}
      <ReadoutRows
        xValues={xValues}
        series={series}
        channelMeta={channelMeta}
        channelKeys={singleChannelKeys}
        cursorVal={cursorVal}
        pressureUnit={pressureUnit}
        tempUnit={tempUnit}
      />
    </div>
  );
}
