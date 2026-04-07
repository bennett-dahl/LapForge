"""Tests for LapForge.processing — pipeline steps and full pipeline execution."""

from __future__ import annotations

import math
from typing import Any

import pytest

from LapForge.processing import (
    BAR_TO_PSI,
    CHART_MAX_POINTS,
    DEFAULT_TARGET_PSI,
    PIPELINE_VERSION,
    _smooth_linear_regression,
    build_reference_lap,
    build_summary,
    compute_derived,
    compute_distance,
    downsample_for_charts,
    needs_reprocess,
    normalize_channels,
    patch_pressure_summaries,
    pressure_lap_band_summary,
    process_session,
    sanitize_for_json,
    smooth_pressure,
    stale_stages,
)


def _make_parsed(
    n_rows: int = 100,
    include_gps: bool = False,
    include_speed: bool = True,
    n_laps: int = 2,
) -> dict[str, Any]:
    """Build a synthetic parsed data dict for testing pipeline steps."""
    lap_len = n_rows // n_laps if n_laps > 0 else n_rows
    rows = []
    lap_split_times = [0.0]
    columns = ["Time", "laptime", "tpms_press_fl", "tpms_press_fr"]
    if include_speed:
        columns.append("speed")
    if include_gps:
        columns.extend(["lat", "lon"])

    current_lap_time = 0.0
    for i in range(n_rows):
        t = round(i * 0.02, 4)
        lap_idx = i // lap_len if lap_len > 0 else 0

        if i > 0 and i % lap_len == 0 and n_laps > 1:
            current_lap_time = 0.0
            lap_split_times.append(t)
        else:
            current_lap_time = round(current_lap_time + 0.02, 4)

        row: dict[str, Any] = {
            "Time": t,
            "laptime": current_lap_time,
            "tpms_press_fl": 1.80 + 0.001 * i,
            "tpms_press_fr": 1.82 + 0.001 * i,
            "lap_index": lap_idx,
        }
        if include_speed:
            row["speed"] = 50.0 + i * 0.5
        if include_gps:
            row["lat"] = 36.25 + i * 0.0001
            row["lon"] = -115.15 + i * 0.0001
        rows.append(row)

    return {
        "rows": rows,
        "columns": columns,
        "lap_split_times": lap_split_times,
        "pressure_columns": ["tpms_press_fl", "tpms_press_fr"],
        "metadata": {"DriverName": "Test", "TrackName": "Test Track"},
    }


class TestSmoothLinearRegression:
    def test_constant_signal(self):
        vals = [5.0] * 20
        result = _smooth_linear_regression(vals, half_window=3)
        for v in result:
            assert v == pytest.approx(5.0, abs=0.01)

    def test_linear_signal(self):
        vals = [float(i) for i in range(20)]
        result = _smooth_linear_regression(vals, half_window=3)
        for i, v in enumerate(result):
            assert v == pytest.approx(float(i), abs=0.5)

    def test_handles_none_values(self):
        vals = [1.0, None, 3.0, None, 5.0]
        result = _smooth_linear_regression(vals, half_window=1)
        assert len(result) == 5
        assert result[1] is not None  # should interpolate


class TestNormalizeChannels:
    def test_extracts_columns(self):
        parsed = _make_parsed(n_rows=10)
        ctx: dict[str, Any] = {"parsed": parsed}
        normalize_channels(ctx)

        assert "full_times" in ctx
        assert len(ctx["full_times"]) == 10
        assert "tpms_press_fl" in ctx["full_series"]
        assert "channel_meta" in ctx
        assert ctx["channel_meta"]["tpms_press_fl"]["category"] == "pressure"

    def test_empty_rows(self):
        ctx: dict[str, Any] = {"parsed": {"rows": []}}
        normalize_channels(ctx)
        assert ctx["full_times"] == []
        assert ctx["full_series"] == {}


class TestComputeDistance:
    def test_from_speed(self):
        parsed = _make_parsed(n_rows=50, include_speed=True)
        ctx: dict[str, Any] = {"parsed": parsed}
        normalize_channels(ctx)
        compute_distance(ctx)

        assert "full_distances" in ctx
        assert len(ctx["full_distances"]) == 50
        assert ctx["full_distances"][0] == 0.0
        assert ctx["full_distances"][-1] >= 0.0

    def test_no_speed_zeros(self):
        parsed = _make_parsed(n_rows=10, include_speed=False)
        ctx: dict[str, Any] = {"parsed": parsed}
        normalize_channels(ctx)
        compute_distance(ctx)

        assert all(d == 0.0 for d in ctx["full_distances"])


