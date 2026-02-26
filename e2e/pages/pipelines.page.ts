import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * Page object for the Pipelines page
 */
export class PipelinesPage extends BasePage {
  // Page elements
  readonly pageTitle: Locator;
  readonly newPipelineButton: Locator;
  readonly importButton: Locator;
  readonly searchInput: Locator;

  // View toggle
  readonly viewToggleGrid: Locator;
  readonly viewToggleList: Locator;

  // Tabs
  readonly allTab: Locator;
  readonly favoritesTab: Locator;
  readonly myPipelinesTab: Locator;
  readonly presetsTab: Locator;
  readonly historyTab: Locator;

  // Content
  readonly pipelineCards: Locator;
  readonly pipelineRows: Locator;
  readonly emptyState: Locator;

  constructor(page: Page) {
    super(page);

    this.pageTitle = page.getByRole('heading', { name: /pipelines/i }).first();
    this.newPipelineButton = page.locator('a[href="/pipelines/new"]').first();
    this.importButton = page.getByRole('button', { name: /import/i });
    this.searchInput = page.getByPlaceholder(/search/i);

    // View toggles
    this.viewToggleGrid = page.locator('button').filter({ has: page.locator('svg.lucide-layout-grid') });
    this.viewToggleList = page.locator('button').filter({ has: page.locator('svg.lucide-list') });

    // Tabs
    this.allTab = page.getByRole('tab', { name: /all/i });
    this.favoritesTab = page.getByRole('tab', { name: /favorites/i });
    this.myPipelinesTab = page.getByRole('tab', { name: /my pipelines/i });
    this.presetsTab = page.getByRole('tab', { name: /presets/i });
    this.historyTab = page.getByRole('tab', { name: /history/i });

    // Content
    this.pipelineCards = page.locator('[data-testid="pipeline-card"]');
    this.pipelineRows = page.locator('[data-testid="pipeline-row"]');
    this.emptyState = page.getByText(/no pipelines/i);
  }

  async goto(): Promise<void> {
    await super.goto('/pipelines');
  }

  /**
   * Navigate to create new pipeline
   */
  async createNewPipeline(): Promise<void> {
    await this.newPipelineButton.click();
    await this.expectURL(/pipelines\/new/);
  }

  /**
   * Select a tab
   */
  async selectTab(tab: 'all' | 'favorites' | 'myPipelines' | 'presets' | 'history'): Promise<void> {
    const tabMap: Record<string, Locator> = {
      all: this.allTab,
      favorites: this.favoritesTab,
      myPipelines: this.myPipelinesTab,
      presets: this.presetsTab,
      history: this.historyTab,
    };
    await tabMap[tab].click();
  }

  /**
   * Search for pipelines
   */
  async searchPipelines(query: string): Promise<void> {
    await this.searchInput.fill(query);
    await this.page.waitForTimeout(300);
  }

  /**
   * Click on a pipeline by name
   */
  async selectPipeline(name: string): Promise<void> {
    await this.page.getByText(name).click();
  }

  /**
   * Toggle view between grid and list
   */
  async setViewMode(mode: 'grid' | 'list'): Promise<void> {
    if (mode === 'grid') {
      await this.viewToggleGrid.click();
    } else {
      await this.viewToggleList.click();
    }
  }

  /**
   * Get count of visible pipeline cards
   */
  async getPipelineCount(): Promise<number> {
    const cardsCount = await this.pipelineCards.count();
    const rowsCount = await this.pipelineRows.count();
    return cardsCount + rowsCount;
  }

  /**
   * Check if page is in empty state
   */
  async isEmptyState(): Promise<boolean> {
    return await this.emptyState.isVisible().catch(() => false);
  }
}
