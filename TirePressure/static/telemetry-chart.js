/**
 * Reusable Chart.js line chart: channels, lap splits, sections, target, CursorSync crosshair.
 * Supports zoom/pan via chartjs-plugin-zoom (optional — degrades gracefully if not loaded).
 * Requires Chart.js and window.CursorSync (load cursor-sync.js first).
 */
(function () {
  var CHART_SEQ = 0;
  var MUTED_GRID = 'rgba(113, 113, 122, 0.25)';
  var TICK_COLOR = '#a1a1aa';
  var TITLE_COLOR = '#e4e4e7';

  function inferXCursorField(xLabel, explicit) {
    if (explicit === 'distance' || explicit === 'time') return explicit;
    if (xLabel && /distance/i.test(xLabel)) return 'distance';
    if (xLabel && /time/i.test(xLabel)) return 'time';
    return 'time';
  }

  function xFromCursorState(state, field) {
    if (!state) return null;
    if (field === 'distance') {
      var d = state.distance;
      return d != null && isFinite(d) ? d : null;
    }
    var t = state.time;
    return t != null && isFinite(t) ? t : null;
  }

  function createTelemetryChart(canvas, config) {
    if (!canvas || typeof Chart === 'undefined') {
      throw new Error('createTelemetryChart: canvas and Chart.js required');
    }
    if (!window.CursorSync) {
      throw new Error('createTelemetryChart: window.CursorSync required');
    }

    var cfg = config || {};
    var channels = cfg.channels || [];
    var xValues = cfg.xValues || [];
    var xLabel = cfg.xLabel || '';
    var lapSplits = cfg.lapSplits || [];
    var lapSplitDistances = cfg.lapSplitDistances || lapSplits;
    var sections = cfg.sections || [];
    var target = cfg.target;
    var onHover = typeof cfg.onHover === 'function' ? cfg.onHover : null;
    var onZoom = typeof cfg.onZoom === 'function' ? cfg.onZoom : null;
    var xCursorField = inferXCursorField(xLabel, cfg.xCursorField);
    var lapRelativeX = !!cfg.lapRelativeX;

    var xMin = xValues.length ? xValues[0] : 0;
    var xMax = xValues.length ? xValues[xValues.length - 1] : 0;

    function toLapRelative(val) {
      if (!lapRelativeX || !lapSplitDistances.length) return val;
      var lapStart = xMin;
      for (var i = 0; i < lapSplitDistances.length; i++) {
        if (val < lapSplitDistances[i]) break;
        lapStart = lapSplitDistances[i];
      }
      return val - lapStart;
    }

    var yGroups = cfg.yGroups || null;
    var yScales = cfg.yScales || {};
    var yAxisIds = [];

    function resolveYAxisId(ch, idx) {
      if (!yGroups) return 'y';
      var g = yGroups[ch.name];
      if (g == null) g = 0;
      return 'y_g' + g;
    }

    var datasets = channels.map(function (ch, idx) {
      var yId = resolveYAxisId(ch, idx);
      yAxisIds.push(yId);
      return {
        label: ch.label != null ? ch.label : ch.name || 'Series',
        data: xValues.map(function (x, i) {
          return { x: x, y: ch.values[i] };
        }),
        borderColor: ch.color || '#888',
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        fill: false,
        tension: 0.1,
        pointRadius: 0,
        yAxisID: yId,
      };
    });

    if (target && target.value != null && isFinite(target.value)) {
      datasets.push({
        label: target.label != null ? target.label : 'Target ' + target.value,
        data: [
          { x: xMin, y: target.value },
          { x: xMax, y: target.value },
        ],
        borderColor: target.color || '#94a3b8',
        borderDash: [5, 5],
        borderWidth: 1,
        fill: false,
        pointRadius: 0,
        yAxisID: yAxisIds.length ? yAxisIds[0] : 'y',
      });
    }

    var pid = 'telemetry_' + ++CHART_SEQ;
    var crosshairX = null;

    function readCrosshairFromSync() {
      crosshairX = xFromCursorState(window.CursorSync.get(), xCursorField);
    }
    readCrosshairFromSync();

    var syncHandler = function () {
      readCrosshairFromSync();
      chart.update('none');
    };
    window.CursorSync.subscribe(syncHandler);

    var plugins = [
      {
        id: pid + '_sections',
        beforeDatasetsDraw: function (ch) {
          if (!sections.length) return;
          var ctx = ch.ctx;
          var xa = ch.chartArea;
          var xScale = ch.scales.x;
          ctx.save();
          sections.forEach(function (sec) {
            var x1 = xScale.getPixelForValue(sec.start);
            var x2 = xScale.getPixelForValue(sec.end);
            var left = Math.min(x1, x2);
            var w = Math.abs(x2 - x1);
            if (left + w < xa.left || left > xa.right) return;
            var clipL = Math.max(left, xa.left);
            var clipR = Math.min(left + w, xa.right);
            ctx.fillStyle = sec.color || 'rgba(59, 130, 246, 0.12)';
            ctx.fillRect(clipL, xa.top, clipR - clipL, xa.bottom - xa.top);
          });
          ctx.restore();
        },
      },
      {
        id: pid + '_lapLines',
        afterDraw: function (ch) {
          if (!lapSplits.length) return;
          var ctx = ch.ctx;
          var xScale = ch.scales.x;
          var top = ch.chartArea.top;
          var bottom = ch.chartArea.bottom;
          ctx.save();
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.6)';
          ctx.setLineDash([4, 4]);
          lapSplits.forEach(function (xv, li) {
            var x = xScale.getPixelForValue(xv);
            if (x < ch.chartArea.left || x > ch.chartArea.right) return;
            ctx.beginPath();
            ctx.moveTo(x, top);
            ctx.lineTo(x, bottom);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.font = '10px sans-serif';
            ctx.fillStyle = 'rgba(148, 163, 184, 0.85)';
            ctx.textAlign = 'center';
            ctx.fillText('L' + (li + 2), x, top - 3);
            ctx.setLineDash([4, 4]);
          });
          ctx.restore();
        },
      },
      {
        id: pid + '_crosshair',
        afterDraw: function (ch) {
          if (crosshairX == null || !isFinite(crosshairX)) return;
          var xScale = ch.scales.x;
          var x = xScale.getPixelForValue(crosshairX);
          if (x < ch.chartArea.left || x > ch.chartArea.right) return;
          var ctx = ch.ctx;
          var top = ch.chartArea.top;
          var bottom = ch.chartArea.bottom;
          ctx.save();
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 2]);
          ctx.beginPath();
          ctx.moveTo(x, top);
          ctx.lineTo(x, bottom);
          ctx.stroke();
          ctx.restore();
        },
      },
    ];

    /* ---- Build scales ---- */
    var xTicks = { color: TICK_COLOR, maxTicksLimit: 12 };
    if (lapRelativeX && lapSplitDistances.length) {
      xTicks.callback = function (value) {
        var rel = toLapRelative(value);
        return Math.round(rel);
      };
    }

    var scales = {
      x: {
        type: 'linear',
        title: { display: false },
        min: xMin,
        max: xMax,
        ticks: xTicks,
        grid: { color: MUTED_GRID },
      },
    };

    var uniqueAxes = [];
    yAxisIds.forEach(function (id) {
      if (uniqueAxes.indexOf(id) === -1) uniqueAxes.push(id);
    });
    var hasMultipleAxes = yGroups && uniqueAxes.length > 1;

    if (hasMultipleAxes) {
      var GROUP_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b'];
      uniqueAxes.forEach(function (axisId, ai) {
        var isFirst = ai === 0;
        var side = ai % 2 === 0 ? 'left' : 'right';
        var groupChannels = [];
        channels.forEach(function (ch, ci) { if (yAxisIds[ci] === axisId) groupChannels.push(ch); });
        var axisColor = groupChannels.length === 1
          ? (groupChannels[0].color || GROUP_COLORS[ai % GROUP_COLORS.length])
          : GROUP_COLORS[ai % GROUP_COLORS.length];
        var unitLabel = groupChannels.map(function (c) { return c.unit || ''; })
          .filter(function (u, i, a) { return u && a.indexOf(u) === i; }).join('/');
        var groupScaleIdx = axisId.replace('y_g', '');
        var gs = yScales[groupScaleIdx] || {};
        var axisOpts = {
          type: 'linear',
          position: side,
          display: true,
          ticks: {
            color: axisColor,
            font: { size: 10 },
            maxTicksLimit: 6,
          },
          grid: {
            drawOnChartArea: isFirst,
            color: isFirst ? MUTED_GRID : 'transparent',
          },
          title: {
            display: !!unitLabel,
            text: unitLabel,
            color: axisColor,
            font: { size: 10 },
          },
        };
        if (gs.min != null && isFinite(gs.min)) axisOpts.min = gs.min;
        if (gs.max != null && isFinite(gs.max)) axisOpts.max = gs.max;
        scales[axisId] = axisOpts;
      });
    } else {
      var singleId = uniqueAxes.length === 1 ? uniqueAxes[0] : 'y';
      if (singleId !== 'y') {
        datasets.forEach(function (ds) { ds.yAxisID = 'y'; });
        yAxisIds = yAxisIds.map(function () { return 'y'; });
      }
      var sharedScale = yScales['0'] || {};
      var yScale = {
        type: 'linear',
        ticks: { color: TICK_COLOR },
        grid: { color: MUTED_GRID },
      };
      if (sharedScale.min != null && isFinite(sharedScale.min)) yScale.min = sharedScale.min;
      else if (cfg.yMin != null && isFinite(cfg.yMin)) yScale.min = cfg.yMin;
      if (sharedScale.max != null && isFinite(sharedScale.max)) yScale.max = sharedScale.max;
      else if (cfg.yMax != null && isFinite(cfg.yMax)) yScale.max = cfg.yMax;
      scales.y = yScale;
    }

    var hasZoomPlugin = typeof Chart.registry !== 'undefined' &&
      Chart.registry.plugins.get('zoom');

    var zoomOpts = {};
    if (hasZoomPlugin) {
      zoomOpts = {
        pan: {
          enabled: true,
          mode: 'x',
          onPanComplete: function () { fireZoom(); },
        },
        zoom: {
          wheel: { enabled: true, modifierKey: null, speed: 0.08 },
          pinch: { enabled: true },
          mode: 'x',
          onZoomComplete: function () { fireZoom(); },
        },
        limits: {
          x: { min: xMin, max: xMax, minRange: (xMax - xMin) * 0.01 },
        },
      };
    }

    var chart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: { datasets: datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        layout: { padding: { top: lapSplits.length ? 14 : 0 } },
        interaction: { mode: 'nearest', intersect: false },
        scales: scales,
        plugins: {
          legend: {
            display: false,
          },
          zoom: zoomOpts,
        },
      },
      plugins: plugins,
    });

    var _suppressZoomEvent = false;

    function fireZoom() {
      if (_suppressZoomEvent || !onZoom) return;
      var scale = chart.scales.x;
      onZoom({ min: scale.min, max: scale.max });
    }

    function onMouseMove(e) {
      var rect = canvas.getBoundingClientRect();
      var px = e.clientX - rect.left;
      var xVal = chart.scales.x.getValueForPixel(px);
      var curMin = chart.scales.x.min;
      var curMax = chart.scales.x.max;
      if (xVal == null || !isFinite(xVal) || xVal < curMin || xVal > curMax) return;
      if (onHover) onHover(xVal);
    }

    function onMouseLeave() {
      window.CursorSync.clear();
    }

    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseleave', onMouseLeave);

    canvas.addEventListener('dblclick', function () {
      setXRange(xMin, xMax);
      if (onZoom) onZoom({ min: xMin, max: xMax });
    });

    function setXRange(newMin, newMax) {
      _suppressZoomEvent = true;
      if (hasZoomPlugin && chart.resetZoom) {
        chart.resetZoom('none');
      }
      chart.options.scales.x.min = newMin;
      chart.options.scales.x.max = newMax;
      chart.update('none');
      _suppressZoomEvent = false;
    }

    var origDestroy = chart.destroy.bind(chart);
    chart.destroy = function () {
      window.CursorSync.unsubscribe(syncHandler);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseleave', onMouseLeave);
      origDestroy();
    };

    chart.telemetry = {
      xMin: xMin,
      xMax: xMax,
      setXRange: setXRange,
      getXRange: function () { return { min: chart.scales.x.min, max: chart.scales.x.max }; },
      toLapRelative: toLapRelative,
    };

    return chart;
  }

  window.createTelemetryChart = createTelemetryChart;
})();
