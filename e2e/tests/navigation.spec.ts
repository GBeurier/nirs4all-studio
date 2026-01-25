import { test, expect } from '../fixtures/app.fixture';

/**
 * Navigation tests for sidebar and routing
 */
test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should navigate to all main sections via sidebar', async ({ sidebar, page }) => {
    // Dashboard (home)
    await sidebar.navigateTo('dashboard');
    await expect(page).toHaveURL('/');

    // Datasets
    await sidebar.navigateTo('datasets');
    await expect(page).toHaveURL('/datasets');
    await expect(page.getByRole('heading', { name: /datasets/i })).toBeVisible();

    // Playground
    await sidebar.navigateTo('playground');
    await expect(page).toHaveURL('/playground');

    // Pipelines
    await sidebar.navigateTo('pipelines');
    await expect(page).toHaveURL('/pipelines');
    await expect(page.getByRole('heading', { name: 'Pipelines', exact: true })).toBeVisible();

    // Runs
    await sidebar.navigateTo('runs');
    await expect(page).toHaveURL('/runs');

    // Results
    await sidebar.navigateTo('results');
    await expect(page).toHaveURL('/results');

    // Predictions
    await sidebar.navigateTo('predictions');
    await expect(page).toHaveURL('/predictions');

    // Analysis
    await sidebar.navigateTo('analysis');
    await expect(page).toHaveURL('/analysis');

    // Settings
    await sidebar.navigateTo('settings');
    await expect(page).toHaveURL('/settings');
    await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible();
  });

  test('should toggle sidebar collapse', async ({ sidebar }) => {
    // Initially expanded
    expect(await sidebar.isCollapsed()).toBe(false);

    // Collapse
    await sidebar.toggleCollapse();
    expect(await sidebar.isCollapsed()).toBe(true);

    // Expand
    await sidebar.toggleCollapse();
    expect(await sidebar.isCollapsed()).toBe(false);
  });

  test('should show active state on current route', async ({ sidebar, page }) => {
    // Navigate to datasets
    await sidebar.navigateTo('datasets');

    // The datasets link should have active styling
    const datasetsLink = page.locator('a[href="/datasets"]');
    await expect(datasetsLink).toHaveClass(/bg-primary/);

    // Navigate to pipelines
    await sidebar.navigateTo('pipelines');

    // The pipelines link should now have active styling
    const pipelinesLink = page.locator('a[href="/pipelines"]');
    await expect(pipelinesLink).toHaveClass(/bg-primary/);

    // And datasets should no longer be active
    await expect(datasetsLink).not.toHaveClass(/bg-primary/);
  });

  test('should handle browser back/forward navigation', async ({ sidebar, page }) => {
    await sidebar.navigateTo('datasets');
    await sidebar.navigateTo('pipelines');
    await sidebar.navigateTo('runs');

    // Go back
    await page.goBack();
    await expect(page).toHaveURL('/pipelines');

    await page.goBack();
    await expect(page).toHaveURL('/datasets');

    // Go forward
    await page.goForward();
    await expect(page).toHaveURL('/pipelines');
  });

  test('should handle direct URL navigation', async ({ page }) => {
    // Navigate directly to settings
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible();

    // Navigate directly to datasets
    await page.goto('/datasets');
    await expect(page.getByRole('heading', { name: /datasets/i })).toBeVisible();

    // Navigate directly to pipelines
    await page.goto('/pipelines');
    await expect(page.getByRole('heading', { name: 'Pipelines', exact: true })).toBeVisible();
  });

  test('should maintain sidebar state during navigation', async ({ sidebar, page }) => {
    // Collapse sidebar
    await sidebar.toggleCollapse();
    expect(await sidebar.isCollapsed()).toBe(true);

    // Navigate to different pages
    await sidebar.navigateTo('datasets');
    expect(await sidebar.isCollapsed()).toBe(true);

    await sidebar.navigateTo('settings');
    expect(await sidebar.isCollapsed()).toBe(true);
  });

  test('should display logo in sidebar', async ({ sidebar }) => {
    await sidebar.expectLogoVisible();
  });

  test('should navigate to new experiment/pipeline from sidebar', async ({ sidebar, page }) => {
    await sidebar.navigateTo('newExperiment');
    await expect(page).toHaveURL('/pipelines/new');
  });
});
