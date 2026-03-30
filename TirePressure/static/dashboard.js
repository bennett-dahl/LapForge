/**
 * Modular dashboard: any panel type (chart, map, readout, lap-times,
 * tire-summary) can be placed anywhere, resized, and reordered.
 * Layout is persisted per-session in localStorage.
 */
(function () {
  'use strict';

  var LAP_COLORS = [
    '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#a855f7',
    '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1',
    '#14b8a6', '#e879f9', '#eab308', '#0ea5e9', '#f43f5e',
    '#8b5cf6', '#10b981', '#fb923c', '#64748b', '#d946ef',
  ];

  var MAX_MODULES = 12;

  var MODULE_LABELS = {
    chart: 'Chart',
    map: 'Track Map',
    readout: 'Values at Cursor',
    'lap-times': 'Lap Times',
    'tire-summary': 'Tire Pressure Summary',
  };

  var DEFAULT_LAYOUT = [
    { type: 'chart', channels: ['speed', 'aps', 'pbrake_f', 'gear'], width: 'full', height: 200 },
    { type: 'chart', channels: ['accx', 'accy', 'asteer'], width: 'full', height: 200 },
    { type: 'map', width: 'half', height: 300 },
    { type: 'readout', width: 'quarter', height: 300 },
    { type: 'lap-times', width: 'quarter', height: 300 },
    { type: 'chart', channels: ['tpms_press_fl', 'tpms_press_fr', 'tpms_press_rl', 'tpms_press_rr'], width: 'full', height: 200 },
    { type: 'tire-summary', width: 'full', height: null },
  ];

  var COMPARE_PRESSURE_CHANNELS = ['tpms_press_fl', 'tpms_press_fr', 'tpms_press_rl', 'tpms_press_rr'];

  var WIDTH_CLASSES = {
    full: 'mod-full',
    half: 'mod-half',
    third: 'mod-third',
    quarter: 'mod-quarter',
  };

  var SESSION_HUES = [
    '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#a855f7',
    '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1',
  ];

  function initDashboard(data) {
    if (!data) return;

    /* ---- Comparison mode: each chart tied to one session ---- */
    var isCompare = !!(data.sessions && data.sessions.length);
    var compareSessions = isCompare ? data.sessions : [];

    var times, distances, series, meta, catGroups, lapSplits, lapSplitDist;
    var lapTimes, refLap, hasDist, fastIdx, sessionId;

    if (isCompare) {
      var first = data.sessions[0];
      times     = first.times || [];
      distances = first.distances || [];
      lapSplits = first.lap_splits || [];
      lapSplitDist = first.lap_split_distances || [];
      lapTimes  = first.lap_times || [];
      refLap    = null;
      hasDist   = first.has_distance;
      fastIdx   = null;
      sessionId = data.comparison_id || '';

      series = first.series || {};
      meta = first.channel_meta || {};
      catGroups = data.channels_by_category || {};
    } else {
      times     = data.times || [];
      distances = data.distances || [];
      series    = data.series || {};
      meta      = data.channel_meta || {};
      catGroups = data.channels_by_category || {};
      lapSplits = data.lap_splits || [];
      lapSplitDist = data.lap_split_distances || [];
      lapTimes  = data.lap_times || [];
      refLap    = data.reference_lap;
      hasDist   = data.has_distance;
      fastIdx   = data.fastest_lap_index;
      sessionId = data.session_id || '';
    }

    function _getSessionData(si) {
      if (!isCompare || si < 0 || si >= compareSessions.length) return null;
      return compareSessions[si];
    }

    var xValues   = hasDist ? distances : times;
    var xLabel    = hasDist ? 'Distance (m)' : 'Time (s)';
    var xField    = hasDist ? 'distance' : 'time';
    var xMin      = xValues.length ? xValues[0] : 0;
    var xMax      = xValues.length ? xValues[xValues.length - 1] : 0;

    var splits = hasDist ? lapSplitDist : lapSplits;
    if (!splits.length) splits = lapSplits;

    function toLapRelativeX(val) {
      if (!hasDist || !splits.length) return val;
      var lapStart = xMin;
      for (var i = 0; i < splits.length; i++) {
        if (val < splits[i]) break;
        lapStart = splits[i];
      }
      return val - lapStart;
    }

    var modules = [];
    var nextModId = 1;
    var activeLap = null;
    var _mapInstances = [];

    /* ---- Reference lap distance range (for mapDistance computation) ---- */
    var refLapDistMin = 0;
    var refLapDistMax = 0;
    if (refLap && refLap.distance && refLap.distance.length) {
      refLapDistMin = refLap.distance[0] || 0;
      refLapDistMax = refLap.distance[refLap.distance.length - 1] || 0;
    }
    var refLapLength = refLapDistMax - refLapDistMin;

    /* ---- Lap ranges ---- */
    var lapRanges = [];
    if (splits.length) {
      lapRanges.push({ index: 1, start: xMin, end: splits[0] });
      for (var s = 0; s < splits.length - 1; s++) {
        lapRanges.push({ index: s + 2, start: splits[s], end: splits[s + 1] });
      }
      lapRanges.push({ index: splits.length + 1, start: splits[splits.length - 1], end: xMax });
    } else if (lapTimes.length === 1) {
      lapRanges.push({ index: 1, start: xMin, end: xMax });
    }

    /* Compute average lap length (in x-units) for proportional mapping */
    var avgLapLen = refLapLength;
    if (lapRanges.length) {
      var totalLen = 0;
      lapRanges.forEach(function (lr) { totalLen += (lr.end - lr.start); });
      avgLapLen = totalLen / lapRanges.length;
    }

    function computeMapDistance(xVal) {
      if (refLapLength <= 0 || !lapRanges.length) return xVal;
      var lr = null;
      for (var i = 0; i < lapRanges.length; i++) {
        if (xVal >= lapRanges[i].start && xVal <= lapRanges[i].end) {
          lr = lapRanges[i]; break;
        }
      }
      if (!lr) {
        if (xVal < lapRanges[0].start) lr = lapRanges[0];
        else lr = lapRanges[lapRanges.length - 1];
      }
      var lapLen = lr.end - lr.start;
      var frac = lapLen > 0 ? (xVal - lr.start) / lapLen : 0;
      return refLapDistMin + frac * refLapLength;
    }

    /* ---- Layout persistence (server-backed, syncs across devices) ---- */
    var _legacyStorageKey = (isCompare ? 'dash_compare_layout_' : 'dash_modlayout_') + sessionId;
    var _layoutApiUrl = isCompare
      ? '/api/comparisons/' + encodeURIComponent(sessionId) + '/dashboard-layout'
      : '/api/sessions/' + encodeURIComponent(sessionId) + '/dashboard-layout';

    var _saveTimer = null;
    function _buildLayoutState() {
      return modules.map(function (m) {
        var o = { type: m.type, id: m.id, width: m.width, height: m.height };
        if (m.channels) o.channels = m.channels.slice();
        if (m.yGroups) o.yGroups = m.yGroups;
        if (m.yScales) o.yScales = m.yScales;
        if (m.sessionIdx != null) o.sessionIdx = m.sessionIdx;
        if (m.smoothLevel != null) o.smoothLevel = m.smoothLevel;
        if (m.showZeroLine) o.showZeroLine = m.showZeroLine;
        return o;
      });
    }

    function saveLayout() {
      if (!sessionId) return;
      if (_saveTimer) clearTimeout(_saveTimer);
      _saveTimer = setTimeout(function () {
        var state = _buildLayoutState();
        fetch(_layoutApiUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ layout: state }),
        }).catch(function () {});
      }, 500);
    }

    function _loadLayoutFromServer(cb) {
      if (!sessionId) return cb(null);
      fetch(_layoutApiUrl).then(function (r) { return r.json(); }).then(function (d) {
        if (d.layout && Array.isArray(d.layout) && d.layout.length) {
          return cb(d.layout);
        }
        var legacy = null;
        try {
          var raw = localStorage.getItem(_legacyStorageKey);
          if (raw) {
            var parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length) legacy = parsed;
          }
        } catch (e) {}
        if (legacy) {
          fetch(_layoutApiUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ layout: legacy }),
          }).catch(function () {});
          try { localStorage.removeItem(_legacyStorageKey); } catch (e) {}
          return cb(legacy);
        }
        cb(null);
      }).catch(function () {
        var legacy = null;
        try {
          var raw = localStorage.getItem(_legacyStorageKey);
          if (raw) {
            var parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length) legacy = parsed;
          }
        } catch (e) {}
        cb(legacy);
      });
    }

    /* ---- DOM references ---- */
    var root = document.getElementById('dash-modules-root');
    var addBtn = document.getElementById('btn-add-module');
    var addMenu = document.getElementById('add-menu');

    /* ---- Lap bar ---- */
    var lapBarEl = document.getElementById('lap-bar');
    var selectedLaps = [];
    var trimStart = 0;

    if (lapBarEl && lapRanges.length > 1) {
      var totalRange = xMax - xMin;

      var allTab = document.createElement('span');
      allTab.className = 'lap-tab lap-all active';
      allTab.textContent = 'ALL';
      allTab.addEventListener('click', function () { selectLaps(null); });
      lapBarEl.appendChild(allTab);

      lapRanges.forEach(function (lr, i) {
        var tab = document.createElement('span');
        tab.className = 'lap-tab';
        tab.textContent = 'L' + lr.index;
        tab.dataset.lap = lr.index;
        var w = ((lr.end - lr.start) / totalRange) * 100;
        tab.style.flexBasis = Math.max(w, 3) + '%';
        tab.style.background = LAP_COLORS[i % LAP_COLORS.length];

        var lt = lapTimes.find(function (t) { return t.index === lr.index; });
        if (lt) {
          var mins = Math.floor(lt.time / 60);
          var secs = (lt.time % 60).toFixed(3);
          if (secs < 10) secs = '0' + secs;
          tab.title = 'Lap ' + lr.index + ': ' + (mins > 0 ? mins + ':' + secs : lt.time.toFixed(3) + 's');
        }

        tab.addEventListener('click', function (e) {
          var lapIdx = lr.index;
          if (e.shiftKey && selectedLaps.length) {
            var anchor = selectedLaps[0];
            var lo = Math.min(anchor, lapIdx), hi = Math.max(anchor, lapIdx);
            var range = [];
            for (var li = lo; li <= hi; li++) range.push(li);
            selectLaps(range);
          } else if (e.ctrlKey || e.metaKey) {
            var pos = selectedLaps.indexOf(lapIdx);
            var next = selectedLaps.slice();
            if (pos >= 0) next.splice(pos, 1);
            else next.push(lapIdx);
            next.sort(function (a, b) { return a - b; });
            if (!next.length) { selectLaps(null); return; }
            var clo = next[0], chi = next[next.length - 1];
            var contiguous = [];
            for (var ci = clo; ci <= chi; ci++) contiguous.push(ci);
            selectLaps(contiguous);
          } else {
            if (selectedLaps.length === 1 && selectedLaps[0] === lapIdx) selectLaps(null);
            else selectLaps([lapIdx]);
          }
        });
        lapBarEl.appendChild(tab);
      });

      var trimBtn = document.createElement('button');
      trimBtn.className = 'lap-tab lap-trim';
      trimBtn.textContent = '\u2702 Trim';
      trimBtn.title = 'Trim laps from the start of the session (click to advance, shift+click to undo)';
      trimBtn.addEventListener('click', function (e) {
        if (e.shiftKey) {
          if (trimStart > 0) trimStart--;
        } else {
          if (trimStart < lapRanges.length - 1) trimStart++;
        }
        applyTrim();
      });
      lapBarEl.appendChild(trimBtn);
    }

    function selectLaps(lapIdxArray) {
      if (!lapIdxArray || !lapIdxArray.length) {
        selectedLaps = [];
        activeLap = null;
        updateLapBarHighlight();
        var tMin = trimStart > 0 ? lapRanges[trimStart].start : xMin;
        syncAllChartsZoom(tMin, xMax);
        return;
      }
      selectedLaps = lapIdxArray;
      activeLap = lapIdxArray.length === 1 ? lapIdxArray[0] : 'range';
      updateLapBarHighlight();
      var first = lapRanges.find(function (r) { return r.index === lapIdxArray[0]; });
      var last = lapRanges.find(function (r) { return r.index === lapIdxArray[lapIdxArray.length - 1]; });
      if (first && last) syncAllChartsZoom(first.start, last.end);
    }

    function applyTrim() {
      updateLapBarHighlight();
      if (selectedLaps.length) {
        selectLaps(selectedLaps.filter(function (l) { return l > trimStart; }));
      } else {
        var tMin = trimStart > 0 ? lapRanges[trimStart].start : xMin;
        syncAllChartsZoom(tMin, xMax);
      }
    }

    function updateLapBarHighlight() {
      if (!lapBarEl) return;
      lapBarEl.querySelectorAll('.lap-tab').forEach(function (t) {
        if (t.classList.contains('lap-all')) {
          t.classList.toggle('active', activeLap == null);
          return;
        }
        if (t.classList.contains('lap-trim')) return;
        var lapNum = parseInt(t.dataset.lap);
        var isSelected = selectedLaps.indexOf(lapNum) >= 0;
        var isTrimmed = lapNum <= trimStart;
        t.classList.toggle('active', isSelected);
        t.classList.toggle('lap-trimmed', isTrimmed);
      });
    }

    function zoomToLap(lapIdx) {
      if (lapIdx == null) selectLaps(null);
      else selectLaps([lapIdx]);
    }

    /* ---- Zoom sync ---- */
    var _syncing = false;
    function syncAllChartsZoom(min, max) {
      if (_syncing) return;
      _syncing = true;
      modules.forEach(function (m) {
        if (m.chart && m.chart.telemetry) m.chart.telemetry.setXRange(min, max);
      });
      _syncing = false;
    }

    function onChartZoom(range) {
      if (_syncing) return;
      var tMin = trimStart > 0 ? lapRanges[trimStart].start : xMin;
      if (Math.abs(range.min - tMin) < 1 && Math.abs(range.max - xMax) < 1) {
        activeLap = null;
        selectedLaps = [];
      } else {
        activeLap = 'custom';
        selectedLaps = [];
      }
      updateLapBarHighlight();
      syncAllChartsZoom(range.min, range.max);
    }

    /* ---- Width cycle ---- */
    var WIDTHS = ['full', 'half', 'third', 'quarter'];
    function cycleWidth(mod) {
      var idx = WIDTHS.indexOf(mod.width);
      mod.width = WIDTHS[(idx + 1) % WIDTHS.length];
      var el = document.getElementById('module-' + mod.id);
      if (el) {
        WIDTHS.forEach(function (w) { el.classList.remove(WIDTH_CLASSES[w]); });
        el.classList.add(WIDTH_CLASSES[mod.width]);
      }
      if (mod.type === 'map') invalidateMaps();
      saveLayout();
    }

    /* ---- Create module DOM ---- */
    function createModuleDOM(mod) {
      var el = document.createElement('div');
      el.className = 'dash-module ' + (WIDTH_CLASSES[mod.width] || 'mod-full');
      el.id = 'module-' + mod.id;
      el.draggable = true;

      var header = document.createElement('div');
      header.className = 'dash-module-header';

      var title = document.createElement('span');
      title.className = 'module-title';
      title.id = 'modtitle-' + mod.id;
      title.textContent = MODULE_LABELS[mod.type] || mod.type;
      header.appendChild(title);

      var actions = document.createElement('div');
      actions.className = 'module-actions';

      /* width toggle */
      var wBtn = document.createElement('button');
      wBtn.type = 'button';
      wBtn.className = 'panel-btn';
      wBtn.title = 'Cycle width';
      wBtn.innerHTML = '&#x2194;';
      wBtn.addEventListener('click', function () { cycleWidth(mod); });
      actions.appendChild(wBtn);

      if (mod.type === 'chart') {
        if (isCompare && compareSessions.length > 0) {
          var sessSelect = document.createElement('select');
          sessSelect.className = 'panel-select';
          sessSelect.id = 'sessselect-' + mod.id;
          sessSelect.title = 'Select session for this chart';
          compareSessions.forEach(function (s, si) {
            var opt = document.createElement('option');
            opt.value = si;
            opt.textContent = s.label || ('Session ' + (si + 1));
            if (mod.sessionIdx === si) opt.selected = true;
            sessSelect.appendChild(opt);
          });
          sessSelect.addEventListener('change', function () {
            var t = mod.chart && mod.chart.telemetry;
            var savedRange = t ? t.getXRange() : null;
            mod.sessionIdx = parseInt(sessSelect.value);
            buildModuleContent(mod);
            t = mod.chart && mod.chart.telemetry;
            if (savedRange && t) t.setXRange(savedRange.min, savedRange.max);
            saveLayout();
          });
          actions.appendChild(sessSelect);
        }

        var yBtn = document.createElement('button');
        yBtn.type = 'button';
        yBtn.className = 'panel-btn' + (mod.yGroups ? ' btn-active' : '');
        yBtn.id = 'ybtn-' + mod.id;
        yBtn.textContent = 'Y-Axis';
        yBtn.title = 'Configure Y-axis grouping';
        yBtn.addEventListener('click', function () { openYGroupModal(mod); });
        actions.appendChild(yBtn);

        var smoothSel = document.createElement('select');
        smoothSel.className = 'panel-select smooth-select';
        smoothSel.id = 'smoothsel-' + mod.id;
        smoothSel.title = 'TPMS Smoothing';
        smoothSel.style.display = 'none';
        SMOOTH_LEVELS.forEach(function (lvl, li) {
          var opt = document.createElement('option');
          opt.value = li;
          opt.textContent = lvl.label;
          if ((mod.smoothLevel || 0) === li) opt.selected = true;
          smoothSel.appendChild(opt);
        });
        smoothSel.addEventListener('change', function () {
          var t = mod.chart && mod.chart.telemetry;
          var savedRange = t ? t.getXRange() : null;
          mod.smoothLevel = parseInt(smoothSel.value);
          buildModuleContent(mod);
          t = mod.chart && mod.chart.telemetry;
          if (savedRange && t) t.setXRange(savedRange.min, savedRange.max);
          saveLayout();
        });
        actions.appendChild(smoothSel);

        var selBtn = document.createElement('button');
        selBtn.type = 'button';
        selBtn.className = 'panel-btn';
        selBtn.textContent = 'Channels';
        selBtn.addEventListener('click', function () { openModal(mod.id); });
        actions.appendChild(selBtn);
      }

      var rmBtn = document.createElement('button');
      rmBtn.type = 'button';
      rmBtn.className = 'panel-btn btn-remove';
      rmBtn.textContent = '\u2715';
      rmBtn.title = 'Remove';
      rmBtn.addEventListener('click', function () { removeModule(mod.id); });
      actions.appendChild(rmBtn);

      header.appendChild(actions);
      el.appendChild(header);

      var body = document.createElement('div');
      body.className = 'module-body';
      body.id = 'modbody-' + mod.id;
      if (mod.height) body.style.height = mod.height + 'px';
      el.appendChild(body);

      /* resize handle */
      var handle = document.createElement('div');
      handle.className = 'resize-handle';
      el.appendChild(handle);
      initResizeHandle(handle, body, mod);

      /* drag-and-drop reorder (only from header, not chart body) */
      el.addEventListener('dragstart', function (e) {
        if (!e.target.closest('.dash-module-header')) { e.preventDefault(); return; }
        e.dataTransfer.setData('text/plain', mod.id);
        el.classList.add('dragging');
      });
      el.addEventListener('dragend', function () { el.classList.remove('dragging'); });

      root.appendChild(el);
      return el;
    }

    /* ---- Build module content by type ---- */
    function buildModuleContent(mod) {
      var body = document.getElementById('modbody-' + mod.id);
      if (!body) return;
      body.innerHTML = '';

      switch (mod.type) {
        case 'chart': buildChartModule(mod, body); break;
        case 'map': buildMapModule(mod, body); break;
        case 'readout': buildReadoutModule(mod, body); break;
        case 'lap-times': buildLapTimesModule(mod, body); break;
        case 'tire-summary': buildTireSummaryModule(mod, body); break;
      }
    }

    /* ---- Resolve series/meta/xValues for a chart module ---- */
    function _modSeriesCtx(mod) {
      if (isCompare && mod.sessionIdx != null) {
        var sd = _getSessionData(mod.sessionIdx);
        if (sd) return { series: sd.series || {}, meta: sd.channel_meta || {},
          xValues: sd.has_distance ? (sd.distances || []) : (sd.times || []),
          splits: sd.has_distance ? (sd.lap_split_distances || []) : (sd.lap_splits || []),
          hasDist: sd.has_distance,
          label: sd.label || '',
          targetPsi: sd.target_psi,
          targetUnit: sd.target_unit || '',
          rawPressure: sd.raw_pressure_series || {} };
      }
      return { series: series, meta: meta, xValues: xValues, splits: splits, hasDist: hasDist, label: '',
        targetPsi: data.target_psi,
        targetUnit: data.target_unit || '',
        rawPressure: data.raw_pressure_series || {} };
    }

    /* ---- Smoothing helper ---- */
    var SMOOTH_LEVELS = [
      { label: 'Raw',    window: 1 },
      { label: 'Light',  window: 10 },
      { label: 'Medium', window: 25 },
      { label: 'Heavy',  window: 50 },
      { label: 'Ultra',  window: 100 },
    ];

    function smoothMovingAvg(values, windowSize) {
      if (windowSize <= 1) return values;
      var half = Math.floor(windowSize / 2);
      var out = new Array(values.length);
      for (var i = 0; i < values.length; i++) {
        var lo = Math.max(0, i - half), hi = Math.min(values.length, i + half + 1);
        var sum = 0, count = 0;
        for (var j = lo; j < hi; j++) {
          if (values[j] != null) { sum += values[j]; count++; }
        }
        out[i] = count > 0 ? sum / count : null;
      }
      return out;
    }

    function _hasPressureChannel(channels, metaObj) {
      for (var i = 0; i < channels.length; i++) {
        var m = metaObj[channels[i]] || {};
        if (m.category === 'pressure') return true;
      }
      return false;
    }

    /* ---- Chart module ---- */
    function buildChartModule(mod, body) {
      if (mod.chart) { mod.chart.destroy(); mod.chart = null; }

      var ctx = _modSeriesCtx(mod);
      var smoothWin = (mod.smoothLevel != null && mod.smoothLevel > 0)
        ? SMOOTH_LEVELS[mod.smoothLevel].window : 0;
      var chData = [];
      (mod.channels || []).forEach(function (name) {
        if (!ctx.series[name]) return;
        var m = ctx.meta[name] || {};
        var vals = ctx.series[name];
        if (m.category === 'pressure' && smoothWin > 0 && ctx.rawPressure && ctx.rawPressure[name]) {
          vals = smoothMovingAvg(ctx.rawPressure[name], smoothWin);
        } else if (m.category === 'pressure' && smoothWin === 0 && ctx.rawPressure && ctx.rawPressure[name]) {
          vals = ctx.rawPressure[name];
        }
        chData.push({ name: name, label: m.display || name, values: vals, color: m.color || '#888', unit: m.unit || '' });
      });

      var titleEl = document.getElementById('modtitle-' + mod.id);
      if (titleEl) {
        var prefix = (isCompare && ctx.label) ? ctx.label + ' — ' : '';
        titleEl.textContent = chData.length
          ? prefix + chData.map(function (c) { return c.label; }).join(', ')
          : prefix + 'No channels — click Channels';
      }

      if (!chData.length) return;

      var chartXValues = ctx.xValues;
      var chartSplits = ctx.splits;
      var chartHasDist = ctx.hasDist;
      var chartXLabel = chartHasDist ? 'Distance (m)' : 'Time (s)';
      var chartXField = chartHasDist ? 'distance' : 'time';

      var chartCfg = {
        channels: chData,
        xValues: chartXValues,
        xLabel: chartXLabel,
        lapSplits: chartSplits,
        lapSplitDistances: chartSplits,
        lapRelativeX: chartHasDist,
        yGroups: mod.yGroups || null,
        yScales: mod.yScales || null,
        showZeroLine: mod.showZeroLine || null,
        onHover: function (x) {
          var st = {};
          st[chartXField] = x;
          st.mapDistance = computeMapDistance(x);
          CursorSync.set(st);
          updateAllReadouts(x);
        },
        onZoom: onChartZoom,
      };

      if (_hasPressureChannel(mod.channels || [], ctx.meta) && ctx.targetPsi != null && isFinite(ctx.targetPsi)) {
        chartCfg.target = {
          value: ctx.targetPsi,
          label: 'Target ' + ctx.targetPsi + ' ' + ctx.targetUnit,
          color: '#94a3b8',
        };
      }

      body.style.position = 'relative';
      body.style.overflow = 'hidden';
      var canvas = document.createElement('canvas');
      canvas.id = 'canvas-' + mod.id;
      canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%!important;height:100%!important;';
      body.appendChild(canvas);

      var chart = createTelemetryChart(canvas, chartCfg);
      mod.chart = chart;

      var smoothEl = document.getElementById('smoothsel-' + mod.id);
      if (smoothEl) {
        smoothEl.style.display = _hasPressureChannel(mod.channels || [], ctx.meta) ? '' : 'none';
      }
    }

    /* ---- Y-axis grouping modal ---- */
    var GROUP_LABELS = ['A', 'B', 'C', 'D'];
    var GROUP_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b'];
    var yGroupOverlay = null;
    var yGroupMod = null;
    var yGroupState = {};
    var yScaleState = {};
    var yZeroState = {};

    function _activeGroups() {
      var seen = {};
      for (var ch in yGroupState) seen[yGroupState[ch]] = true;
      var list = [];
      GROUP_LABELS.forEach(function (_, gi) { if (seen[gi]) list.push(gi); });
      return list;
    }

    function _rebuildScaleInputs(container) {
      container.innerHTML = '';
      var active = _activeGroups();
      var showGrouped = active.length > 1;

      if (!showGrouped) {
        var row = _createScaleRow('All channels', 0, '#aaa');
        container.appendChild(row);
      } else {
        active.forEach(function (gi) {
          var row = _createScaleRow('Group ' + GROUP_LABELS[gi], gi, GROUP_COLORS[gi]);
          container.appendChild(row);
        });
      }
    }

    function _createScaleRow(label, groupIdx, color) {
      var existing = yScaleState[groupIdx] || {};
      var row = document.createElement('div');
      row.className = 'yscale-row';

      var lbl = document.createElement('span');
      lbl.className = 'yscale-label';
      lbl.style.color = color;
      lbl.textContent = label;
      row.appendChild(lbl);

      var inputs = document.createElement('div');
      inputs.className = 'yscale-inputs';

      var minInput = document.createElement('input');
      minInput.type = 'number';
      minInput.className = 'yscale-input';
      minInput.placeholder = 'Auto';
      minInput.title = 'Min';
      if (existing.min != null && existing.min !== '') minInput.value = existing.min;
      minInput.addEventListener('input', function () {
        if (!yScaleState[groupIdx]) yScaleState[groupIdx] = {};
        var v = parseFloat(minInput.value);
        yScaleState[groupIdx].min = isNaN(v) ? null : v;
      });

      var sep = document.createElement('span');
      sep.textContent = '–';
      sep.style.cssText = 'opacity:0.4;margin:0 0.2rem;';

      var maxInput = document.createElement('input');
      maxInput.type = 'number';
      maxInput.className = 'yscale-input';
      maxInput.placeholder = 'Auto';
      maxInput.title = 'Max';
      if (existing.max != null && existing.max !== '') maxInput.value = existing.max;
      maxInput.addEventListener('input', function () {
        if (!yScaleState[groupIdx]) yScaleState[groupIdx] = {};
        var v = parseFloat(maxInput.value);
        yScaleState[groupIdx].max = isNaN(v) ? null : v;
      });

      var zeroCb = document.createElement('input');
      zeroCb.type = 'checkbox';
      zeroCb.checked = !!yZeroState[groupIdx];
      zeroCb.title = 'Show zero line';
      zeroCb.addEventListener('change', function () {
        yZeroState[groupIdx] = zeroCb.checked;
      });

      inputs.appendChild(document.createTextNode('Min '));
      inputs.appendChild(minInput);
      inputs.appendChild(sep);
      inputs.appendChild(document.createTextNode('Max '));
      inputs.appendChild(maxInput);
      var zeroLabel = document.createElement('label');
      zeroLabel.style.cssText = 'display:inline-flex;align-items:center;gap:0.2rem;margin-left:0.5rem;font-size:0.75rem;cursor:pointer;white-space:nowrap;';
      zeroLabel.appendChild(zeroCb);
      zeroLabel.appendChild(document.createTextNode('Zero'));
      inputs.appendChild(zeroLabel);
      row.appendChild(inputs);
      return row;
    }

    function openYGroupModal(mod) {
      yGroupMod = mod;
      yGroupState = {};
      yScaleState = {};
      yZeroState = {};
      var existing = mod.yGroups || {};
      var existingScales = mod.yScales || {};
      var existingZero = mod.showZeroLine || {};
      (mod.channels || []).forEach(function (name) {
        yGroupState[name] = existing[name] != null ? existing[name] : 0;
      });
      GROUP_LABELS.forEach(function (_, gi) {
        if (existingScales[gi]) yScaleState[gi] = { min: existingScales[gi].min, max: existingScales[gi].max };
        if (existingZero[gi]) yZeroState[gi] = true;
      });

      if (yGroupOverlay) yGroupOverlay.remove();

      yGroupOverlay = document.createElement('div');
      yGroupOverlay.className = 'modal-overlay';
      yGroupOverlay.addEventListener('click', function (e) {
        if (e.target === yGroupOverlay) closeYGroupModal();
      });

      var dialog = document.createElement('div');
      dialog.className = 'modal-dialog';
      dialog.style.width = '400px';

      var header = document.createElement('div');
      header.className = 'modal-header';
      header.innerHTML = '<h3>Y-Axis Groups</h3>';
      var closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'modal-close';
      closeBtn.innerHTML = '&times;';
      closeBtn.addEventListener('click', closeYGroupModal);
      header.appendChild(closeBtn);
      dialog.appendChild(header);

      var body = document.createElement('div');
      body.className = 'modal-body';

      var desc = document.createElement('div');
      desc.style.cssText = 'font-size:0.75rem;color:var(--muted);margin-bottom:0.6rem;';
      desc.textContent = 'Assign channels to groups. Each group gets its own Y-axis scale.';
      body.appendChild(desc);

      var yCtx = _modSeriesCtx(mod);
      (mod.channels || []).forEach(function (name) {
        if (!yCtx.series[name]) return;
        var cm = yCtx.meta[name] || {};
        var row = document.createElement('div');
        row.className = 'ygroup-row';

        var label = document.createElement('span');
        label.className = 'ygroup-label';
        label.style.color = cm.color || '#888';
        label.textContent = cm.display || name;
        row.appendChild(label);

        var btns = document.createElement('div');
        btns.className = 'ygroup-btns';
        GROUP_LABELS.forEach(function (gl, gi) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'ygroup-btn' + (yGroupState[name] === gi ? ' active' : '');
          b.textContent = gl;
          b.style.setProperty('--gc', GROUP_COLORS[gi]);
          b.addEventListener('click', function () {
            yGroupState[name] = gi;
            btns.querySelectorAll('.ygroup-btn').forEach(function (btn, bi) {
              btn.classList.toggle('active', bi === gi);
            });
            _rebuildScaleInputs(scaleSection);
          });
          btns.appendChild(b);
        });
        row.appendChild(btns);
        body.appendChild(row);
      });

      var scaleDivider = document.createElement('div');
      scaleDivider.style.cssText = 'border-top:1px solid var(--border);margin:0.75rem 0 0.5rem;padding-top:0.5rem;';
      var scaleTitle = document.createElement('div');
      scaleTitle.style.cssText = 'font-size:0.75rem;color:var(--muted);margin-bottom:0.5rem;';
      scaleTitle.textContent = 'Scale limits (leave blank for auto)';
      scaleDivider.appendChild(scaleTitle);
      body.appendChild(scaleDivider);

      var scaleSection = document.createElement('div');
      scaleSection.id = 'yscale-section-' + mod.id;
      body.appendChild(scaleSection);
      _rebuildScaleInputs(scaleSection);

      dialog.appendChild(body);

      var footer = document.createElement('div');
      footer.className = 'modal-footer';

      var resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.className = 'btn btn-secondary';
      resetBtn.textContent = 'Reset all';
      resetBtn.addEventListener('click', function () {
        yGroupMod.yGroups = null;
        yGroupMod.yScales = null;
        yGroupMod.showZeroLine = null;
        applyYGroupChange();
      });
      footer.appendChild(resetBtn);

      var applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = 'btn';
      applyBtn.textContent = 'Apply';
      applyBtn.addEventListener('click', function () {
        var groups = {};
        var hasMultiple = false;
        for (var ch in yGroupState) groups[ch] = yGroupState[ch];
        var vals = Object.keys(groups).map(function (k) { return groups[k]; });
        for (var i = 1; i < vals.length; i++) { if (vals[i] !== vals[0]) { hasMultiple = true; break; } }
        yGroupMod.yGroups = hasMultiple ? groups : null;

        var cleanScales = {};
        var hasAnyScale = false;
        for (var gi in yScaleState) {
          var s = yScaleState[gi];
          if (s && (s.min != null || s.max != null)) {
            cleanScales[gi] = {};
            if (s.min != null) { cleanScales[gi].min = s.min; hasAnyScale = true; }
            if (s.max != null) { cleanScales[gi].max = s.max; hasAnyScale = true; }
          }
        }
        yGroupMod.yScales = hasAnyScale ? cleanScales : null;
        var cleanZero = {};
        var hasAnyZero = false;
        for (var zi in yZeroState) {
          if (yZeroState[zi]) { cleanZero[zi] = true; hasAnyZero = true; }
        }
        yGroupMod.showZeroLine = hasAnyZero ? cleanZero : null;
        applyYGroupChange();
      });
      footer.appendChild(applyBtn);

      dialog.appendChild(footer);
      yGroupOverlay.appendChild(dialog);
      document.body.appendChild(yGroupOverlay);
    }

    function closeYGroupModal() {
      if (yGroupOverlay) { yGroupOverlay.remove(); yGroupOverlay = null; }
      yGroupMod = null;
    }

    function applyYGroupChange() {
      if (!yGroupMod) return;
      var t = yGroupMod.chart && yGroupMod.chart.telemetry;
      var savedRange = t ? t.getXRange() : null;
      var yBtn = document.getElementById('ybtn-' + yGroupMod.id);
      if (yBtn) yBtn.classList.toggle('btn-active', !!(yGroupMod.yGroups || yGroupMod.yScales || yGroupMod.showZeroLine));
      buildModuleContent(yGroupMod);
      t = yGroupMod.chart && yGroupMod.chart.telemetry;
      if (savedRange && t) t.setXRange(savedRange.min, savedRange.max);
      saveLayout();
      closeYGroupModal();
    }

    /* ---- Map module ---- */
    function buildMapModule(mod, body) {
      destroyMapInstance(mod);

      if (!refLap || !refLap.lat || refLap.lat.length < 3 || typeof createTrackMap === 'undefined') {
        body.innerHTML = '<div style="color:var(--muted);font-size:0.8rem;padding:1rem;">No GPS data available.</div>';
        return;
      }

      var mapDiv = document.createElement('div');
      mapDiv.style.cssText = 'width:100%;height:100%;border-radius:4px;overflow:hidden;';
      body.appendChild(mapDiv);

      var polyline = [];
      for (var k = 0; k < refLap.lat.length; k++) {
        if (refLap.lat[k] != null && refLap.lon[k] != null) {
          polyline.push([refLap.lat[k], refLap.lon[k]]);
        }
      }
      if (polyline.length < 3) {
        body.innerHTML = '<div style="color:var(--muted);font-size:0.8rem;padding:1rem;">Insufficient GPS points.</div>';
        return;
      }

      var mapInstance = createTrackMap(mapDiv, {
        polyline: polyline,
        heading: refLap.heading || [],
        distances: refLap.distance || [],
      });
      mod._mapInstance = mapInstance;
      _mapInstances.push(mapInstance);
    }

    function destroyMapInstance(mod) {
      if (mod._mapInstance) {
        var idx = _mapInstances.indexOf(mod._mapInstance);
        if (idx >= 0) _mapInstances.splice(idx, 1);
        mod._mapInstance.destroy();
        mod._mapInstance = null;
      }
    }

    function invalidateMaps() {
      setTimeout(function () {
        _mapInstances.forEach(function (mi) {
          if (mi && mi.map) mi.map.invalidateSize();
        });
      }, 300);
    }

    /* ---- Readout module ---- */
    function buildReadoutModule(mod, body) {
      body.style.overflow = 'auto';
      var el = document.createElement('div');
      el.className = 'cursor-readout';
      el.id = 'readout-' + mod.id;
      el.innerHTML = '<div class="cr-row"><span class="cr-label">Move cursor over chart</span></div>';
      body.appendChild(el);
      mod._readoutEl = el;
    }

    /* ---- Lap Times module ---- */
    function buildLapTimesModule(mod, body) {
      body.style.overflow = 'auto';
      var table = document.createElement('table');
      table.className = 'lap-table';
      table.innerHTML = '<thead><tr><th>Lap</th><th>Time</th><th>Delta</th></tr></thead>';
      var tbody = document.createElement('tbody');

      if (lapTimes.length) {
        var bestTime = Infinity;
        lapTimes.forEach(function (lt) { if (lt.index > 1 && lt.time < bestTime) bestTime = lt.time; });
        lapTimes.forEach(function (lt, i) {
          var tr = document.createElement('tr');
          if (lt.time === bestTime) tr.className = 'fastest';
          var delta = lt.time - bestTime;
          var mins = Math.floor(lt.time / 60);
          var secs = (lt.time % 60).toFixed(3);
          if (secs < 10) secs = '0' + secs;
          var timeStr = mins > 0 ? mins + ':' + secs : lt.time.toFixed(3) + 's';
          var deltaStr = delta === 0 ? '\u2014' : '+' + delta.toFixed(3);
          var col = LAP_COLORS[i % LAP_COLORS.length];
          tr.innerHTML = '<td><span class="lap-dot" style="background:' + col + '"></span>' + lt.index + '</td><td>' + timeStr + '</td><td>' + deltaStr + '</td>';
          tr.style.cursor = 'pointer';
          tr.addEventListener('click', (function (idx) { return function () { zoomToLap(idx); }; })(lt.index));
          tbody.appendChild(tr);
        });
      }

      table.appendChild(tbody);
      body.appendChild(table);
    }

    /* ---- Tire Summary module ---- */
    function buildTireSummaryModule(mod, body) {
      var summaryEl = document.getElementById('tire-summary-data');
      if (!summaryEl) {
        body.innerHTML = '<div style="color:var(--muted);font-size:0.8rem;padding:0.5rem;">No tire pressure summary.</div>';
        return;
      }
      try {
        var summary = JSON.parse(summaryEl.textContent);
        var html = '<div style="font-size:0.8rem;line-height:1.6;padding:0.25rem;">';
        html += '<div>Target: ' + (summary.target || '\u2014') + ' ' + (summary.unit || '') + '</div>';
        html += '<div>Global: ' + (summary.global_min || '\u2014') + ' \u2013 ' + (summary.global_max || '\u2014') + '</div>';
        var lot = summary.laps_over_target;
        if (lot && (Array.isArray(lot) ? lot.length : lot)) {
          html += '<div style="color:#f87171;">Over target: ' + (Array.isArray(lot) ? lot.join(', ') : lot) + '</div>';
        }
        html += '</div>';
        body.innerHTML = html;
      } catch (e) {
        body.innerHTML = '<div style="color:var(--muted);font-size:0.8rem;padding:0.5rem;">Could not parse summary.</div>';
      }
    }

    /* ---- Readout updates ---- */
    function _interpolateReadout(xVal, modSeries, modMeta, modXValues) {
      var idx = 0;
      for (var i = 0; i < modXValues.length - 1; i++) { if (modXValues[i + 1] > xVal) break; idx = i; }
      var idx1 = Math.min(idx + 1, modXValues.length - 1);
      var dx = modXValues[idx1] - modXValues[idx];
      var frac = dx > 0 ? (xVal - modXValues[idx]) / dx : 0;
      var out = {};
      for (var ch in modSeries) {
        var arr = modSeries[ch];
        if (!arr) continue;
        var v0 = arr[idx], v1 = arr[idx1];
        out[ch] = (v0 != null && v1 != null) ? (v0 + frac * (v1 - v0)) : v0;
      }
      return out;
    }

    function updateAllReadouts(xVal) {
      if (xVal == null) return;
      var idx = 0;
      for (var i = 0; i < xValues.length - 1; i++) { if (xValues[i + 1] > xVal) break; idx = i; }
      var idx1 = Math.min(idx + 1, xValues.length - 1);
      var dx = xValues[idx1] - xValues[idx];
      var frac = dx > 0 ? (xVal - xValues[idx]) / dx : 0;

      var lap = 1;
      for (var j = 0; j < splits.length; j++) { if (splits[j] <= xVal) lap++; }

      var lapDist = hasDist ? Math.round(toLapRelativeX(xVal)) : null;
      var html = '<div class="cr-row"><span class="cr-label">Lap ' + lap + '</span>';
      if (hasDist) html += '<span class="cr-val">' + lapDist + ' m</span>';
      else html += '<span class="cr-val">' + xVal.toFixed(1) + ' s</span>';
      html += '</div>';

      if (isCompare) {
        var seenSessions = {};
        modules.forEach(function (m) {
          if (m.type !== 'chart' || m.sessionIdx == null) return;
          if (seenSessions[m.sessionIdx]) return;
          seenSessions[m.sessionIdx] = true;
          var ctx = _modSeriesCtx(m);
          var visChannels = {};
          (m.channels || []).forEach(function (n) { visChannels[n] = true; });
          var sessColor = SESSION_HUES[m.sessionIdx % SESSION_HUES.length];
          html += '<div class="cr-row" style="margin-top:0.3rem;"><span class="cr-label" style="font-weight:600;color:' + sessColor + '">' + ctx.label + '</span></div>';
          var vals = _interpolateReadout(xVal, ctx.series, ctx.meta, ctx.xValues);
          for (var ch in visChannels) {
            var cm = ctx.meta[ch] || {};
            html += '<div class="cr-row"><span class="cr-label" style="color:' + (cm.color || '#888') + '">' + (cm.display || ch) + '</span>';
            html += '<span class="cr-val">' + (vals[ch] != null ? vals[ch].toFixed(2) : '\u2014') + ' ' + (cm.unit || '') + '</span></div>';
          }
        });
      } else {
        var visibleBase = {};
        modules.forEach(function (m) {
          if (m.type === 'chart') (m.channels || []).forEach(function (n) { visibleBase[n] = true; });
        });
        for (var chName in visibleBase) {
          var arr = series[chName];
          if (!arr) continue;
          var v0 = arr[idx], v1 = arr[idx1];
          var val = (v0 != null && v1 != null) ? (v0 + frac * (v1 - v0)) : v0;
          var m = meta[chName] || {};
          var disp = m.display || chName;
          var unit = m.unit || '';
          var color = m.color || '#888';
          html += '<div class="cr-row"><span class="cr-label" style="color:' + color + '">' + disp + '</span>';
          html += '<span class="cr-val">' + (val != null ? val.toFixed(2) : '\u2014') + ' ' + unit + '</span></div>';
        }
      }

      modules.forEach(function (mod) {
        if (mod.type === 'readout' && mod._readoutEl) {
          mod._readoutEl.innerHTML = html;
        }
      });
    }

    CursorSync.subscribe(function (state) {
      var x = hasDist ? state.distance : state.time;
      if (x != null && isFinite(x)) updateAllReadouts(x);
    });

    /* ---- Add / remove modules ---- */
    function addModule(type, opts) {
      if (modules.length >= MAX_MODULES) return;
      opts = opts || {};
      var id = 'mod' + (nextModId++);
      var mod = {
        type: type,
        id: id,
        width: opts.width || (type === 'chart' ? 'full' : 'half'),
        height: opts.height || (type === 'chart' ? 200 : type === 'map' ? 300 : 250),
        channels: opts.channels || null,
        sessionIdx: opts.sessionIdx != null ? opts.sessionIdx : (isCompare ? 0 : undefined),
        yGroups: opts.yGroups || null,
        yScales: opts.yScales || null,
        chart: null,
      };
      if (type === 'chart' && !mod.channels) {
        mod.channels = defaultChannels(4);
      }
      modules.push(mod);
      createModuleDOM(mod);
      buildModuleContent(mod);
      updateAddBtnVisibility();
      saveLayout();
      return mod;
    }

    function removeModule(modId) {
      if (modules.length <= 1) return;
      var idx = modules.findIndex(function (m) { return m.id === modId; });
      if (idx < 0) return;
      var mod = modules[idx];
      if (mod.chart) mod.chart.destroy();
      destroyMapInstance(mod);
      modules.splice(idx, 1);
      var el = document.getElementById('module-' + modId);
      if (el) el.remove();
      updateAddBtnVisibility();
      saveLayout();
    }

    function updateAddBtnVisibility() {
      if (addBtn) addBtn.style.display = modules.length >= MAX_MODULES ? 'none' : '';
    }

    /* ---- Add module menu ---- */
    if (addBtn && addMenu) {
      addBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        addMenu.style.display = addMenu.style.display === 'none' ? 'flex' : 'none';
      });
      addMenu.querySelectorAll('.add-menu-item').forEach(function (btn) {
        btn.addEventListener('click', function () {
          addModule(btn.dataset.type);
          addMenu.style.display = 'none';
        });
      });
      document.addEventListener('click', function () { addMenu.style.display = 'none'; });
    }

    /* ---- Channel picker modal ---- */
    var modalOverlay = document.getElementById('channel-picker-overlay');
    var modalList = document.getElementById('modal-channel-list');
    var modalApply = document.getElementById('modal-apply');
    var modalCancelBtn = document.getElementById('modal-cancel-btn');
    var modalClose = document.getElementById('modal-cancel');
    var modalModId = null;
    var modalSelection = {};

    function openModal(modId) {
      modalModId = modId;
      var mod = modules.find(function (x) { return x.id === modId; });
      modalSelection = {};
      if (mod && mod.channels) mod.channels.forEach(function (n) { modalSelection[n] = true; });

      var useCatGroups = catGroups;
      if (isCompare && mod && mod.sessionIdx != null) {
        var sd = _getSessionData(mod.sessionIdx);
        if (sd && sd.channel_meta) {
          useCatGroups = {};
          var sMeta = sd.channel_meta;
          var sSeries = sd.series || {};
          var skipCats = {timing:1, gps:1, derived:1};
          for (var cn in sSeries) {
            var cm = sMeta[cn] || {};
            var cat = cm.category || 'other';
            if (skipCats[cat]) continue;
            if (!useCatGroups[cat]) useCatGroups[cat] = [];
            useCatGroups[cat].push({
              name: cn, display: cm.display || cn,
              unit: cm.unit || '', color: cm.color || '#888', category: cat,
            });
          }
        }
      }

      modalList.innerHTML = '';
      Object.keys(useCatGroups).sort().forEach(function (cat) {
        var group = document.createElement('div');
        group.className = 'modal-cat-group';
        var catTitle = document.createElement('div');
        catTitle.className = 'modal-cat-title';
        catTitle.textContent = cat;
        group.appendChild(catTitle);

        useCatGroups[cat].forEach(function (ch) {
          var label = document.createElement('label');
          label.className = 'modal-ch-item';
          var cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = !!modalSelection[ch.name];
          cb.dataset.channel = ch.name;
          cb.addEventListener('change', function () {
            if (cb.checked) modalSelection[ch.name] = true;
            else delete modalSelection[ch.name];
          });
          var swatch = document.createElement('span');
          swatch.className = 'modal-ch-swatch';
          swatch.style.background = ch.color;
          var txt = document.createTextNode(ch.display + (ch.unit ? ' (' + ch.unit + ')' : ''));
          label.appendChild(cb);
          label.appendChild(swatch);
          label.appendChild(txt);
          group.appendChild(label);
        });
        modalList.appendChild(group);
      });
      modalOverlay.style.display = '';
    }

    function closeModal() { modalOverlay.style.display = 'none'; modalModId = null; }
    function applyModal() {
      if (!modalModId) return;
      var mod = modules.find(function (x) { return x.id === modalModId; });
      if (mod) {
        var t = mod.chart && mod.chart.telemetry;
        var savedRange = t ? t.getXRange() : null;
        mod.channels = Object.keys(modalSelection);
        buildModuleContent(mod);
        t = mod.chart && mod.chart.telemetry;
        if (savedRange && t) t.setXRange(savedRange.min, savedRange.max);
        saveLayout();
      }
      closeModal();
    }

    if (modalApply) modalApply.addEventListener('click', applyModal);
    if (modalCancelBtn) modalCancelBtn.addEventListener('click', closeModal);
    if (modalClose) modalClose.addEventListener('click', closeModal);
    if (modalOverlay) modalOverlay.addEventListener('click', function (e) { if (e.target === modalOverlay) closeModal(); });

    /* ---- Resize handle ---- */
    function initResizeHandle(handle, body, mod) {
      var startY = 0, startH = 0;
      function onDown(e) {
        e.preventDefault();
        startY = e.clientY;
        startH = body.offsetHeight;
        handle.classList.add('dragging');
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';
      }
      function onMove(e) {
        var newH = Math.max(60, startH + (e.clientY - startY));
        body.style.height = newH + 'px';
        if (mod.type === 'chart' && mod.chart) mod.chart.resize();
        if (mod.type === 'map') invalidateMaps();
      }
      function onUp() {
        handle.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        mod.height = body.offsetHeight;
        saveLayout();
        window.dispatchEvent(new Event('resize'));
      }
      handle.addEventListener('mousedown', onDown);
    }

    /* ---- Drag-and-drop reorder ---- */
    root.addEventListener('dragover', function (e) {
      e.preventDefault();
      var target = e.target.closest('.dash-module');
      if (!target || target.classList.contains('dragging')) return;
      var dragging = root.querySelector('.dragging');
      if (!dragging) return;
      var rect = target.getBoundingClientRect();
      var after = e.clientX > rect.left + rect.width / 2;
      if (after) target.after(dragging);
      else target.before(dragging);
    });

    root.addEventListener('drop', function (e) {
      e.preventDefault();
      var newOrder = [];
      root.querySelectorAll('.dash-module').forEach(function (el) {
        var id = el.id.replace('module-', '');
        var mod = modules.find(function (m) { return m.id === id; });
        if (mod) newOrder.push(mod);
      });
      modules = newOrder;
      saveLayout();
    });

    /* ---- Channel existence check ---- */
    function channelExists(name) {
      return !!series[name];
    }

    function channelExistsInSession(name, si) {
      var sd = _getSessionData(si);
      if (!sd) return !!series[name];
      return !!(sd.series && sd.series[name]);
    }

    function defaultChannels(count) {
      var keys = Object.keys(series);
      return keys.slice(0, Math.min(count, keys.length));
    }

    function defaultCompareChannels(si) {
      var sd = _getSessionData(si);
      if (!sd || !sd.series) return defaultChannels(4);
      var ks = Object.keys(sd.series);
      var pressureKeys = ks.filter(function (k) { return COMPARE_PRESSURE_CHANNELS.indexOf(k) >= 0; });
      if (pressureKeys.length) return pressureKeys;
      return ks.slice(0, Math.min(4, ks.length));
    }

    /* ---- Initialize modules ---- */
    function _applyLayout(savedState) {
      if (savedState && savedState.length) {
        savedState.forEach(function (s) {
          if (isCompare && (s.type === 'map' || s.type === 'tire-summary')) return;
          var id = 'mod' + (nextModId++);
          var si = s.sessionIdx != null ? s.sessionIdx : (isCompare ? 0 : undefined);
          var mod = {
            type: s.type || 'chart',
            id: id,
            width: s.width || 'full',
            height: s.height || 200,
            channels: s.channels || null,
            sessionIdx: si,
            yGroups: s.yGroups || null,
            yScales: s.yScales || null,
            smoothLevel: s.smoothLevel || 0,
            showZeroLine: s.showZeroLine || null,
            chart: null,
          };
          if (mod.type === 'chart' && mod.channels) {
            if (isCompare && mod.sessionIdx != null) {
              mod.channels = mod.channels.filter(function (n) { return channelExistsInSession(n, mod.sessionIdx); });
            } else {
              mod.channels = mod.channels.filter(function (n) { return channelExists(n); });
            }
          }
          modules.push(mod);
          createModuleDOM(mod);
          buildModuleContent(mod);
        });
      } else if (isCompare) {
        compareSessions.forEach(function (sess, si) {
          var channels = defaultCompareChannels(si);
          var mod = {
            type: 'chart',
            id: 'mod' + (nextModId++),
            width: 'full',
            height: 220,
            channels: channels,
            sessionIdx: si,
            yGroups: null,
            yScales: null,
            chart: null,
          };
          modules.push(mod);
          createModuleDOM(mod);
          buildModuleContent(mod);
        });
        var readoutMod = {
          type: 'readout', id: 'mod' + (nextModId++),
          width: 'half', height: 300, channels: null, chart: null,
        };
        modules.push(readoutMod);
        createModuleDOM(readoutMod);
        buildModuleContent(readoutMod);
      } else {
        DEFAULT_LAYOUT.forEach(function (preset) {
          var id = 'mod' + (nextModId++);
          var channels = null;
          if (preset.type === 'chart' && preset.channels) {
            channels = preset.channels.filter(function (n) { return channelExists(n); });
            if (!channels.length) channels = defaultChannels(4);
          }
          var mod = {
            type: preset.type,
            id: id,
            width: preset.width || 'full',
            height: preset.height || 200,
            channels: channels,
            yGroups: null,
            yScales: null,
            chart: null,
          };
          modules.push(mod);
          createModuleDOM(mod);
          buildModuleContent(mod);
        });
      }
      updateAddBtnVisibility();
    }

    _loadLayoutFromServer(_applyLayout);

    /* ---- Template API (exposed to global scope) ---- */
    window._dashGetLayout = function () {
      return modules.map(function (m) {
        var o = { type: m.type, width: m.width, height: m.height };
        if (m.channels) o.channels = m.channels.slice();
        if (m.yGroups) o.yGroups = m.yGroups;
        if (m.yScales) o.yScales = m.yScales;
        if (m.smoothLevel) o.smoothLevel = m.smoothLevel;
        if (m.showZeroLine) o.showZeroLine = m.showZeroLine;
        return o;
      });
    };

    window._dashApplyLayout = function (state) {
      modules.forEach(function (m) {
        if (m.chart) m.chart.destroy();
        destroyMapInstance(m);
        var el = document.getElementById('module-' + m.id);
        if (el) el.remove();
      });
      modules.length = 0;
      state.forEach(function (s) {
        var id = 'mod' + (nextModId++);
        var channels = null;
        if (s.type === 'chart' && s.channels) {
          channels = s.channels.filter(function (n) { return channelExists(n); });
          if (!channels.length) channels = defaultChannels(4);
        }
        var mod = {
          type: s.type || 'chart',
          id: id,
          width: s.width || 'full',
          height: s.height || 200,
          channels: channels,
          sessionIdx: isCompare ? 0 : undefined,
          yGroups: s.yGroups || null,
          yScales: s.yScales || null,
          smoothLevel: s.smoothLevel || 0,
          showZeroLine: s.showZeroLine || null,
          chart: null,
        };
        modules.push(mod);
        createModuleDOM(mod);
        buildModuleContent(mod);
      });
      updateAddBtnVisibility();
      saveLayout();
    };
  }

  window.initDashboard = initDashboard;
})();
