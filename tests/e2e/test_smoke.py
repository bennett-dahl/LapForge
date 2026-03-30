"""Frontend smoke tests with Playwright — critical user flows."""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.e2e


class TestNavigation:
    def test_homepage_loads(self, page, base_url):
        page.goto(base_url)
        assert page.title()
        page.wait_for_selector(".sidebar", timeout=5000)

    def test_sidebar_links(self, page, base_url):
        page.goto(base_url)
        page.wait_for_selector(".sidebar", timeout=5000)
        links = page.query_selector_all(".sidebar a")
        assert len(links) >= 3

    def test_settings_page(self, page, base_url):
        page.goto(f"{base_url}/settings")
        page.wait_for_selector("form", timeout=5000)
        assert "Settings" in page.content() or "settings" in page.url


class TestCarDriverFlow:
    def test_car_drivers_list(self, page, base_url):
        page.goto(f"{base_url}/car_drivers")
        page.wait_for_load_state("networkidle")
        assert "E2E Driver" in page.content()

    def test_add_car_driver(self, page, base_url):
        page.goto(f"{base_url}/car_drivers/add")
        page.wait_for_selector('input[name="car_identifier"]', timeout=5000)

        page.fill('input[name="car_identifier"]', "718")
        page.fill('input[name="driver_name"]', "Playwright Driver")
        page.click('button[type="submit"]')
        page.wait_for_load_state("networkidle")

        assert "Playwright Driver" in page.content()


class TestSessionFlow:
    def test_sessions_list(self, page, base_url):
        page.goto(f"{base_url}/sessions")
        page.wait_for_load_state("networkidle")
        assert "Test Track" in page.content()

    def test_session_detail(self, page, base_url):
        page.goto(f"{base_url}/sessions/e2e-session-1")
        page.wait_for_load_state("networkidle")
        assert "Test Track" in page.content()

    def test_session_unit_toggle(self, page, base_url):
        page.goto(f"{base_url}/sessions/e2e-session-1?unit=bar")
        page.wait_for_load_state("networkidle")
        content = page.content()
        assert "bar" in content.lower()


class TestUploadFlow:
    def test_upload_page_loads(self, page, base_url):
        page.goto(f"{base_url}/upload")
        page.wait_for_selector('input[type="file"]', timeout=5000)

    def test_upload_and_parse(self, page, base_url):
        page.goto(f"{base_url}/upload")
        page.wait_for_selector('input[type="file"]', timeout=5000)

        import os
        fixture = os.path.join(os.path.dirname(__file__), "..", "fixtures", "sample_export.txt")
        page.set_input_files('input[type="file"]', fixture)
        page.click('button[type="submit"]')
        page.wait_for_load_state("networkidle", timeout=10000)

        content = page.content()
        assert "Test Track" in content or "Test Driver" in content


class TestCompareFlow:
    def test_compare_list(self, page, base_url):
        page.goto(f"{base_url}/compare")
        page.wait_for_load_state("networkidle")
        assert page.url.endswith("/compare") or "compare" in page.url


class TestTrackLayoutsFlow:
    def test_track_layouts_list(self, page, base_url):
        page.goto(f"{base_url}/track-layouts")
        page.wait_for_load_state("networkidle")
        assert "Track" in page.content() or "layout" in page.content().lower()
