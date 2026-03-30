import { useRef, useEffect, useMemo, useCallback } from 'react';
import { Chart as ChartJS, registerables, type ChartOptions, type ChartData, type Plugin } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import annotationPlugin from 'chartjs-plugin-annotation';
import type { AnnotationOptions } from 'chartjs-plugin-annotation';
import { useCursorZoom, useCursorStore } from '../../contexts/CursorSyncContext';
import { metersToDistanceDisplay, type DistanceUnit } from '../../utils/units';

ChartJS.register(...registerables, zoomPlugin, annotationPlugin);

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
  xRange?: { min: number; max: number } | null;
  onBoundaryDrag?: (sectionIdx: number, edge: 'start' | 'end', value: number) => void;
  yOverrides?: Record<string, { min?: number; max?: number }>;
  yScaleTitles?: Record<string, string>;
  distanceDisplayUnit?: DistanceUnit;
}

export default function TelemetryChart({
  xValues,
  xLabel = '',
  channels,
  lapSplits = [],
  sections = [],
  target = null,
  height,
  xCursorField: explicitField,
  xRange = null,
  yOverrides,
  yScaleTitles,
  distanceDisplayUnit,
}: TelemetryChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<ChartJS<'line'> | null>(null);
  const cursorXRef = useRef<number | null>(null);
  const isSyncingRef = useRef(false);

  const {
    xMin,
    xMax,
    setCursor,
    clearCursor,
    setXRange,
    resetZoom: resetSharedZoom,
  } = useCursorZoom();

  const store = useCursorStore();

  const xCursorField = useMemo(() => {
    if (explicitField) return explicitField;
    if (/distance/i.test(xLabel)) return 'distance' as const;
    return 'time' as const;
  }, [xLabel, explicitField]);

  const distanceTickFormat = useMemo(
    () =>
      xCursorField === 'distance' && distanceDisplayUnit
        ? (v: string | number) => {
            const n = typeof v === 'number' ? v : parseFloat(v);
            if (!Number.isFinite(n)) return String(v);
            return metersToDistanceDisplay(n, distanceDisplayUnit).toFixed(3);
          }
        : undefined,
    [xCursorField, distanceDisplayUnit],
  );

  const yAxisIdsOrdered = useMemo(() => {
    const order: string[] = [];
    const seen = new Set<string>();
    for (const ch of channels) {
      const id = ch.yAxisID ?? 'y';
      if (!seen.has(id)) {
        seen.add(id);
        order.push(id);
      }
    }
    return order.length > 0 ? order : ['y'];
  }, [channels]);

  const datasets = useMemo(() => {
    return channels.map((ch, i) => ({
      label: ch.label,
      data: xValues.map((x, j) => ({ x, y: ch.data[j] })),
      borderColor: ch.color || LINE_COLORS[i % LINE_COLORS.length],
      borderWidth: 1.5,
      pointRadius: 0,
      pointHitRadius: 0,
      fill: false,
      tension: 0,
      yAxisID: ch.yAxisID ?? 'y',
    }));
  }, [channels, xValues]);

  const yScales = useMemo(() => {
    const scales: Record<string, object> = {};
    yAxisIdsOrdered.forEach((id, i) => {
      const ov = yOverrides?.[id];
      const pos = i % 2 === 0 ? 'left' : 'right';
      const yTitle = yScaleTitles?.[id];
      scales[id] = {
        type: 'linear' as const,
        position: pos,
        ticks: { color: TICK_COLOR },
        title: yTitle
          ? { display: true, text: yTitle, color: TICK_COLOR, font: { size: 11 } }
          : { display: false },
        grid: {
          color: MUTED_GRID,
          drawOnChartArea: i === 0,
        },
        ...(ov?.min != null && Number.isFinite(ov.min) ? { min: ov.min } : {}),
        ...(ov?.max != null && Number.isFinite(ov.max) ? { max: ov.max } : {}),
      };
    });
    return scales;
  }, [yAxisIdsOrdered, yOverrides, yScaleTitles]);

  const annotations = useMemo((): Record<string, AnnotationOptions> => {
    const a: Record<string, AnnotationOptions> = {};
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
        label: {
          display: true,
          content: s.name,
          position: 'start' as const,
          color: '#a1a1aa',
          font: { size: 9 },
        },
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

  const crosshairPlugin = useRef<Plugin<'line'>>({
    id: 'cursorCrosshair',
    afterDraw(chart) {
      const cx = cursorXRef.current;
      if (cx == null) return;
      const xScale = chart.scales['x'];
      if (!xScale) return;
      const px = xScale.getPixelForValue(cx);
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
  }).current;

  useEffect(() => {
    return store.subscribe(() => {
      const s = store.getSnapshot();
      const cx = xCursorField === 'distance' ? s.distance : s.time;
      cursorXRef.current = cx;
      chartRef.current?.draw();
    });
  }, [store, xCursorField]);

  const onHoverRef = useRef<(event: unknown, elements: unknown[], chart: ChartJS) => void>(undefined);
  const syncRangeRef = useRef<(chart: ChartJS<'line'>) => void>(undefined);

  const syncRangeFromChart = useCallback(
    (chart: ChartJS<'line'>) => {
      if (isSyncingRef.current) return;
      const xScale = chart.scales.x;
      if (!xScale) return;
      const min = xScale.min;
      const max = xScale.max;
      if (
        typeof min !== 'number' ||
        typeof max !== 'number' ||
        !Number.isFinite(min) ||
        !Number.isFinite(max)
      ) {
        return;
      }
      setXRange(min, max);
    },
    [setXRange],
  );
  syncRangeRef.current = syncRangeFromChart;

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
  onHoverRef.current = onHover;

  const handleDoubleClick = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.resetZoom();
    resetSharedZoom();
  }, [resetSharedZoom]);

  // Apply shared zoom from context
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const targetMin = xRange?.min ?? xMin;
    const targetMax = xRange?.max ?? xMax;
    if (targetMin == null && targetMax == null) {
      isSyncingRef.current = true;
      try { chart.resetZoom('none'); } catch { /* already reset */ }
      isSyncingRef.current = false;
      return;
    }
    const xScale = chart.scales.x;
    if (!xScale) return;
    const curMin = xScale.min;
    const curMax = xScale.max;
    if (
      targetMin != null && targetMax != null &&
      Math.abs(curMin - targetMin) < 0.01 &&
      Math.abs(curMax - targetMax) < 0.01
    ) {
      return;
    }
    isSyncingRef.current = true;
    try {
      const dataMin = xValues.length > 0 ? xValues[0] : 0;
      const dataMax = xValues.length > 0 ? xValues[xValues.length - 1] : 1;
      chart.zoomScale('x', {
        min: targetMin ?? dataMin,
        max: targetMax ?? dataMax,
      }, 'none');
    } catch { /* guard against chart being in transition */ }
    isSyncingRef.current = false;
  }, [xMin, xMax, xRange, xValues]);

  const options = useMemo<ChartOptions<'line'>>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'nearest', intersect: false },
    onHover: (...args: [unknown, unknown[], ChartJS]) => onHoverRef.current?.(...args),
    scales: {
      x: {
        type: 'linear',
        title: { display: !!xLabel, text: xLabel, color: TICK_COLOR },
        ticks: {
          color: TICK_COLOR,
          maxTicksLimit: 12,
          ...(distanceTickFormat ? { callback: distanceTickFormat } : {}),
        },
        grid: { color: MUTED_GRID },
      },
      ...yScales,
    } as ChartOptions<'line'>['scales'],
    plugins: {
      legend: { display: channels.length > 1, labels: { color: TICK_COLOR, boxWidth: 12, padding: 8 } },
      tooltip: { enabled: false },
      annotation: { annotations },
      zoom: {
        pan: {
          enabled: true,
          mode: 'x',
          onPanComplete: ({ chart }) => {
            syncRangeRef.current?.(chart as ChartJS<'line'>);
          },
        },
        zoom: {
          wheel: { enabled: true },
          pinch: { enabled: true },
          mode: 'x',
          onZoom: ({ chart, trigger }) => {
            if (trigger === 'api') return;
            syncRangeRef.current?.(chart as ChartJS<'line'>);
          },
        },
      },
    },
  }), [
    xLabel,
    annotations,
    channels.length,
    yScales,
    distanceTickFormat,
  ]);

  const chartData = useMemo<ChartData<'line'>>(() => ({
    datasets,
  }), [datasets]);

  // Create chart imperatively on mount -- no react-chartjs-2
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const chart = new ChartJS<'line'>(canvas, {
      type: 'line',
      data: chartData,
      options,
      plugins: [crosshairPlugin],
    });
    chartRef.current = chart;
    return () => {
      chart.destroy();
      chartRef.current = null;
    };
  // Only create/destroy on mount/unmount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update data when it changes (channels, xValues)
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.data = chartData;
    chart.update('none');
  }, [chartData]);

  // Update options when they change (annotations, yScales, etc.)
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.options = options;
    chart.update('none');
  }, [options]);

  return (
    <div className="telemetry-chart" style={{ width: '100%', height: height ?? '100%' }}
      onMouseLeave={() => clearCursor()}
      onDoubleClick={handleDoubleClick}
    >
      <canvas ref={canvasRef} />
    </div>
  );
}
