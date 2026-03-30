import TelemetryChart from './TelemetryChart';
import type { TelemetryChannel } from './TelemetryChart';
import {
  convertPressure,
  mapNumericArray,
  pressureLabel,
  type DistanceUnit,
  type PressureUnit,
} from '../../utils/units';

interface TirePressureChartProps {
  xValues: number[];
  xLabel?: string;
  pressureFL: number[];
  pressureFR: number[];
  pressureRL: number[];
  pressureRR: number[];
  /** Session target, always in PSI from the API. */
  target?: number | null;
  height?: number;
  xCursorField?: 'distance' | 'time';
  /** Unit of the pressure arrays (telemetry storage). */
  seriesPressureUnit?: PressureUnit;
  /** Unit to plot and annotate. */
  displayPressureUnit?: PressureUnit;
  distanceDisplayUnit?: DistanceUnit;
}

const TIRE_COLORS = {
  fl: '#3b82f6',
  fr: '#ef4444',
  rl: '#22c55e',
  rr: '#f59e0b',
};

export default function TirePressureChart({
  xValues,
  xLabel,
  pressureFL,
  pressureFR,
  pressureRL,
  pressureRR,
  target,
  height = 200,
  xCursorField,
  seriesPressureUnit = 'bar',
  displayPressureUnit = 'psi',
  distanceDisplayUnit = 'km',
}: TirePressureChartProps) {
  const toDisp = (arr: number[]) =>
    mapNumericArray(arr, (v) => convertPressure(v, seriesPressureUnit, displayPressureUnit));
  const channels: TelemetryChannel[] = [
    { label: 'FL', data: toDisp(pressureFL), color: TIRE_COLORS.fl },
    { label: 'FR', data: toDisp(pressureFR), color: TIRE_COLORS.fr },
    { label: 'RL', data: toDisp(pressureRL), color: TIRE_COLORS.rl },
    { label: 'RR', data: toDisp(pressureRR), color: TIRE_COLORS.rr },
  ];
  const targetDisplay =
    target != null && Number.isFinite(target)
      ? convertPressure(target, 'psi', displayPressureUnit)
      : null;

  return (
    <TelemetryChart
      xValues={xValues}
      xLabel={xLabel}
      channels={channels}
      target={targetDisplay}
      height={height}
      xCursorField={xCursorField}
      yScaleTitles={{ y: pressureLabel(displayPressureUnit) }}
      distanceDisplayUnit={xCursorField === 'distance' ? distanceDisplayUnit : undefined}
    />
  );
}
