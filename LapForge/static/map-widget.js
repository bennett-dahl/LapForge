/**
 * Leaflet track map with CursorSync: polyline, sections, lap markers, click-to-seek.
 * Requires Leaflet CSS/JS and window.CursorSync (load cursor-sync.js first).
 */
(function () {
  function resolveContainer(container) {
    if (!container) return null;
    if (typeof container === 'string') {
      return document.getElementById(container) || document.querySelector(container);
    }
    return container;
  }

  function closestPointOnSegmentLatLng(p, a, b) {
    var ax = a.lat;
    var ay = a.lng;
    var bx = b.lat;
    var by = b.lng;
    var px = p.lat;
    var py = p.lng;
    var abx = bx - ax;
    var aby = by - ay;
    var apx = px - ax;
    var apy = py - ay;
    var ab2 = abx * abx + aby * aby;
    var t = ab2 > 0 ? (apx * abx + apy * aby) / ab2 : 0;
    t = Math.max(0, Math.min(1, t));
    return L.latLng(ax + t * abx, ay + t * aby);
  }

  function nearestPointOnPolyline(latlng, polyline, distances) {
    var bestDist = Infinity;
    var bestLatLng = null;
    var bestDistanceAlong = 0;
    var n = polyline.length;
    if (n < 2) {
      if (n === 1) {
        return {
          latlng: L.latLng(polyline[0]),
          distanceAlong: distances[0] != null ? distances[0] : 0,
        };
      }
      return { latlng: latlng, distanceAlong: 0 };
    }
    for (var i = 0; i < n - 1; i++) {
      var a = L.latLng(polyline[i]);
      var b = L.latLng(polyline[i + 1]);
      var p = closestPointOnSegmentLatLng(latlng, a, b);
      var d = latlng.distanceTo(p);
      if (d < bestDist) {
        bestDist = d;
        bestLatLng = p;
        var segLen = a.distanceTo(b);
        var frac = segLen > 0 ? a.distanceTo(p) / segLen : 0;
        var d0 = distances[i] != null ? distances[i] : 0;
        var d1 = distances[i + 1] != null ? distances[i + 1] : d0;
        bestDistanceAlong = d0 + frac * (d1 - d0);
      }
    }
    return { latlng: bestLatLng, distanceAlong: bestDistanceAlong };
  }

  function positionFromDistance(d, polyline, distances, heading) {
    var n = polyline.length;
    if (!n) return { latlng: null, heading: null };
    if (n === 1) {
      return {
        latlng: L.latLng(polyline[0]),
        heading: heading && heading[0] != null ? heading[0] : null,
      };
    }
    var dists = distances;
    if (!dists || dists.length !== n) {
      dists = [];
      for (var j = 0; j < n; j++) dists.push(j);
    }
    if (d <= dists[0]) {
      return {
        latlng: L.latLng(polyline[0]),
        heading: heading && heading[0] != null ? heading[0] : null,
      };
    }
    if (d >= dists[n - 1]) {
      return {
        latlng: L.latLng(polyline[n - 1]),
        heading: heading && heading[n - 1] != null ? heading[n - 1] : null,
      };
    }
    var i = 0;
    for (; i < n - 1 && dists[i + 1] < d; i++) {}
    var d0 = dists[i];
    var d1 = dists[i + 1];
    var frac = d1 > d0 ? (d - d0) / (d1 - d0) : 0;
    var lat0 = polyline[i][0];
    var lon0 = polyline[i][1];
    var lat1 = polyline[i + 1][0];
    var lon1 = polyline[i + 1][1];
    var lat = lat0 + frac * (lat1 - lat0);
    var lon = lon0 + frac * (lon1 - lon0);
    var h = null;
    if (heading && heading[i] != null && heading[i + 1] != null) {
      h = heading[i] + frac * (heading[i + 1] - heading[i]);
    } else if (heading && heading[i] != null) {
      h = heading[i];
    }
    return { latlng: L.latLng(lat, lon), heading: h };
  }

  function cumulativeDistancesMeters(polyline) {
    var out = [0];
    var sum = 0;
    for (var i = 0; i < polyline.length - 1; i++) {
      sum += L.latLng(polyline[i]).distanceTo(L.latLng(polyline[i + 1]));
      out.push(sum);
    }
    return out;
  }

  /**
   * Chaikin's corner-cutting: for each pair of consecutive points, replace
   * with two new points at 25% and 75% along the segment.  Repeating this
   * rounds out sharp corners while preserving the overall shape.
   */
  function chaikinSmooth(pts, iterations) {
    if (!pts || pts.length < 3) return pts;
    var line = pts;
    for (var iter = 0; iter < (iterations || 3); iter++) {
      var next = [line[0]];
      for (var i = 0; i < line.length - 1; i++) {
        var a = line[i], b = line[i + 1];
        next.push([
          a[0] * 0.75 + b[0] * 0.25,
          a[1] * 0.75 + b[1] * 0.25,
        ]);
        next.push([
          a[0] * 0.25 + b[0] * 0.75,
          a[1] * 0.25 + b[1] * 0.75,
        ]);
      }
      next.push(line[line.length - 1]);
      line = next;
    }
    return line;
  }

  function createTrackMap(container, config) {
    if (typeof L === 'undefined') {
      throw new Error('createTrackMap: Leaflet (L) required');
    }
    if (!window.CursorSync) {
      throw new Error('createTrackMap: window.CursorSync required');
    }

    var el = resolveContainer(container);
    if (!el) {
      throw new Error('createTrackMap: container element not found');
    }

    var cfg = config || {};
    var polyline = cfg.polyline || [];
    var heading = cfg.heading || null;
    var lapSplits = cfg.lapSplits || [];
    var sections = cfg.sections || [];
    var distances = cfg.distances || [];
    if (
      polyline.length &&
      (!distances.length || distances.length !== polyline.length)
    ) {
      distances = cumulativeDistancesMeters(polyline);
    }

    var map = L.map(el, { zoomControl: true });

    var streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    });
    var satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: '&copy; Esri &mdash; Esri, Maxar, Earthstar Geographics',
      maxZoom: 19,
    });

    streets.addTo(map);
    L.control.layers({ 'Streets': streets, 'Satellite': satellite }, null, { position: 'topright' }).addTo(map);

    var smoothed = chaikinSmooth(polyline, 5);
    var layers = [];
    var baseLine = null;

    var TRACK_COLORS = [
      { name: 'Red',    hex: '#ef4444' },
      { name: 'Blue',   hex: '#3b82f6' },
      { name: 'Green',  hex: '#22c55e' },
      { name: 'Yellow', hex: '#eab308' },
      { name: 'Orange', hex: '#f97316' },
      { name: 'Cyan',   hex: '#06b6d4' },
      { name: 'Pink',   hex: '#ec4899' },
      { name: 'White',  hex: '#ffffff' },
      { name: 'Grey',   hex: '#52525b' },
    ];
    var savedColor = null;
    try { savedColor = localStorage.getItem('map_track_color'); } catch (e) {}
    var defaultColor = savedColor || '#ef4444';

    if (polyline.length) {
      var baseOpts = {
        color: defaultColor,
        weight: 4,
        opacity: 0.85,
        lineCap: 'round',
        lineJoin: 'round',
      };
      baseLine = L.polyline(smoothed, baseOpts).addTo(map);
      layers.push(baseLine);
    }

    var ColorControl = L.Control.extend({
      options: { position: 'topright' },
      onAdd: function () {
        var container = L.DomUtil.create('div', 'leaflet-bar leaflet-control map-color-ctrl');
        var sel = L.DomUtil.create('select', '', container);
        sel.title = 'Track line color';
        TRACK_COLORS.forEach(function (c) {
          var opt = document.createElement('option');
          opt.value = c.hex;
          opt.textContent = c.name;
          opt.style.color = c.hex;
          if (c.hex === defaultColor) opt.selected = true;
          sel.appendChild(opt);
        });
        sel.style.cssText = 'font-size:12px;padding:2px 4px;border:none;border-radius:2px;background:#1a1a1e;color:#e4e4e7;cursor:pointer;outline:none;';
        L.DomEvent.disableClickPropagation(container);
        sel.addEventListener('change', function () {
          var hex = sel.value;
          if (baseLine) baseLine.setStyle({ color: hex });
          try { localStorage.setItem('map_track_color', hex); } catch (e) {}
        });
        return container;
      },
    });
    new ColorControl().addTo(map);

    if (sections.length && polyline.length) {
      sections.forEach(function (sec) {
        var start = Math.max(0, sec.startIdx | 0);
        var end = Math.min(polyline.length - 1, sec.endIdx | 0);
        if (end <= start) return;
        var slice = chaikinSmooth(polyline.slice(start, end + 1), 5);
        if (slice.length < 2) return;
        var seg = L.polyline(slice, {
          color: sec.color || '#3b82f6',
          weight: 5,
          opacity: 0.9,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(map);
        layers.push(seg);
      });
    }

    lapSplits.forEach(function (idx) {
      if (idx < 0 || idx >= polyline.length) return;
      var pt = polyline[idx];
      L.circleMarker([pt[0], pt[1]], {
        radius: 5,
        color: 'rgba(148, 163, 184, 0.9)',
        weight: 2,
        fillColor: '#1a1a1e',
        fillOpacity: 0.85,
      }).addTo(map);
    });

    var markerLatLng = polyline.length ? L.latLng(polyline[0]) : map.getCenter();
    var cursorMarker = L.circleMarker(markerLatLng, {
      radius: 8,
      color: 'rgba(255, 255, 255, 0.9)',
      weight: 2,
      fillColor: '#3b82f6',
      fillOpacity: 1,
    }).addTo(map);

    function applyMarkerFromDistance(d, showMarker) {
      if (d == null || !isFinite(d) || !polyline.length) return;
      var pos = positionFromDistance(d, polyline, distances, heading);
      if (!pos.latlng) return;
      if (showMarker) {
        cursorMarker.setStyle({ opacity: 1, fillOpacity: 1 });
      }
      cursorMarker.setLatLng(pos.latlng);
    }

    var syncHandler = function (state) {
      var d = (state.mapDistance != null && isFinite(state.mapDistance))
        ? state.mapDistance
        : state.distance;
      if (d == null || !isFinite(d)) {
        cursorMarker.setStyle({ opacity: 0, fillOpacity: 0 });
        return;
      }
      applyMarkerFromDistance(d, true);
    };

    window.CursorSync.subscribe(syncHandler);
    var initial = window.CursorSync.get();
    var initD = (initial.mapDistance != null && isFinite(initial.mapDistance))
      ? initial.mapDistance : initial.distance;
    if (initD != null && isFinite(initD)) {
      applyMarkerFromDistance(initD, true);
    }

    function onMapClick(e) {
      if (!polyline.length) return;
      var near = nearestPointOnPolyline(e.latlng, polyline, distances);
      window.CursorSync.set({ distance: near.distanceAlong });
    }

    map.on('click', onMapClick);

    if (polyline.length) {
      map.fitBounds(L.latLngBounds(polyline), { padding: [24, 24] });
    } else {
      map.setView([0, 0], 2);
    }

    return {
      map: map,
      updateMarker: function (distance) {
        applyMarkerFromDistance(distance, true);
      },
      destroy: function () {
        window.CursorSync.unsubscribe(syncHandler);
        map.off('click', onMapClick);
        map.remove();
        if (el) el.innerHTML = '';
      },
    };
  }

  window.createTrackMap = createTrackMap;
  window.chaikinSmooth = chaikinSmooth;
})();
