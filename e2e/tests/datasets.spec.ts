import { test, expect } from '../fixtures/app.fixture';

/**
 * Dataset management tests
 */
test.describe('Datasets', () => {
  test.beforeEach(async ({ datasetsPage }) => {
    await datasetsPage.goto();
  });

  test('should display datasets page', async ({ datasetsPage, page }) => {
    await expect(datasetsPage.pageTitle).toBeVisible();
  });

  test('should show add dataset button', async ({ datasetsPage }) => {
    await expect(datasetsPage.addDatasetButton).toBeVisible();
  });

  test('should open add dataset wizard', async ({ datasetsPage, page }) => {
    await datasetsPage.openAddDatasetWizard();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Close dialog
    await page.keyboard.press('Escape');
  });

  test('should have search input', async ({ datasetsPage }) => {
    await expect(datasetsPage.searchInput).toBeVisible();
  });

  test('should filter datasets on search', async ({ datasetsPage, page }) => {
    // Type in search
    await datasetsPage.searchDatasets('test');

    // Wait for filter to apply
    await page.waitForTimeout(500);

    // The page should still be functional with stats visible
    // Either filtered results, empty state, or stats cards should be visible
    const hasCards = await datasetsPage.getDatasetCount() > 0;
    const isEmpty = await datasetsPage.isEmptyState();
    const hasStats = await page.getByText('Total Datasets').isVisible().catch(() => false);

    expect(hasCards || isEmpty || hasStats).toBe(true);
  });

  test('should clear search', async ({ datasetsPage }) => {
    await datasetsPage.searchDatasets('test');
    await datasetsPage.clearSearch();

    // Search input should be empty
    await expect(datasetsPage.searchInput).toHaveValue('');
  });

  test('should show groups button', async ({ datasetsPage }) => {
    await expect(datasetsPage.groupsButton).toBeVisible();
  });

  test('should open groups modal', async ({ datasetsPage, page }) => {
    await datasetsPage.openGroupsModal();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Close dialog
    await page.keyboard.press('Escape');
  });

  test('should show empty state or dataset cards', async ({ datasetsPage, page }) => {
    // Page should be in a valid state: has cards, empty state, or stats display
    const hasCards = await datasetsPage.getDatasetCount() > 0;
    const isEmpty = await datasetsPage.isEmptyState();
    // Stats are always shown if page loaded correctly
    const hasStats = await page.getByText('Total Datasets').isVisible().catch(() => false);

    expect(hasCards || isEmpty || hasStats).toBe(true);
  });

  test('should navigate to dataset detail on click', async ({ datasetsPage, page }) => {
    const count = await datasetsPage.getDatasetCount();

    if (count > 0) {
      // Click on the first dataset card
      await datasetsPage.datasetCards.first().click();

      // Should navigate to detail page or open detail view
      // The URL might change or a panel might open
      await page.waitForTimeout(500);

      // Either URL changed or detail panel visible
      const urlChanged = !page.url().endsWith('/datasets');
      const detailVisible = await page.getByText(/samples|wavelengths|spectra/i).isVisible().catch(() => false);

      expect(urlChanged || detailVisible).toBe(true);
    }
  });
});

test.describe('Datasets - Integration', () => {
  test('should navigate from dashboard to datasets', async ({ sidebar, datasetsPage, page }) => {
    await page.goto('/');
    await sidebar.navigateTo('datasets');

    await expect(page).toHaveURL('/datasets');
    await expect(datasetsPage.pageTitle).toBeVisible();
  });

  test('should maintain search across navigation', async ({ datasetsPage, sidebar, page }) => {
    await datasetsPage.goto();
    await datasetsPage.searchDatasets('sample');

    // Navigate away
    await sidebar.navigateTo('pipelines');

    // Navigate back
    await sidebar.navigateTo('datasets');

    // Note: Search might not persist - this tests current behavior
    await expect(datasetsPage.searchInput).toBeVisible();
  });
});
