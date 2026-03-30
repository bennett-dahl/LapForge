"""Frontend smoke tests with Playwright — critical user flows against the React SPA."""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.e2e


class TestNavigation:
    def test_homepage_loads(self, page, base_url):
        page.goto(base_url)
        page.wait_for_selector("#sidebar", timeout=8000)
        assert page.title()

    def test_sidebar_links(self, page, base_url):
        page.goto(base_url)
        page.wait_for_selector("#sidebar", timeout=8000)
        links = page.query_selector_all("#sidebar .sb-link")
        assert len(links) >= 6

    def test_navigate_via_sidebar(self, page, base_url):
        page.goto(base_url)
        page.wait_for_selector("#sidebar", timeout=8000)
        page.click("#sidebar .sb-link >> text=Sessions")
        page.wait_for_selector("h1", timeout=5000)
        assert "Sessions" in page.inner_text("h1")

    def test_settings_page(self, page, base_url):
        page.goto(f"{base_url}/settings")
        page.wait_for_selector("h1", timeout=8000)
        assert "Settings" in page.inner_text("h1")
        page.wait_for_selector(".tabs", timeout=5000)


class TestCarDriverFlow:
    def test_car_drivers_list(self, page, base_url):
        page.goto(f"{base_url}/car-drivers")
        page.wait_for_selector(".data-table", timeout=8000)
        assert "E2E Driver" in page.inner_text(".data-table")

    def test_add_car_driver(self, page, base_url):
        page.goto(f"{base_url}/car-drivers")
        page.wait_for_selector(".page-content", timeout=8000)

        page.click("text=+ Add")
        page.wait_for_selector(".modal-overlay", timeout=5000)

        car_input = page.locator(".modal-body input").first
        driver_input = page.locator(".modal-body input").nth(1)
        car_input.fill("718")
        driver_input.fill("Playwright Driver")

        page.click(".modal-body button >> text=Create")
        page.wait_for_selector(".modal-overlay", state="hidden", timeout=5000)

        page.wait_for_selector(".data-table", timeout=5000)
        assert "Playwright Driver" in page.inner_text(".data-table")


class TestSessionFlow:
    def test_sessions_list(self, page, base_url):
        page.goto(f"{base_url}/sessions")
        page.wait_for_selector(".data-table", timeout=8000)
        assert "Test Track" in page.inner_text(".data-table")

    def test_session_detail(self, page, base_url):
        page.goto(f"{base_url}/sessions/e2e-session-1")
        page.wait_for_selector(".page-content", timeout=8000)
        content = page.inner_text(".page-content")
        assert "Test Track" in content


class TestUploadFlow:
    def test_upload_page_loads(self, page, base_url):
        page.goto(f"{base_url}/upload")
        page.wait_for_selector("h1", timeout=8000)
        assert "Upload" in page.inner_text("h1")
        page.wait_for_selector('input[type="file"]', timeout=5000)

    def test_upload_and_parse(self, page, base_url):
        page.goto(f"{base_url}/upload")
        page.wait_for_selector('input[type="file"]', timeout=8000)

        import os
        fixture = os.path.join(os.path.dirname(__file__), "..", "fixtures", "sample_export.txt")
        page.set_input_files('input[type="file"]', fixture)
        page.click("text=Upload & Parse")
        page.wait_for_selector(".card h3", timeout=10000)
        assert "Parsed Data Preview" in page.inner_text(".page-content")


class TestCompareFlow:
    def test_compare_list(self, page, base_url):
        page.goto(f"{base_url}/compare")
        page.wait_for_selector("h1", timeout=8000)
        assert "Compare" in page.inner_text("h1")


class TestTrackLayoutsFlow:
    def test_track_layouts_list(self, page, base_url):
        page.goto(f"{base_url}/track-layouts")
        page.wait_for_selector("h1", timeout=8000)
        assert "Track Maps" in page.inner_text("h1")


class TestSettingsFlow:
    def test_preferences_tab(self, page, base_url):
        page.goto(f"{base_url}/settings")
        page.wait_for_selector(".tabs", timeout=8000)
        page.click("button.tab >> text=Preferences")
        page.wait_for_selector(".tab-content", timeout=5000)
        assert "Default Target Pressure" in page.inner_text(".tab-content")

    def test_account_tab(self, page, base_url):
        page.goto(f"{base_url}/settings")
        page.wait_for_selector(".tabs", timeout=8000)
        page.click("button.tab >> text=Account")
        page.wait_for_selector(".tab-content", timeout=5000)
        content = page.inner_text(".tab-content")
        assert "signed in" in content.lower() or "sign in" in content.lower()
