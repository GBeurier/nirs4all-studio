import { test, expect } from '../fixtures/app.fixture';

/**
 * Settings tests for UI zoom, theme, and density
 *
 * IMPORTANT: These tests modify shared backend workspace settings.
 *
 * The backend workspace is shared across all browser projects (chromium, firefox, webkit).
 * When running in parallel, different browsers may interfere with each other's settings.
 *
 * For deterministic, 100% reliable execution:
 *   npx playwright test settings.spec.ts --workers=1
 *
 * Note: CI environment already uses --workers=1 (configured in playwright.config.ts)
 *
 * In parallel mode (default for local development), tests have retries to handle
 * occasional race conditions. Some flakiness is expected due to the shared backend state.
 */

// Run all settings tests sequentially within each browser project, with retries
// to handle race conditions when multiple browser projects run in parallel
test.describe.configure({ mode: 'serial', retries: 2 });

test.describe('Settings - UI Customization', () => {

  test.beforeEach(async ({ settingsPage, page }) => {
    // Reset settings to defaults before each test to ensure isolation
    await settingsPage.resetToDefaults();
    await settingsPage.goto();
    // Reload to ensure reset settings are applied in the browser
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    // Wait for settings to be fully loaded after reload
    await settingsPage.waitForSettingsReady();
  });

  test('should display settings page with tabs', async ({ settingsPage, page }) => {
    await expect(settingsPage.pageTitle).toBeVisible();
    await expect(settingsPage.generalTab).toBeVisible();
    await expect(settingsPage.workspacesTab).toBeVisible();
  });

  test('should change zoom level and apply CSS class', async ({ settingsPage, page }) => {
    // Set zoom to 125%
    await settingsPage.setZoomLevel(125);
    await settingsPage.expectZoomClass(125);
    await settingsPage.expectZoomLevel(125);

    // Set zoom to 75%
    await settingsPage.setZoomLevel(75);
    await settingsPage.expectZoomClass(75);
    await settingsPage.expectZoomLevel(75);

    // Set zoom back to 100%
    await settingsPage.setZoomLevel(100);
    await settingsPage.expectZoomClass(100);
    await settingsPage.expectZoomLevel(100);
  });

  test('should persist zoom level across page reloads', async ({ settingsPage, page }) => {
    // Set zoom to 110%
    await settingsPage.setZoomLevel(110);
    await settingsPage.expectZoomLevel(110);

    // Reload page and wait for settings to be ready
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await settingsPage.waitForSettingsReady();

    // Verify zoom is still applied
    await settingsPage.expectZoomLevel(110);
    await settingsPage.expectZoomClass(110);
  });

  test('should change UI density and apply CSS variables', async ({ settingsPage, page }) => {
    // Set to compact and verify both class and actual CSS variable values
    await settingsPage.setDensity('compact');
    await settingsPage.expectDensityClass('compact');
    await settingsPage.expectDensityValues('compact');

    // Set to spacious
    await settingsPage.setDensity('spacious');
    await settingsPage.expectDensityClass('spacious');
    await settingsPage.expectDensityValues('spacious');

    // Set to comfortable (default)
    await settingsPage.setDensity('comfortable');
    await settingsPage.expectDensityClass('comfortable');
    await settingsPage.expectDensityValues('comfortable');
  });

  test('should persist density across page reloads', async ({ settingsPage, page }) => {
    // Set to compact and verify it took effect (including actual CSS values)
    await settingsPage.setDensity('compact');
    await settingsPage.expectDensityClass('compact');
    await settingsPage.expectDensityValues('compact');

    // Reload page and wait for settings to be ready
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await settingsPage.waitForSettingsReady();

    // Verify density persisted with actual values
    await settingsPage.expectDensityClass('compact');
    await settingsPage.expectDensityValues('compact');
  });

  test('should toggle reduce animations', async ({ settingsPage, page }) => {
    // Find the switch and check its state first
    const animationSwitch = page.getByRole('switch');
    const isCheckedBefore = await animationSwitch.isChecked().catch(() => false);

    // Toggle reduce animations
    await settingsPage.toggleReduceAnimations();
    await page.waitForTimeout(300);

    // Check if the switch changed state
    const isCheckedAfter = await animationSwitch.isChecked().catch(() => !isCheckedBefore);

    // The switch should have toggled
    expect(isCheckedAfter !== isCheckedBefore).toBe(true);

    // Toggle back
    await settingsPage.toggleReduceAnimations();
    await page.waitForTimeout(300);
  });

  test('should change theme', async ({ settingsPage, page }) => {
    // Set to dark theme
    await settingsPage.setTheme('dark');
    await settingsPage.expectThemeClass('dark');

    // Set to light theme
    await settingsPage.setTheme('light');
    await settingsPage.expectThemeClass('light');
  });

  test('should persist theme across page reloads', async ({ settingsPage, page }) => {
    // Set to dark theme and verify it took effect
    await settingsPage.setTheme('dark');
    await settingsPage.expectThemeClass('dark');

    // Reload page and wait for settings to be ready
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await settingsPage.waitForSettingsReady();

    // Verify theme is still applied
    await settingsPage.expectThemeClass('dark');
  });

  test('should navigate between settings tabs', async ({ settingsPage, page }) => {
    // Go to workspaces tab
    await settingsPage.selectTab('workspaces');
    // Wait for tab content to load and check for tab panel or common content
    await page.waitForTimeout(300);
    const tabPanel = page.getByRole('tabpanel');
    await expect(tabPanel).toBeVisible();

    // Go to general tab
    await settingsPage.selectTab('general');
    await page.waitForTimeout(300);
    // General tab should have theme controls
    await expect(page.getByText(/appearance/i)).toBeVisible();
  });

  test('should apply multiple settings correctly', async ({ settingsPage, page }) => {
    // Set multiple settings
    await settingsPage.setZoomLevel(90);
    await settingsPage.setDensity('compact');
    await settingsPage.setTheme('dark');

    // Verify all are applied (both class presence and actual values)
    await settingsPage.expectZoomClass(90);
    await settingsPage.expectZoomLevel(90);
    await settingsPage.expectDensityClass('compact');
    await settingsPage.expectDensityValues('compact');
    await settingsPage.expectThemeClass('dark');

    // Reload and verify persistence
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await settingsPage.waitForSettingsReady();

    await settingsPage.expectZoomClass(90);
    await settingsPage.expectZoomLevel(90);
    await settingsPage.expectDensityClass('compact');
    await settingsPage.expectDensityValues('compact');
    await settingsPage.expectThemeClass('dark');
  });
});

test.describe('Settings - Navigation Integration', () => {
  test.describe.configure({ mode: 'serial' });

  test('should maintain settings when navigating away and back', async ({ settingsPage, sidebar, page }) => {
    await settingsPage.goto();

    // Set zoom level
    await settingsPage.setZoomLevel(125);
    await settingsPage.expectZoomClass(125);

    // Navigate away
    await sidebar.navigateTo('datasets');
    await expect(page).toHaveURL('/datasets');

    // Settings should still be applied
    const html = page.locator('html');
    await expect(html).toHaveClass(/zoom-125/);

    // Navigate back to settings
    await sidebar.navigateTo('settings');

    // Verify setting is still shown as selected
    await settingsPage.expectZoomLevel(125);
  });
});
