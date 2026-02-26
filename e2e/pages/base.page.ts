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
    await this.page.goto(path, { waitUntil: 'domcontentloaded' });
    await this.waitForAppReady();
  }

  /**
   * Wait for page to be fully loaded (DOM only — use waitForAppReady for full readiness)
   */
  async waitForPageLoad(): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded');
  }

  /**
   * Wait for the React app to be fully initialized.
   * UISettingsContext sets data-ui-settings-ready on <html> once initial settings sync completes.
   * This must not depend on workspace connectivity, otherwise tests can deadlock on transient API delays.
   * This is the single gate all tests should pass through before interacting with the app.
   */
  async waitForAppReady(): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded');
    try {
      await this.page.waitForFunction(
        () => {
          const root = document.documentElement;
          return root.dataset.uiSettingsReady === 'true' || root.dataset.workspaceReady === 'true';
        },
        null,
        { timeout: 30000 },
      );
    } catch {
      // Fallback for transient backend saturation: allow extra time for app shell rendering.
      const shellVisible = await this.page.waitForFunction(
        () => {
          const isVisible = (selector: string): boolean => {
            const element = document.querySelector(selector) as HTMLElement | null;
            if (!element) return false;
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
          };
          return isVisible('div.bg-sidebar') || isVisible('main');
        },
        null,
        { timeout: 10000 },
      ).then(() => true).catch(() => false);

      if (!shellVisible) {
        // Last-resort tolerance: if the app has rendered meaningful DOM content,
        // let route-specific assertions decide readiness.
        const hasRenderedContent = await this.page.evaluate(() => {
          const body = document.body;
          if (!body) return false;
          const hasMainOrSidebar = Boolean(document.querySelector('main, div.bg-sidebar'));
          const hasHeadings = Boolean(document.querySelector('h1, h2, h3, [role="heading"]'));
          return body.children.length > 0 && (hasMainOrSidebar || hasHeadings);
        }).catch(() => false);

        if (!hasRenderedContent) {
          throw new Error('App did not reach ready state and shell is not visible');
        }
      }
    }
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
