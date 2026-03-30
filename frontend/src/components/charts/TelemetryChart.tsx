import { useRef, useEffect, useMemo, useCallback } from 'react';
import { Chart as ChartJS, registerables, type ChartOptions, type Plugin } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { Line } from 'react-chartjs-2';
import { useCursorSync } from '../../contexts/CursorSyncContext';

ChartJS.register(...registerables, zoomPlugin);

const MUTED_GRID = 'rgba(113,113,122,0.25)';
const TICK_COLOR = '#a1a1aa';
const CROSSHAIR_COLOR = 'rgba(250,204,21,0.8)';

const LINE_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#a855f7',
  '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1',
  '#14b8a6', '#e879f9', '#eab308', '#0ea5e9', '#f43f5e',
];

export interface TelemetryChannel {
  label: string;
  data: number[];
  color?: string;
  yAxisID?: string;
}

export interface TelemetryChartProps {
  xValues: number[];
  xLabel?: string;
  channels: TelemetryChannel[];
  lapSplits?: number[];
  sections?: { name: string; start: number; end: number; color?: string }[];
  target?: number | null;
  height?: number;
  xCursorField?: 'distance' | 'time';
  onBoundaryDrag?: (sectionIdx: number, edge: 'start' | 'end', value: number) => void;
}

export default function TelemetryChart({
  xValues,
  xLabel = '',
  channels,
  lapSplits = [],
  sections = [],
  target = null,
  height = 200,
  xCursorField: explicitField,
}: TelemetryChartProps) {
  const chartRef = useRef<ChartJS<'line'> | null>(null);
  const { distance, time, setCursor, clearCursor } = useCursorSync();

  const xCursorField = useMemo(() => {
    if (explicitField) return explicitField;
    if (/distance/i.test(xLabel)) return 'distance' as const;
    return 'time' as const;
  }, [xLabel, explicitField]);

  const cursorX = xCursorField === 'distance' ? distance : time;

  const datasets = useMemo(() => {
    return channels.map((ch, i) => ({
      label: ch.label,
      data: ch.data,
      borderColor: ch.color || LINE_COLORS[i % LINE_COLORS.length],
      borderWidth: 1.5,
      pointRadius: 0,
      pointHitRadius: 0,
      fill: false,
      tension: 0,
      yAxisID: ch.yAxisID ?? 'y',
    }));
  }, [channels]);

  const annotations = useMemo(() => {
    const a: Record<string, unknown> = {};
    lapSplits.forEach((v, i) => {
      a[`lap${i}`] = {
        type: 'line',
        xMin: v,
        xMax: v,
        borderColor: 'rgba(250,204,21,0.35)',
        borderWidth: 1,
        borderDash: [4, 3],
      };
    });
    sections.forEach((s, i) => {
      a[`sec${i}`] = {
        type: 'box',
        xMin: s.start,
        xMax: s.end,
        backgroundColor: s.color || `hsla(${(i * 47) % 360},60%,50%,0.08)`,
        borderWidth: 0,
        label: { display: true, content: s.name, position: 'start', color: '#a1a1aa', font: { size: 9 } },
      };
    });
    if (target != null) {
      a['target'] = {
        type: 'line',
        yMin: target,
        yMax: target,
        borderColor: 'rgba(239,68,68,0.5)',
        borderWidth: 1,
        borderDash: [6, 3],
      };
    }
    return a;
  }, [lapSplits, sections, target]);

  const crosshairPlugin = useMemo<Plugin<'line'>>(() => ({
    id: 'cursorCrosshair',
    afterDraw(chart) {
      if (cursorX == null) return;
      const xScale = chart.scales['x'];
      if (!xScale) return;
      const px = xScale.getPixelForValue(cursorX);
      if (px < xScale.left || px > xScale.right) return;
      const ctx = chart.ctx;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(px, chart.chartArea.top);
      ctx.lineTo(px, chart.chartArea.bottom);
      ctx.strokeStyle = CROSSHAIR_COLOR;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    },
  }), [cursorX]);

  useEffect(() => {
    chartRef.current?.update('none');
  }, [cursorX]);

  const onHover = useCallback((_event: unknown, _elements: unknown[], chart: ChartJS) => {
    const area = chart.chartArea;
    const xScale = chart.scales['x'];
    if (!xScale || !area) return;
    const evt = (_event as { native?: MouseEvent }).native;
    if (!evt) return;
    const rect = chart.canvas.getBoundingClientRect();
    const mx = evt.clientX - rect.left;
    if (mx < area.left || mx > area.right) {
      clearCursor();
      return;
    }
    const val = xScale.getValueForPixel(mx);
    if (val == null) return;
    setCursor({ [xCursorField]: val });
  }, [setCursor, clearCursor, xCursorField]);

  const options = useMemo<ChartOptions<'line'>>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    onHover,
    scales: {
      x: {
        type: 'linear',
        title: { display: !!xLabel, text: xLabel, color: TICK_COLOR },
        ticks: { color: TICK_COLOR, maxTicksLimit: 12 },
        grid: { color: MUTED_GRID },
      },
      y: {
        ticks: { color: TICK_COLOR },
        grid: { color: MUTED_GRID },
      },
    },
    plugins: {
      legend: { display: channels.length > 1, labels: { color: TICK_COLOR, boxWidth: 12, padding: 8 } },
      tooltip: { enabled: true },
      annotation: { annotations },
      zoom: {
        pan: { enabled: true, mode: 'x' },
        zoom: {
          wheel: { enabled: true },
          pinch: { enabled: true },
          mode: 'x',
        },
      },
    },
  }), [xLabel, annotations, onHover, channels.length]);

  const chartData = useMemo(() => ({
    labels: xValues,
    datasets,
  }), [xValues, datasets]);

  return (
    <div className="telemetry-chart" style={{ height }}
      onMouseLeave={() => clearCursor()}
    >
      <Line
        ref={chartRef}
        data={chartData}
        options={options}
        plugins={[crosshairPlugin]}
      />
    </div>
  );
}
