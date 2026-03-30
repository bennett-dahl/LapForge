import TelemetryChart from './TelemetryChart';
import type { TelemetryChannel } from './TelemetryChart';

interface TirePressureChartProps {
  xValues: number[];
  xLabel?: string;
  pressureFL: number[];
  pressureFR: number[];
  pressureRL: number[];
  pressureRR: number[];
  target?: number | null;
  height?: number;
  xCursorField?: 'distance' | 'time';
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
}: TirePressureChartProps) {
  const channels: TelemetryChannel[] = [
    { label: 'FL', data: pressureFL, color: TIRE_COLORS.fl },
    { label: 'FR', data: pressureFR, color: TIRE_COLORS.fr },
    { label: 'RL', data: pressureRL, color: TIRE_COLORS.rl },
    { label: 'RR', data: pressureRR, color: TIRE_COLORS.rr },
  ];

  return (
    <TelemetryChart
      xValues={xValues}
      xLabel={xLabel}
      channels={channels}
      target={target}
      height={height}
      xCursorField={xCursorField}
    />
  );
}