class TestSmoothPressure:
    def test_applies_smoothing(self):
        parsed = _make_parsed(n_rows=200)
        ctx: dict[str, Any] = {"parsed": parsed, "smoothing_level": 0}
        normalize_channels(ctx)

        original = list(ctx["full_series"]["tpms_press_fl"])
        smooth_pressure(ctx)

        assert "raw_pressure" in ctx
        assert ctx["raw_pressure"]["tpms_press_fl"] == original
        # Smoothed values should differ from originals for noisy/changing data
        smoothed = ctx["full_series"]["tpms_press_fl"]
        assert len(smoothed) == len(original)


class TestDownsampleForCharts:
    def test_reduces_points(self):
        parsed = _make_parsed(n_rows=8000)
        ctx: dict[str, Any] = {"parsed": parsed, "smoothing_level": 0}
        normalize_channels(ctx)
        compute_distance(ctx)
        smooth_pressure(ctx)
        downsample_for_charts(ctx)

        assert len(ctx["times"]) < 8000
        assert len(ctx["distances"]) < 8000
        for vals in ctx["series"].values():
            assert len(vals) < 8000

    def test_small_dataset_no_reduction(self):
        parsed = _make_parsed(n_rows=50)
        ctx: dict[str, Any] = {"parsed": parsed, "smoothing_level": 0}
        normalize_channels(ctx)
        compute_distance(ctx)
        smooth_pressure(ctx)
        downsample_for_charts(ctx)

        assert len(ctx["times"]) == 50


class TestBuildSummary:
    def test_produces_summary(self):
        parsed = _make_parsed(n_rows=100)
        ctx: dict[str, Any] = {"parsed": parsed, "smoothing_level": 0,
                                "target_psi": DEFAULT_TARGET_PSI}
        normalize_channels(ctx)
        compute_distance(ctx)
        compute_derived(ctx)
        smooth_pressure(ctx)
        downsample_for_charts(ctx)
        build_reference_lap(ctx)
        build_summary(ctx)

        summary = ctx["summary"]
        assert "lap_count" in summary
        assert summary["lap_count"] >= 1
        assert "pressure_summary_psi" in summary
        assert "pressure_summary_bar" in summary

    def test_pressure_summary_fields(self):
        parsed = _make_parsed(n_rows=100)
        ctx: dict[str, Any] = {"parsed": parsed, "smoothing_level": 0,
                                "target_psi": DEFAULT_TARGET_PSI}
        normalize_channels(ctx)
        compute_distance(ctx)
        compute_derived(ctx)
        smooth_pressure(ctx)
        downsample_for_charts(ctx)
        build_reference_lap(ctx)
        build_summary(ctx)

        ps = ctx["summary"]["pressure_summary_psi"]
        assert ps["unit"] == "psi"
        assert "global_min" in ps
        assert "global_max" in ps
        assert "target" in ps
        assert ps["global_min"] <= ps["global_max"]


class TestProcessSession:
    def test_full_pipeline(self, sample_parsed):
        result = process_session(sample_parsed)
        assert result["processed"] is True
        assert result["version"] == 2
        assert result["pipeline_version"] == PIPELINE_VERSION
        assert "times" in result
        assert "series" in result
        assert "summary" in result
        assert "channel_meta" in result

    def test_with_target_psi(self, sample_parsed):
        result = process_session(sample_parsed, target_psi=25.0)
        ps = result["summary"]["pressure_summary_psi"]
        assert ps["target"] == 25.0

    def test_with_smoothing_level(self, sample_parsed):
        result = process_session(sample_parsed, smoothing_level=2)
        assert result["smoothing_level"] == 2

    def test_progress_callback(self, sample_parsed):
        progress = []
        process_session(sample_parsed, progress_cb=lambda p: progress.append(p))
        assert len(progress) > 0
        assert progress[-1] == 100


class TestSanitizeForJson:
    def test_nan_replaced(self):
        assert sanitize_for_json(float("nan")) is None

    def test_inf_replaced(self):
        assert sanitize_for_json(float("inf")) is None

    def test_nested_dict(self):
        data = {"a": float("nan"), "b": [1.0, float("inf"), None]}
        result = sanitize_for_json(data)
        assert result["a"] is None
        assert result["b"] == [1.0, None, None]

    def test_normal_values_pass_through(self):
        assert sanitize_for_json(42) == 42
        assert sanitize_for_json("hello") == "hello"
        assert sanitize_for_json(3.14) == 3.14


class TestStaleStages:
    def test_none_blob(self):
        stale = stale_stages(None)
        assert len(stale) > 0  # all stages are stale

    def test_current_blob_not_stale(self, sample_parsed):
        result = process_session(sample_parsed)
        assert stale_stages(result) == []

    def test_modified_version_stale(self, sample_parsed):
        result = process_session(sample_parsed)
        sv = result["stage_versions"]
        sv["core"] = sv["core"] - 1
        stale = stale_stages(result)
        assert "core" in stale


