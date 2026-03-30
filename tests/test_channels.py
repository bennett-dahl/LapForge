"""Tests for LapForge.channels — channel detection, categorization, resolution."""

from LapForge.channels import (
    CHANNEL_SIGNATURES,
    categorize_channels,
    detect_channels,
    resolve_channel_metadata,
)


class TestResolveChannelMetadata:
    def test_exact_match(self):
        meta = resolve_channel_metadata("tpms_press_fl")
        assert meta is not None
        assert meta["category"] == "pressure"
        assert meta["unit"] == "bar"

    def test_case_insensitive(self):
        meta = resolve_channel_metadata("TPMS_PRESS_FL")
        assert meta is not None
        assert meta["category"] == "pressure"

    def test_unknown_returns_none(self):
        assert resolve_channel_metadata("totally_unknown_channel") is None

    def test_gps_aliases(self):
        for alias in ("lat", "latitude", "gps_lat", "nmea_lat"):
            meta = resolve_channel_metadata(alias)
            assert meta is not None, f"{alias} should resolve"
            assert meta["category"] == "gps"
            assert "Latitude" in meta["display"]

    def test_longitude_aliases(self):
        for alias in ("lon", "long", "longitude", "lng", "gps_lon"):
            meta = resolve_channel_metadata(alias)
            assert meta is not None, f"{alias} should resolve"
            assert "Longitude" in meta["display"]


class TestDetectChannels:
    def test_known_columns(self):
        cols = ["tpms_press_fl", "tpms_press_fr", "speed", "gear"]
        result = detect_channels(cols)
        assert len(result) == 4
        assert result["tpms_press_fl"]["category"] == "pressure"
        assert result["speed"]["category"] == "driver"
        assert result["gear"]["unit"] == ""

    def test_unknown_columns(self):
        cols = ["mystery_channel_1", "mystery_channel_2"]
        result = detect_channels(cols)
        assert result["mystery_channel_1"]["category"] == "unknown"
        assert result["mystery_channel_2"]["category"] == "unknown"
        assert result["mystery_channel_1"]["display"] == "mystery_channel_1"
        # Different colors for each unknown
        assert result["mystery_channel_1"]["color"] != result["mystery_channel_2"]["color"]

    def test_mixed_known_and_unknown(self):
        cols = ["speed", "custom_sensor"]
        result = detect_channels(cols)
        assert result["speed"]["category"] == "driver"
        assert result["custom_sensor"]["category"] == "unknown"

    def test_preserves_original_name(self):
        cols = ["TPMS_PRESS_FL"]
        result = detect_channels(cols)
        assert "TPMS_PRESS_FL" in result
        assert result["TPMS_PRESS_FL"]["category"] == "pressure"

    def test_empty_input(self):
        assert detect_channels([]) == {}


class TestCategorizeChannels:
    def test_groups_by_category(self):
        meta = detect_channels(["tpms_press_fl", "tpms_press_fr", "speed", "lat"])
        groups = categorize_channels(meta)
        assert "pressure" in groups
        assert "driver" in groups
        assert "gps" in groups
        assert len(groups["pressure"]) == 2
        assert len(groups["driver"]) == 1

    def test_empty(self):
        assert categorize_channels({}) == {}

    def test_unknown_group(self):
        meta = detect_channels(["custom_x"])
        groups = categorize_channels(meta)
        assert "unknown" in groups
        assert groups["unknown"] == ["custom_x"]
