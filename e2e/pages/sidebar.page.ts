import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * Page object for the AppSidebar navigation component
 */
export class SidebarPage extends BasePage {
  // Main container
  readonly sidebar: Locator;
  readonly collapseButton: Locator;
  readonly logo: Locator;

  // Main navigation links
  readonly dashboardLink: Locator;
  readonly datasetsLink: Locator;
  readonly playgroundLink: Locator;

  // Workflow navigation links
  readonly pipelinesLink: Locator;
  readonly newExperimentLink: Locator;
  readonly runsLink: Locator;
  readonly resultsLink: Locator;

  // Analysis navigation links
  readonly predictionsLink: Locator;
  readonly analysisLink: Locator;
  readonly synthesisLink: Locator;

  // Settings link
  readonly settingsLink: Locator;

  constructor(page: Page) {
    super(page);

    // The sidebar container - the div with bg-sidebar class containing the logo
    this.sidebar = page.locator('div.bg-sidebar').first();
    this.logo = page.locator('img[alt="nirs4all"]');
    // Collapse button is the rounded button at the edge of the sidebar
    this.collapseButton = page.locator('button.rounded-full:has(svg)');

    // Navigation links - use href-based selectors scoped to sidebar
    // This works whether sidebar is collapsed (no text visible) or expanded
    this.dashboardLink = this.sidebar.locator('a[href="/"]');
    this.datasetsLink = this.sidebar.locator('a[href="/datasets"]');
    this.playgroundLink = this.sidebar.locator('a[href="/playground"]');

    this.pipelinesLink = this.sidebar.locator('a[href="/pipelines"]');
    this.newExperimentLink = this.sidebar.locator('a[href="/pipelines/new"]');
    this.runsLink = this.sidebar.locator('a[href="/runs"]');
    this.resultsLink = this.sidebar.locator('a[href="/results"]');

    this.predictionsLink = this.sidebar.locator('a[href="/predictions"]');
    this.analysisLink = this.sidebar.locator('a[href="/analysis"]');
    this.synthesisLink = this.sidebar.locator('a[href="/synthesis"]');

    this.settingsLink = this.sidebar.locator('a[href="/settings"]');
  }

  /**
   * Navigate to a specific section via sidebar
   */
  async navigateTo(section: 'dashboard' | 'datasets' | 'playground' | 'pipelines' | 'newExperiment' | 'runs' | 'results' | 'predictions' | 'analysis' | 'synthesis' | 'settings'): Promise<void> {
    const linkMap: Record<string, Locator> = {
      dashboard: this.dashboardLink,
      datasets: this.datasetsLink,
      playground: this.playgroundLink,
      pipelines: this.pipelinesLink,
      newExperiment: this.newExperimentLink,
      runs: this.runsLink,
      results: this.resultsLink,
      predictions: this.predictionsLink,
      analysis: this.analysisLink,
      synthesis: this.synthesisLink,
      settings: this.settingsLink,
    };

    await linkMap[section].click();
    await this.waitForPageLoad();
  }

  /**
   * Toggle sidebar collapse state
   */
  async toggleCollapse(): Promise<void> {
    await this.collapseButton.click();
  }

  /**
   * Check if sidebar is currently collapsed
   */
  async isCollapsed(): Promise<boolean> {
    const sidebarClasses = await this.sidebar.getAttribute('class') || '';
    // Collapsed sidebar has w-16, expanded has w-64
    return sidebarClasses.includes('w-16');
  }

  /**
   * Assert that a specific link is marked as active
   */
  async expectActiveLink(section: 'dashboard' | 'datasets' | 'playground' | 'pipelines' | 'runs' | 'results' | 'predictions' | 'analysis' | 'synthesis' | 'settings'): Promise<void> {
    const linkMap: Record<string, Locator> = {
      dashboard: this.dashboardLink,
      datasets: this.datasetsLink,
      playground: this.playgroundLink,
      pipelines: this.pipelinesLink,
      runs: this.runsLink,
      results: this.resultsLink,
      predictions: this.predictionsLink,
      analysis: this.analysisLink,
      synthesis: this.synthesisLink,
      settings: this.settingsLink,
    };

    // Active links have bg-primary/10 class
    await expect(linkMap[section]).toHaveClass(/bg-primary/);
  }

  /**
   * Verify the sidebar logo is visible
   */
  async expectLogoVisible(): Promise<void> {
    await expect(this.logo).toBeVisible();
  }
}
