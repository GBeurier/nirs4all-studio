import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * Page object for the Datasets page
 */
export class DatasetsPage extends BasePage {
  // Page elements
  readonly pageTitle: Locator;
  readonly addDatasetButton: Locator;
  readonly groupsButton: Locator;
  readonly searchInput: Locator;

  // Content areas
  readonly datasetCards: Locator;
  readonly emptyState: Locator;
  readonly loadingSpinner: Locator;

  // Stats cards
  readonly totalDatasetsCard: Locator;
  readonly totalSamplesCard: Locator;

  constructor(page: Page) {
    super(page);

    this.pageTitle = page.getByRole('heading', { name: /datasets/i }).first();
    this.addDatasetButton = page.getByRole('button', { name: /add.*dataset/i });
    this.groupsButton = page.getByRole('button', { name: /groups/i });
    // Use the page-specific search input, not the global sidebar search
    this.searchInput = page.getByPlaceholder('Search datasets...');

    // Dataset cards - clickable cards in main containing h3 headings (dataset names)
    // These cards have cursor-pointer style and contain the dataset name as h3
    this.datasetCards = page.locator('main').locator('div:has(> div > div > h3):not(:has(button)):has(img)').filter({
      hasNot: page.getByText('Total Datasets')
    });
    // Empty state can have various messages
    this.emptyState = page.getByText(/no datasets|no linked datasets|link a workspace|no results/i);
    this.loadingSpinner = page.locator('[class*="animate-spin"]');

    // Stats cards
    this.totalDatasetsCard = page.locator('text=Total Datasets').locator('..');
    this.totalSamplesCard = page.locator('text=Total Samples').locator('..');
  }

  async goto(): Promise<void> {
    await super.goto('/datasets');
  }

  /**
   * Open the add dataset wizard/dialog
   */
  async openAddDatasetWizard(): Promise<void> {
    await this.addDatasetButton.click();
    await expect(this.page.getByRole('dialog')).toBeVisible();
  }

  /**
   * Search for datasets by name
   */
  async searchDatasets(query: string): Promise<void> {
    await this.searchInput.fill(query);
    // Wait for debounce
    await this.page.waitForTimeout(300);
  }

  /**
   * Clear the search input
   */
  async clearSearch(): Promise<void> {
    await this.searchInput.clear();
    await this.page.waitForTimeout(300);
  }

  /**
   * Click on a dataset card by name
   */
  async selectDataset(name: string): Promise<void> {
    await this.page.getByText(name).click();
  }

  /**
   * Get the count of visible dataset cards
   */
  async getDatasetCount(): Promise<number> {
    return await this.datasetCards.count();
  }

  /**
   * Open the groups modal
   */
  async openGroupsModal(): Promise<void> {
    await this.groupsButton.click();
    await expect(this.page.getByRole('dialog')).toBeVisible();
  }

  /**
   * Check if page is in empty state (no datasets)
   */
  async isEmptyState(): Promise<boolean> {
    return await this.emptyState.isVisible().catch(() => false);
  }

  /**
   * Assert that a dataset with given name is visible
   */
  async expectDatasetVisible(name: string): Promise<void> {
    await expect(this.page.getByText(name)).toBeVisible();
  }

  /**
   * Assert the count of datasets
   */
  async expectDatasetCount(count: number): Promise<void> {
    await expect(this.datasetCards).toHaveCount(count);
  }

  // ============= Wizard Methods =============

  /**
   * Get the wizard dialog locator
   */
  get wizardDialog(): Locator {
    return this.page.getByRole('dialog');
  }

  /**
   * Get the current wizard step indicator
   */
  get wizardStepIndicator(): Locator {
    return this.wizardDialog.locator('.flex.items-center.gap-2').first();
  }

  /**
   * Get wizard step buttons by step name
   */
  getWizardStep(stepName: string): Locator {
    return this.wizardDialog.getByRole('button', { name: new RegExp(stepName, 'i') });
  }

  /**
   * Get the wizard Next button
   */
  get wizardNextButton(): Locator {
    return this.wizardDialog.getByRole('button', { name: /next/i });
  }

  /**
   * Get the wizard Back button
   */
  get wizardBackButton(): Locator {
    return this.wizardDialog.getByRole('button', { name: /back/i });
  }

