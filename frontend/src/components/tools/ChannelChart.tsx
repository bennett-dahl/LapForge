import TelemetryChart from '../charts/TelemetryChart';
import type { TelemetryChannel } from '../charts/TelemetryChart';

interface ChannelChartProps {
  xValues: number[];
  xLabel: string;
  channels: TelemetryChannel[];
  lapSplits?: number[];
  sections?: { name: string; start: number; end: number; color?: string }[];
  target?: number | null;
  height?: number;
  xCursorField?: 'distance' | 'time';
}

export default function ChannelChart(props: ChannelChartProps) {
  return <TelemetryChart {...props} />;
}
