import TelemetryChart from '../../charts/TelemetryChart';
import type { TelemetryChannel } from '../../charts/TelemetryChart';

interface ChartModuleProps {
  xValues: number[];
  xLabel: string;
  xCursorField: 'distance' | 'time';
  series: Record<string, number[]>;
  channelMeta: Record<string, { label: string; unit?: string }>;
  channelKeys: string[];
  lapSplits?: number[];
  sections?: { name: string; start_distance: number; end_distance: number }[];
  target?: number | null;
  height: number;
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
  height,
}: ChartModuleProps) {
  const channels: TelemetryChannel[] = channelKeys
    .filter((k) => series[k])
    .map((k) => ({
      label: channelMeta[k]?.label ?? k,
      data: series[k],
    }));

  const sectionOverlays = sections.map((s) => ({
    name: s.name,
    start: s.start_distance,
    end: s.end_distance,
  }));

  return (
    <TelemetryChart
      xValues={xValues}
      xLabel={xLabel}
      xCursorField={xCursorField}
      channels={channels}
      lapSplits={lapSplits}
      sections={sectionOverlays}
      target={target}
      height={height}
    />
  );
}
