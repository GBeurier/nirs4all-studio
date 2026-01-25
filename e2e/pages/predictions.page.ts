import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * Page object for the Predictions page
 */
export class PredictionsPage extends BasePage {
  // Page elements
  readonly pageTitle: Locator;
  readonly searchInput: Locator;

  // Filters
  readonly datasetFilter: Locator;
  readonly modelFilter: Locator;

  // Content
  readonly predictionsTable: Locator;
  readonly predictionRows: Locator;
  readonly emptyState: Locator;
  readonly noWorkspaceState: Locator;

  // Stats
  readonly totalPredictions: Locator;
  readonly totalDatasets: Locator;
  readonly totalModels: Locator;

  constructor(page: Page) {
    super(page);

    this.pageTitle = page.getByRole('heading', { name: /predictions/i }).first();
    this.searchInput = page.getByPlaceholder(/search/i);

    // Filters - look for combobox/select elements
    this.datasetFilter = page.locator('[data-testid="dataset-filter"]');
    this.modelFilter = page.locator('[data-testid="model-filter"]');

    // Content
    this.predictionsTable = page.locator('table');
    this.predictionRows = page.locator('table tbody tr');
    this.emptyState = page.getByText(/no predictions/i);
    this.noWorkspaceState = page.getByText(/no workspace|link.*workspace/i);

    // Stats
    this.totalPredictions = page.locator('text=Total Predictions').locator('..').locator('.font-bold, .text-2xl').first();
    this.totalDatasets = page.locator('text=Datasets').locator('..').locator('.font-bold, .text-2xl').first();
    this.totalModels = page.locator('text=Models').locator('..').locator('.font-bold, .text-2xl').first();
  }

  async goto(): Promise<void> {
    await super.goto('/predictions');
  }

  /**
   * Search predictions
   */
  async searchPredictions(query: string): Promise<void> {
    await this.searchInput.fill(query);
    await this.page.waitForTimeout(300);
  }

  /**
   * Filter by dataset using the dropdown
   */
  async filterByDataset(datasetName: string): Promise<void> {
    const datasetCombobox = this.page.getByRole('combobox').filter({ hasText: /dataset/i });
    await datasetCombobox.click();
    await this.page.getByRole('option', { name: datasetName }).click();
  }

  /**
   * Filter by model using the dropdown
   */
  async filterByModel(modelName: string): Promise<void> {
    const modelCombobox = this.page.getByRole('combobox').filter({ hasText: /model/i });
    await modelCombobox.click();
    await this.page.getByRole('option', { name: modelName }).click();
  }

  /**
   * View prediction details for a specific row
   */
  async viewPredictionDetails(index: number): Promise<void> {
    const row = this.predictionRows.nth(index);
    const viewButton = row.getByRole('button', { name: /view|details/i });
    if (await viewButton.isVisible()) {
      await viewButton.click();
    } else {
      await row.click();
    }
  }

  /**
   * Get the count of prediction rows
   */
  async getPredictionCount(): Promise<number> {
    return await this.predictionRows.count();
  }

  /**
   * Check if page is in empty state
   */
  async isEmptyState(): Promise<boolean> {
    return await this.emptyState.isVisible().catch(() => false);
  }

  /**
   * Check if no workspace is linked
   */
  async isNoWorkspaceState(): Promise<boolean> {
    return await this.noWorkspaceState.isVisible().catch(() => false);
  }

  /**
   * Assert that predictions table has a specific count
   */
  async expectPredictionCount(count: number): Promise<void> {
    await expect(this.predictionRows).toHaveCount(count);
  }
}
