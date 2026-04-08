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

    def test_tab_deep_link(self, page, base_url):
        """?tab=sync query param opens the Sync tab directly."""
        page.goto(f"{base_url}/settings?tab=sync")
        page.wait_for_selector(".tabs", timeout=8000)
        page.wait_for_selector(".tab-content", timeout=5000)
        # The sync tab content either shows the SyncPanel or an oauth/login message
        content = page.inner_text(".tab-content")
        assert "sync" in content.lower() or "oauth" in content.lower() or "sign in" in content.lower()


class TestHomePolish:
    def test_sync_strip_present(self, page, base_url):
        """Sync summary strip is always rendered on the home page."""
        page.goto(base_url)
        page.wait_for_selector("#sidebar", timeout=8000)
        # Wait for React query to settle and strip to appear
        el = page.wait_for_selector('[data-testid="home-sync-summary"]', timeout=8000)
        assert el is not None
        # In the e2e environment OAuth is not configured; strip shows muted text
        text = el.inner_text().lower()
        assert "sync" in text

    def test_app_footer_present(self, page, base_url):
        """App footer with data path is always visible."""
        page.goto(base_url)
        page.wait_for_selector("#sidebar", timeout=8000)
        footer = page.wait_for_selector('[data-testid="app-footer"]', timeout=8000)
        assert footer is not None
        assert footer.is_visible()

    def test_app_footer_shows_data_path(self, page, base_url, e2e_data_root):
        """Footer includes a fragment of the known e2e data root path."""
        page.goto(base_url)
        page.wait_for_selector('[data-testid="app-footer"]', timeout=8000)
        footer_text = page.inner_text('[data-testid="app-footer"]')
        # e2e_data_root is a tmp path; at least part of it appears in footer
        assert str(e2e_data_root).replace("\\", "/")[:10] in footer_text.replace("\\", "/") or \
               "Data:" in footer_text


class TestSessionsPolish:
    def test_added_column_header(self, page, base_url):
        """Sessions table has an 'Added' column header."""
        page.goto(f"{base_url}/sessions")
        page.wait_for_selector(".data-table", timeout=8000)
        header_text = page.inner_text(".data-table thead")
        assert "Added" in header_text

    def test_added_column_shows_date(self, page, base_url):
        """The seeded session (created_at=2025-01-15) shows 'Jan 15' in the Added column."""
        page.goto(f"{base_url}/sessions")
        page.wait_for_selector(".data-table", timeout=8000)
        table_text = page.inner_text(".data-table tbody")
        assert "Jan 15" in table_text
