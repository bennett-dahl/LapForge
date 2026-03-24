/**
 * Global cursor state: shared distance/time for charts and map.
 * Load before telemetry-chart.js and map-widget.js.
 */
(function () {
  const CursorSync = {
    _listeners: [],
    _distance: null,
    _time: null,
    _mapDistance: null,

    subscribe: function (fn) {
      if (typeof fn !== 'function') return;
      if (this._listeners.indexOf(fn) === -1) this._listeners.push(fn);
    },

    unsubscribe: function (fn) {
      this._listeners = this._listeners.filter(function (l) {
        return l !== fn;
      });
    },

    set: function (state) {
      if (!state || typeof state !== 'object') return;
      if (Object.prototype.hasOwnProperty.call(state, 'distance')) {
        this._distance = state.distance;
      }
      if (Object.prototype.hasOwnProperty.call(state, 'time')) {
        this._time = state.time;
      }
      if (Object.prototype.hasOwnProperty.call(state, 'mapDistance')) {
        this._mapDistance = state.mapDistance;
      }
      this._notify();
    },

    get: function () {
      return { distance: this._distance, time: this._time, mapDistance: this._mapDistance };
    },

    clear: function () {
      this._distance = null;
      this._time = null;
      this._mapDistance = null;
      this._notify();
    },

    _notify: function () {
      var payload = { distance: this._distance, time: this._time, mapDistance: this._mapDistance };
      this._listeners.slice().forEach(function (fn) {
        try {
          fn(payload);
        } catch (e) {
          console.error('CursorSync listener error', e);
        }
      });
    },
  };

  window.CursorSync = CursorSync;
})();
