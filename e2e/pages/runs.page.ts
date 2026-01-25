import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * Page object for the Runs page
 */
export class RunsPage extends BasePage {
  // Page elements
  readonly pageTitle: Locator;
  readonly newRunButton: Locator;
  readonly refreshButton: Locator;

  // Content
  readonly runCards: Locator;
  readonly runRows: Locator;
  readonly emptyState: Locator;
  readonly noWorkspaceState: Locator;

  // Stats cards
  readonly runningCount: Locator;
  readonly queuedCount: Locator;
  readonly completedCount: Locator;
  readonly failedCount: Locator;

  constructor(page: Page) {
    super(page);

    this.pageTitle = page.getByRole('heading', { name: /runs/i }).first();
    // Look for "New Run" button in the main content area, not sidebar
    this.newRunButton = page.locator('main').getByRole('link', { name: /new.*run/i });
    this.refreshButton = page.getByRole('button', { name: /refresh/i });

    // Content
    this.runCards = page.locator('[data-testid="run-card"]');
    this.runRows = page.locator('[data-testid="run-row"]');
    this.emptyState = page.getByText(/no runs/i);
    this.noWorkspaceState = page.getByText(/no workspace|link.*workspace/i);

    // Stats - look for stat values near their labels
    this.runningCount = page.locator('text=Running').locator('..').locator('.font-bold, .text-2xl').first();
    this.queuedCount = page.locator('text=Queued').locator('..').locator('.font-bold, .text-2xl').first();
    this.completedCount = page.locator('text=Completed').locator('..').locator('.font-bold, .text-2xl').first();
    this.failedCount = page.locator('text=Failed').locator('..').locator('.font-bold, .text-2xl').first();
  }

  async goto(): Promise<void> {
    await super.goto('/runs');
  }

  /**
   * Navigate to start a new run
   */
  async startNewRun(): Promise<void> {
    await this.newRunButton.click();
    await this.expectURL(/runs\/new|pipelines\/new/);
  }

  /**
   * Click on a run card/row by name
   */
  async selectRun(name: string): Promise<void> {
    await this.page.getByText(name).click();
  }

  /**
   * View run details (expand or open detail sheet)
   */
  async viewRunDetails(runName: string): Promise<void> {
    const runElement = this.page.locator(`[data-testid="run-card"]:has-text("${runName}"), [data-testid="run-row"]:has-text("${runName}")`);
    const viewButton = runElement.getByRole('button', { name: /view|details/i });
    if (await viewButton.isVisible()) {
      await viewButton.click();
    } else {
      // Click on the run itself to expand
      await runElement.click();
    }
  }

  /**
   * Get the count of visible runs
   */
  async getRunCount(): Promise<number> {
    const cardsCount = await this.runCards.count();
    const rowsCount = await this.runRows.count();
    return cardsCount + rowsCount;
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
   * Wait for a run to complete
   */
  async waitForRunCompletion(runName: string, timeout = 300000): Promise<void> {
    const completedIndicator = this.page.locator(`[data-testid="run-card"]:has-text("${runName}"), [data-testid="run-row"]:has-text("${runName}")`).locator('text=completed');
    await expect(completedIndicator).toBeVisible({ timeout });
  }

  /**
   * Refresh the runs list
   */
  async refresh(): Promise<void> {
    if (await this.refreshButton.isVisible()) {
      await this.refreshButton.click();
      await this.waitForPageLoad();
    }
  }
}
