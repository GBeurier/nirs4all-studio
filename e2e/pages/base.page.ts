import { Page, Locator, expect } from '@playwright/test';

/**
 * Base page object with common methods for all pages
 */
export abstract class BasePage {
  protected page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Navigate to a specific path
   */
  async goto(path: string = ''): Promise<void> {
    // Use domcontentloaded — the app has background API polling that delays the load event
    await this.page.goto(path, { waitUntil: 'domcontentloaded' });
    await this.waitForPageLoad();
  }

  /**
   * Wait for page to be fully loaded
   */
  async waitForPageLoad(): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded');
  }

  /**
   * Wait for a toast notification with specific message
   */
  async waitForToast(message: string | RegExp, timeout = 5000): Promise<void> {
    const toastLocator = typeof message === 'string'
      ? this.page.getByText(message)
      : this.page.locator(`text=${message}`);
    await expect(toastLocator).toBeVisible({ timeout });
  }

  /**
   * Dismiss any visible toast notifications
   */
  async dismissToast(): Promise<void> {
    const toast = this.page.locator('[data-sonner-toast]');
    if (await toast.isVisible()) {
      await toast.click();
    }
  }

  /**
   * Assert that the page title matches
   */
  async expectTitle(title: string | RegExp): Promise<void> {
    await expect(this.page).toHaveTitle(title);
  }

  /**
   * Assert that the URL matches
   */
  async expectURL(urlPattern: string | RegExp): Promise<void> {
    await expect(this.page).toHaveURL(urlPattern);
  }

  /**
   * Wait for any loading spinners to disappear
   */
  async waitForLoadingToFinish(): Promise<void> {
    // Wait for common loading indicators to disappear
    const spinner = this.page.locator('[class*="animate-spin"]');
    if (await spinner.count() > 0) {
      await spinner.first().waitFor({ state: 'hidden', timeout: 30000 });
    }
  }

  /**
   * Take a screenshot with a descriptive name
   */
  async takeScreenshot(name: string): Promise<void> {
    await this.page.screenshot({ path: `e2e/screenshots/${name}.png` });
  }

  /**
   * Get a locator by test ID
   */
  getByTestId(testId: string): Locator {
    return this.page.locator(`[data-testid="${testId}"]`);
  }
}