class TestNeedsReprocess:
    def test_none(self):
        assert needs_reprocess(None) is True

    def test_current(self, sample_parsed):
        result = process_session(sample_parsed)
        assert needs_reprocess(result) is False

    def test_old_pipeline_version(self, sample_parsed):
        result = process_session(sample_parsed)
        result["pipeline_version"] = 0
        assert needs_reprocess(result) is True


class TestMapLapPersistence:
    def test_existing_blob_preserves_user_map_lap(self, sample_parsed):
        first = process_session(sample_parsed)
        splits = first.get("lap_splits") or []
        assert len(splits) >= 2
        n_seg = len(splits) - 1
        chosen = None
        for i in range(n_seg):
            if splits[i + 1] - splits[i] > 0:
                chosen = i
                break
        assert chosen is not None
        blob = dict(first)
        blob["map_lap_segment_index"] = chosen
        second = process_session(sample_parsed, existing_blob=blob)
        assert second.get("map_lap_segment_index") == chosen
        assert second.get("reference_lap", {}).get("lap_index") == chosen

    def test_invalid_map_lap_index_not_in_output(self, sample_parsed):
        first = process_session(sample_parsed)
        blob = dict(first)
        blob["map_lap_segment_index"] = 99999
        second = process_session(sample_parsed, existing_blob=blob)
        assert "map_lap_segment_index" not in second


class TestPatchPressureSummaries:
    def test_updates_target(self, sample_parsed):
        result = process_session(sample_parsed)
        patch_pressure_summaries(result, 25.0)
        assert result["summary"]["pressure_summary_psi"]["target"] == 25.0

    def test_bar_summary_updated(self, sample_parsed):
        result = process_session(sample_parsed)
        patch_pressure_summaries(result, 25.0)
        bar_target = result["summary"]["pressure_summary_bar"]["target"]
        assert bar_target == pytest.approx(25.0 / BAR_TO_PSI, rel=1e-3)


# ---------------------------------------------------------------------------
# pressure_lap_band_summary tests
# ---------------------------------------------------------------------------

