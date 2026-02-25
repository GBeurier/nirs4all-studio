import { test, expect } from '@playwright/test';

/**
 * Smoke tests to verify basic application functionality
 */
test.describe('Smoke Tests', () => {
  test('should load the application', async ({ page }) => {
    await page.goto('/');

    // Check logo is visible
    await expect(page.locator('img[alt="nirs4all Studio"]')).toBeVisible();

    // Check sidebar navigation is present (scope to sidebar)
    const sidebar = page.locator('div.bg-sidebar').first();
    await expect(sidebar.locator('a[href="/datasets"]')).toBeVisible();
    await expect(sidebar.locator('a[href="/pipelines"]')).toBeVisible();
  });

  test('should respond to API health check', async ({ page }) => {
    // Retry health check to handle transient connection issues under parallel load
    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await page.request.get('/api/health');
        if (response.ok()) break;
      } catch {
        if (attempt === 2) throw new Error('Health check failed after 3 attempts');
        await page.waitForTimeout(1000);
      }
    }
    expect(response!.ok()).toBe(true);

    const data = await response!.json();
    // Backend returns status: "healthy"
    expect(data.status).toBe('healthy');
  });

  test('should render without critical console errors', async ({ page }) => {
    const consoleErrors: string[] = [];

    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Filter out known acceptable errors (e.g., favicon 404, expected network errors)
    const criticalErrors = consoleErrors.filter(err =>
      !err.includes('favicon') &&
      !err.includes('Failed to load resource') &&
      !err.includes('net::ERR') &&
      !err.includes('404')
    );

    expect(criticalErrors).toHaveLength(0);
  });

  test('should handle 404 routes gracefully', async ({ page }) => {
    await page.goto('/nonexistent-route-that-does-not-exist');

    // Should show NotFound page or redirect to home
    const notFoundVisible = await page.getByText(/not found|404|page.*not.*exist/i).isVisible().catch(() => false);
    const redirectedToHome = await page.locator('img[alt="nirs4all Studio"]').isVisible();

    expect(notFoundVisible || redirectedToHome).toBe(true);
  });

  test('should have correct page title', async ({ page }) => {
    await page.goto('/');

    // Page title should contain app name
    await expect(page).toHaveTitle(/nirs4all/i);
  });

  test('should display sidebar with all main navigation items', async ({ page }) => {
    await page.goto('/');

    // Scope all checks to the sidebar
    const sidebar = page.locator('div.bg-sidebar').first();

    // Prepare group
    await expect(sidebar.locator('a[href="/datasets"]')).toBeVisible();
    await expect(sidebar.locator('a[href="/pipelines"]')).toBeVisible();
    await expect(sidebar.locator('a[href="/editor"]')).toBeVisible();

    // Explore group
    await expect(sidebar.locator('a[href="/playground"]')).toBeVisible();
    await expect(sidebar.locator('a[href="/inspector"]')).toBeVisible();
    await expect(sidebar.locator('a[href="/lab"]')).toBeVisible();

    // Results group
    await expect(sidebar.locator('a[href="/runs"]')).toBeVisible();
    await expect(sidebar.locator('a[href="/results"]')).toBeVisible();
    await expect(sidebar.locator('a[href="/predictions"]')).toBeVisible();

    // Settings
    await expect(sidebar.locator('a[href="/settings"]')).toBeVisible();
  });
});