  /**
   * Get the wizard Cancel button
   */
  get wizardCancelButton(): Locator {
    return this.wizardDialog.getByRole('button', { name: /cancel/i });
  }

  /**
   * Get wizard data stats display
   */
  get wizardDataStats(): Locator {
    return this.wizardDialog.locator('.text-xs.text-muted-foreground').first();
  }

  /**
   * Get wizard file count display (e.g., "2 X files")
   */
  async getWizardFileCount(type: 'X' | 'Y' | 'metadata'): Promise<number> {
    const statsText = await this.wizardDataStats.textContent();
    if (!statsText) return 0;
    const match = statsText.match(new RegExp(`(\\d+)\\s+${type}\\s+file`, 'i'));
    return match ? parseInt(match[1], 10) : 0;
  }

  /**
   * Get wizard target count display
   */
  async getWizardTargetCount(): Promise<number> {
    const statsText = await this.wizardDataStats.textContent();
    if (!statsText) return 0;
    const match = statsText.match(/(\d+)\s+target/i);
    return match ? parseInt(match[1], 10) : 0;
  }

  /**
   * Check if fold file is detected in wizard
   */
  async hasWizardFoldFileDetected(): Promise<boolean> {
    const statsText = await this.wizardDataStats.textContent();
    return statsText?.includes('fold file detected') ?? false;
  }

  /**
   * Click Next in wizard
   */
  async wizardNext(): Promise<void> {
    await this.wizardNextButton.click();
    await this.page.waitForTimeout(300);
  }

  /**
   * Click Back in wizard
   */
  async wizardBack(): Promise<void> {
    await this.wizardBackButton.click();
    await this.page.waitForTimeout(300);
  }

  /**
   * Close the wizard
   */
  async closeWizard(): Promise<void> {
    await this.wizardCancelButton.click();
    await expect(this.wizardDialog).not.toBeVisible();
  }

  /**
   * Get wizard step title
   */
  async getWizardStepTitle(): Promise<string> {
    const title = await this.wizardDialog.getByRole('heading').first().textContent();
    return title || '';
  }

  /**
   * Check if wizard is showing the file mapping step
   */
  async isWizardOnFileMappingStep(): Promise<boolean> {
    const title = await this.getWizardStepTitle();
    return title.toLowerCase().includes('map files');
  }

  /**
   * Check if wizard is showing the targets step
   */
  async isWizardOnTargetsStep(): Promise<boolean> {
    const title = await this.getWizardStepTitle();
    return title.toLowerCase().includes('targets');
  }

  /**
   * Get file rows in file mapping step
   */
  get wizardFileRows(): Locator {
    return this.wizardDialog.locator('[data-testid="file-row"]');
  }

  /**
   * Get file type selector for a file by filename
   */
  getFileTypeSelector(filename: string): Locator {
    return this.wizardDialog
      .locator(`text=${filename}`)
      .locator('..')
      .locator('select, [role="combobox"]')
      .first();
  }

  /**
   * Check if partition configuration section exists (should NOT exist after removal)
   */
  async hasPartitionConfigSection(): Promise<boolean> {
    return await this.wizardDialog.getByText('Partition Configuration').isVisible().catch(() => false);
  }

  /**
   * Check if feature variations section exists (should NOT exist after removal)
   */
  async hasFeatureVariationsSection(): Promise<boolean> {
    return await this.wizardDialog.getByText('Feature Variations').isVisible().catch(() => false);
  }

  /**
   * Check if fold section is visible in targets step
   */
  async hasFoldSection(): Promise<boolean> {
    return await this.wizardDialog.getByText('Cross-Validation Folds').isVisible().catch(() => false);
  }

  /**
   * Get detected columns in targets step
   */
  get wizardDetectedColumns(): Locator {
    return this.wizardDialog.locator('[data-testid="target-column"]');
  }

  /**
   * Check if target columns are detected and displayed
   */
  async hasDetectedTargetColumns(): Promise<boolean> {
    // Look for column badges or target candidate indicators
    const hasNumeric = await this.wizardDialog.getByText(/numeric/i).isVisible().catch(() => false);
    const hasCategorical = await this.wizardDialog.getByText(/categorical/i).isVisible().catch(() => false);
    return hasNumeric || hasCategorical;
  }
}