class TestPressureLapBandSummary:
    """Tests for the worst-corner lap-band summary function."""

    @staticmethod
    def _build(corner_psi_per_lap: dict[str, list[float]]):
        """Helper: build times/series/splits for given per-corner per-lap PSI values.

        corner_psi_per_lap: {"fl": [20.0, 20.5, 21.0], ...}
        Each list index = one lap with one sample per lap (converted to bar).
        bisect_right on lap_splits maps time i+0.5 to lap i+1.
        """
        n_laps = max(len(v) for v in corner_psi_per_lap.values())
        lap_splits = [float(i) for i in range(n_laps)]
        times = [float(i) + 0.5 for i in range(n_laps)]
        series: dict[str, list[float | None]] = {}
        col_map = {"fl": "tpms_press_fl", "fr": "tpms_press_fr",
                    "rl": "tpms_press_rl", "rr": "tpms_press_rr"}
        pressure_cols = []
        for corner, col_name in col_map.items():
            psi_vals = corner_psi_per_lap.get(corner, [])
            series[col_name] = [v / BAR_TO_PSI for v in psi_vals]
            pressure_cols.append(col_name)
        return times, series, pressure_cols, lap_splits

    def test_all_in_optimal(self):
        data = {"fl": [20.0, 20.1], "fr": [20.0, 20.1],
                "rl": [20.0, 20.1], "rr": [20.0, 20.1]}
        times, series, pcols, splits = self._build(data)
        result = pressure_lap_band_summary(
            times, series, pcols, splits,
            target_psi=20.0, acceptable_psi=0.5, optimal_psi=0.25,
            lap_start=1, lap_end=2,
        )
        assert result["first_acceptable_lap"] == 1
        assert result["last_acceptable_lap"] == 2
        assert result["first_optimal_lap"] == 1
        assert result["last_optimal_lap"] == 2
        assert result["laps_outside_optimal_after_entry"] == 0

    def test_never_in_optimal(self):
        data = {"fl": [21.0, 21.5], "fr": [21.0, 21.5],
                "rl": [21.0, 21.5], "rr": [21.0, 21.5]}
        times, series, pcols, splits = self._build(data)
        result = pressure_lap_band_summary(
            times, series, pcols, splits,
            target_psi=20.0, acceptable_psi=0.5, optimal_psi=0.25,
            lap_start=1, lap_end=2,
        )
        assert result["first_optimal_lap"] is None
        assert result["last_optimal_lap"] is None
        assert result["laps_outside_optimal_after_entry"] is None

    def test_laps_outside_optimal_after_entry(self):
        # Laps: 1=FL@21 (out), 2=FL@20.1 (optimal), 3=FL@20.8 (out), 4=FL@20.0 (optimal)
        data = {"fl": [21.0, 20.1, 20.8, 20.0], "fr": [20.0, 20.1, 20.0, 20.0],
                "rl": [20.0, 20.1, 20.0, 20.0], "rr": [20.0, 20.1, 20.0, 20.0]}
        times, series, pcols, splits = self._build(data)
        result = pressure_lap_band_summary(
            times, series, pcols, splits,
            target_psi=20.0, acceptable_psi=1.0, optimal_psi=0.25,
            lap_start=1, lap_end=4,
        )
        assert result["first_optimal_lap"] == 2
        assert result["laps_outside_optimal_after_entry"] == 1

    def test_single_lap_window(self):
        data = {"fl": [20.0, 20.0, 20.0], "fr": [20.0, 20.0, 20.0],
                "rl": [20.0, 20.0, 20.0], "rr": [20.0, 20.0, 20.0]}
        times, series, pcols, splits = self._build(data)
        result = pressure_lap_band_summary(
            times, series, pcols, splits,
            target_psi=20.0, acceptable_psi=0.5, optimal_psi=0.25,
            lap_start=1, lap_end=1,
        )
        assert result["first_acceptable_lap"] == 1
        assert result["last_acceptable_lap"] == 1
        assert result["first_optimal_lap"] == 1
        assert result["last_optimal_lap"] == 1
        assert result["laps_outside_optimal_after_entry"] == 0

    def test_empty_data(self):
        result = pressure_lap_band_summary(
            [], {}, [], [],
            target_psi=20.0, acceptable_psi=0.5, optimal_psi=0.25,
            lap_start=1, lap_end=3,
        )
        assert result["first_acceptable_lap"] is None
        assert result["laps_outside_optimal_after_entry"] is None

    def test_psi_channels_only(self):
        """Sessions with _psi channels (data already in PSI) should work correctly."""
        n_laps = 2
        lap_splits = [float(i) for i in range(n_laps)]
        times = [float(i) + 0.5 for i in range(n_laps)]
        series = {
            "tpms_press_fl_psi": [20.0, 20.1],
            "tpms_press_fr_psi": [20.0, 20.1],
            "tpms_press_rl_psi": [20.0, 20.1],
            "tpms_press_rr_psi": [20.0, 20.1],
        }
        pcols = list(series.keys())
        result = pressure_lap_band_summary(
            times, series, pcols, lap_splits,
            target_psi=20.0, acceptable_psi=0.5, optimal_psi=0.25,
            lap_start=1, lap_end=2,
        )
        assert result["first_optimal_lap"] == 1
        assert result["last_optimal_lap"] == 2
        assert result["laps_outside_optimal_after_entry"] == 0

    def test_mixed_bar_and_psi_channels(self):
        """When both bar and _psi channels exist for the same corner, only one is used."""
        n_laps = 2
        lap_splits = [float(i) for i in range(n_laps)]
        times = [float(i) + 0.5 for i in range(n_laps)]
        series = {
            "tpms_press_fl": [20.0 / BAR_TO_PSI, 20.1 / BAR_TO_PSI],
            "tpms_press_fl_psi": [20.0, 20.1],
            "tpms_press_fr": [20.0 / BAR_TO_PSI, 20.1 / BAR_TO_PSI],
            "tpms_press_fr_psi": [20.0, 20.1],
            "tpms_press_rl": [20.0 / BAR_TO_PSI, 20.1 / BAR_TO_PSI],
            "tpms_press_rl_psi": [20.0, 20.1],
            "tpms_press_rr": [20.0 / BAR_TO_PSI, 20.1 / BAR_TO_PSI],
            "tpms_press_rr_psi": [20.0, 20.1],
        }
        pcols = list(series.keys())
        result = pressure_lap_band_summary(
            times, series, pcols, lap_splits,
            target_psi=20.0, acceptable_psi=0.5, optimal_psi=0.25,
            lap_start=1, lap_end=2,
        )
        assert result["first_optimal_lap"] == 1
        assert result["last_optimal_lap"] == 2

    def test_worst_corner_rule(self):
        """One corner out of band on lap 1 → whole lap is not in band."""
        data = {"fl": [20.0, 20.0], "fr": [20.0, 20.0],
                "rl": [20.0, 20.0], "rr": [22.0, 20.0]}
        times, series, pcols, splits = self._build(data)
        result = pressure_lap_band_summary(
            times, series, pcols, splits,
            target_psi=20.0, acceptable_psi=0.5, optimal_psi=0.25,
            lap_start=1, lap_end=2,
        )
        assert result["first_acceptable_lap"] == 2
        assert result["first_optimal_lap"] == 2
