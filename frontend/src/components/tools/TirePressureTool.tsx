import TirePressureChart from '../charts/TirePressureChart';

interface TirePressureToolProps {
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

export default function TirePressureTool(props: TirePressureToolProps) {
  return <TirePressureChart {...props} />;
}
