"""Tests for LapForge.parsers.pi_toolbox_export — file parsing, lap detection, conversions."""

from pathlib import Path

import pytest

from LapForge.parsers.pi_toolbox_export import (
    BAR_TO_PSI,
    bar_to_psi,
    load_pi_toolbox_export,
    parse_channel_block,
    parse_outing_information,
    psi_to_bar,
    read_file_metadata,
    _canonical_name,
    _parse_float,
)


FIXTURES = Path(__file__).resolve().parent / "fixtures"


class TestCanonicalName:
    def test_strip_star(self):
        assert _canonical_name("*Time [s]") == "Time"

    def test_strip_unit(self):
        assert _canonical_name("tpms_press_fl [bar]") == "tpms_press_fl"

    def test_star_and_unit(self):
        assert _canonical_name("*speed [km/h]") == "speed"

    def test_plain_name(self):
        assert _canonical_name("gear") == "gear"

    def test_whitespace(self):
        assert _canonical_name("  *foo [bar]  ") == "foo"


class TestParseFloat:
    def test_valid(self):
        assert _parse_float("1.23") == 1.23
        assert _parse_float("0") == 0.0

    def test_empty(self):
        assert _parse_float("") is None

    def test_nan_variants(self):
        assert _parse_float("nan") is None
        assert _parse_float("-nan(ind)") is None
        assert _parse_float("NaN") is None

    def test_inf(self):
        assert _parse_float("inf") is None
        assert _parse_float("-inf") is None

    def test_invalid(self):
        assert _parse_float("abc") is None


class TestParseOutingInformation:
    def test_basic(self):
        lines = [
            "DriverName\tAlice\n",
            "CarName\t911\n",
            "TrackName\tLaguna Seca\n",
        ]
        result = parse_outing_information(lines)
        assert result["DriverName"] == "Alice"
        assert result["CarName"] == "911"
        assert result["TrackName"] == "Laguna Seca"

    def test_skips_block_markers(self):
        lines = [
            "{OutingInformation}\n",
            "DriverName\tBob\n",
        ]
        result = parse_outing_information(lines)
        assert result["DriverName"] == "Bob"

    def test_empty(self):
        assert parse_outing_information([]) == {}


class TestParseChannelBlock:
    def test_basic_parsing(self):
        header = "*Time [s]\t*laptime [s]\t*speed [km/h]"
        data = [
            "0.00\t0.00\t50.0",
            "0.02\t0.02\t55.0",
        ]
        cols, rows, splits = parse_channel_block(header, data)
        assert "Time" in cols
        assert "speed" in cols
        assert len(rows) == 2
        assert rows[0]["speed"] == 50.0
        assert rows[1]["Time"] == 0.02

    def test_lap_detection(self):
        header = "*Time [s]\t*laptime [s]"
        data = [
            "0.00\t0.00",
            "30.00\t30.00",
            "60.00\t60.00",
            "60.02\t0.02",  # lap reset
            "90.00\t29.98",
        ]
        cols, rows, splits = parse_channel_block(header, data)
        assert len(splits) == 2
        assert splits[0] == 0.0
        assert splits[1] == 60.02
        assert rows[0]["lap_index"] == 0
        assert rows[3]["lap_index"] == 1

    def test_missing_values(self):
        header = "*Time [s]\t*laptime [s]\t*speed [km/h]"
        data = [
            "0.00\t0.00",  # speed column missing
        ]
        cols, rows, _ = parse_channel_block(header, data)
        assert rows[0]["speed"] is None


class TestLoadPiToolboxExport:
    def test_load_sample_file(self):
        path = FIXTURES / "sample_export.txt"
        result = load_pi_toolbox_export(path)

        assert result["metadata"]["DriverName"] == "Test Driver"
        assert result["metadata"]["TrackName"] == "Test Track"
        assert "tpms_press_fl" in result["columns"]
        assert len(result["rows"]) > 0
        assert len(result["pressure_columns"]) == 4
        assert len(result["lap_split_times"]) >= 2  # at least 2 lap boundaries

    def test_psi_conversion(self):
        path = FIXTURES / "sample_export.txt"
        result = load_pi_toolbox_export(path)
        row = result["rows"][0]
        bar_val = row["tpms_press_fl"]
        psi_val = row["tpms_press_fl_psi"]
        assert psi_val == pytest.approx(bar_val * BAR_TO_PSI, rel=1e-3)

    def test_tpms_psi_header_stores_bar_and_psi(self, tmp_path):
        """[psi] in header must not leave PSI magnitudes under tpms_press_* (bar key)."""
        f = tmp_path / "psi_tpms.txt"
        f.write_text(
            "PiToolboxVersionedASCIIDataSet\t1\n"
            "{OutingInformation}\nDriverName\tX\n"
            "{ChannelBlock}\n"
            "*Time [s]\t*laptime [s]\t*tpms_press_fl [psi]\t*speed [km/h]\n"
            "0.00\t0.00\t26.0\t0.0\n",
            encoding="utf-8",
        )
        result = load_pi_toolbox_export(f)
        row = result["rows"][0]
        assert row["tpms_press_fl_psi"] == pytest.approx(26.0, rel=1e-3)
        assert row["tpms_press_fl"] == pytest.approx(psi_to_bar(26.0), rel=1e-3)
        assert row["tpms_press_fl"] == pytest.approx(26.0 / BAR_TO_PSI, rel=1e-3)

    def test_invalid_file_raises(self, tmp_path):
        bad_file = tmp_path / "bad.txt"
        bad_file.write_text("This is not a Pi Toolbox file")
        with pytest.raises(ValueError, match="PiToolboxVersionedASCIIDataSet"):
            load_pi_toolbox_export(bad_file)

    def test_no_channel_block_raises(self, tmp_path):
        f = tmp_path / "nochan.txt"
        f.write_text("PiToolboxVersionedASCIIDataSet\t1\n{OutingInformation}\nDriverName\tX\n")
        with pytest.raises(ValueError, match="ChannelBlock"):
            load_pi_toolbox_export(f)


class TestReadFileMetadata:
    def test_reads_metadata_only(self):
        path = FIXTURES / "sample_export.txt"
        meta = read_file_metadata(path)
        assert meta["DriverName"] == "Test Driver"
        assert meta["CarName"] == "992 Cup"


class TestConversions:
    def test_bar_to_psi(self):
        assert bar_to_psi(1.0) == pytest.approx(14.5038, rel=1e-4)
        assert bar_to_psi(2.0) == pytest.approx(29.0076, rel=1e-4)

    def test_psi_to_bar(self):
        assert psi_to_bar(14.5038) == pytest.approx(1.0, rel=1e-4)

    def test_round_trip(self):
        assert psi_to_bar(bar_to_psi(1.85)) == pytest.approx(1.85, rel=1e-6)
