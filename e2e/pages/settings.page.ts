import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';

type ZoomLevel = 75 | 80 | 90 | 100 | 110 | 125 | 150;
type Density = 'compact' | 'comfortable' | 'spacious';
type Theme = 'light' | 'dark' | 'system';

/**
 * Page object for the Settings page
 */
export class SettingsPage extends BasePage {
  // Page elements
  readonly pageTitle: Locator;

  // Tabs
  readonly generalTab: Locator;
  readonly workspacesTab: Locator;
  readonly dataTab: Locator;
  readonly advancedTab: Locator;

  // Theme buttons
  readonly themeLightButton: Locator;
  readonly themeDarkButton: Locator;
  readonly themeSystemButton: Locator;

  // Zoom level buttons (toggle group)
  readonly zoomToggleGroup: Locator;

  // Density buttons (toggle group)
  readonly densityToggleGroup: Locator;

  // Reduce animations switch
  readonly reduceAnimationsSwitch: Locator;

  constructor(page: Page) {
    super(page);

    this.pageTitle = page.getByRole('heading', { name: /settings/i });

    // Tabs
    this.generalTab = page.getByRole('tab', { name: /general/i });
    this.workspacesTab = page.getByRole('tab', { name: /workspaces/i });
    this.dataTab = page.getByRole('tab', { name: /data/i });
    this.advancedTab = page.getByRole('tab', { name: /advanced/i });

    // Theme buttons - look for buttons within theme section
    this.themeLightButton = page.getByRole('button', { name: /light/i });
    this.themeDarkButton = page.getByRole('button', { name: /dark/i });
    this.themeSystemButton = page.getByRole('button', { name: /system/i });

    // Toggle groups for zoom and density
    this.zoomToggleGroup = page.locator('[role="group"]').filter({ hasText: /75%|100%|150%/ });
    this.densityToggleGroup = page.locator('[role="group"]').filter({ hasText: /compact|comfortable|spacious/i });

    // Reduce animations switch
    this.reduceAnimationsSwitch = page.getByRole('switch');
  }

  async goto(): Promise<void> {
    await this.page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await this.waitForSettingsReady();
  }

  /**
   * Wait for settings to be fully loaded and workspace connected after a page load/reload.
   * Uses BasePage.waitForAppReady() for workspace readiness, then waits for settings controls.
   */
  async waitForSettingsReady(): Promise<void> {
    await this.waitForAppReady();
    await this.zoomToggleGroup.waitFor({ state: 'visible', timeout: 15000 });
    await this.page.waitForFunction(
      () => {
        const marker = document.documentElement.dataset.themeReady;
        return marker === undefined || marker === 'true';
      },
      null,
      { timeout: 15000 },
    );
  }

  /**
   * Reset settings to defaults via API.
   */
  async resetToDefaults(): Promise<void> {
    await this.page.request.put('/api/workspace/settings', {
      data: {
        general: {
          theme: 'system',
          ui_density: 'comfortable',
          reduce_animations: false,
          sidebar_collapsed: false,
          zoom_level: 100,
          language: 'en',
        },
      },
      timeout: 30000,
    });
  }

  /**
   * Navigate to settings with clean browser state.
   * Resets backend settings, clears localStorage, then reloads for a fresh start.
   */
  async gotoClean(): Promise<void> {
    await this.page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await this.waitForAppReady();

    // Reset backend settings + clear stale localStorage
    await this.resetToDefaults();
    await this.page.evaluate(() => {
      localStorage.removeItem('nirs4all-ui-density');
      localStorage.removeItem('nirs4all-reduce-animations');
      localStorage.removeItem('nirs4all-ui-zoom');
      localStorage.removeItem('nirs4all-language');
      localStorage.removeItem('nirs4all-theme');
    });

    // Reload so the React app starts fresh with reset backend + empty localStorage
    await this.page.reload({ waitUntil: 'domcontentloaded' });
    await this.waitForSettingsReady();
  }

  /**
   * Select a settings tab
   */
  async selectTab(tab: 'general' | 'workspaces' | 'data' | 'advanced'): Promise<void> {
    const tabMap: Record<string, Locator> = {
      general: this.generalTab,
      workspaces: this.workspacesTab,
      data: this.dataTab,
      advanced: this.advancedTab,
    };
    await tabMap[tab].click();
  }

  /**
   * Click a settings control and wait for the backend PUT to complete.
   */
  private async clickAndWaitForPut(locator: Locator): Promise<void> {
    const responsePromise = this.page.waitForResponse(
      (response) =>
        response.url().includes('/api/workspace/settings') &&
        response.request().method() === 'PUT' &&
        response.status() === 200,
      { timeout: 15000 }
    ).then(() => true).catch(() => false);
    await locator.click();
    const putObserved = await responsePromise;

    // Fallback: under transient backend contention the UI may still update even if the PUT
    // response is delayed or skipped (e.g., temporary workspace-disconnected state).
    if (!putObserved) {
      await this.page.waitForTimeout(300);
    }
  }

  /**
   * Poll localStorage until the expected key/value is persisted.
   */
  private async waitForLocalStorageSetting(
    key: string,
    expected: string,
  ): Promise<void> {
    await expect.poll(
      async () => {
        try {
          return await this.page.evaluate((storageKey) => localStorage.getItem(storageKey), key);
        } catch {
          return null;
        }
      },
      {
        timeout: 10000,
        intervals: [100, 250, 500],
      },
    ).toBe(expected);
  }

  /**
   * Set the theme
   */
  async setTheme(theme: Theme): Promise<void> {
    const themeMap: Record<Theme, Locator> = {
      light: this.themeLightButton,
      dark: this.themeDarkButton,
      system: this.themeSystemButton,
    };
    await this.clickAndWaitForPut(themeMap[theme]);
    await this.waitForLocalStorageSetting('nirs4all-theme', theme);
  }

  /**
   * Set the UI density
   */
  async setDensity(density: Density): Promise<void> {
    const capitalizedDensity = density.charAt(0).toUpperCase() + density.slice(1);
    const densityButton = this.page.getByRole('radio', { name: capitalizedDensity });
    await this.clickAndWaitForPut(densityButton);
    await this.waitForLocalStorageSetting('nirs4all-ui-density', density);
    await expect(this.page.locator('html')).toHaveClass(new RegExp(`density-${density}`), { timeout: 3000 });
  }

  /**
   * Set the zoom level
   */
  async setZoomLevel(level: ZoomLevel): Promise<void> {
    const zoomButton = this.page.getByRole('radio', { name: `${level}%` });
    await this.clickAndWaitForPut(zoomButton);
    await this.waitForLocalStorageSetting('nirs4all-ui-zoom', String(level));
  }

  /**
   * Toggle the reduce animations setting
   */
  async toggleReduceAnimations(): Promise<void> {
    const wasChecked = await this.reduceAnimationsSwitch.first().isChecked().catch(() => false);
    await this.clickAndWaitForPut(this.reduceAnimationsSwitch.first());
    await this.waitForLocalStorageSetting('nirs4all-reduce-animations', String(!wasChecked));
  }

  /**
   * Assert that the zoom level is set correctly via CSS variable
   */
  async expectZoomLevel(level: ZoomLevel): Promise<void> {
    const zoomVar = await this.page.evaluate(() => {
      return getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom');
    });
    const expectedValue = level / 100;
    expect(parseFloat(zoomVar)).toBeCloseTo(expectedValue, 2);
  }

  /**
   * Assert that the zoom class is applied to html element
   */
  async expectZoomClass(level: ZoomLevel): Promise<void> {
    const html = this.page.locator('html');
    await expect(html).toHaveClass(new RegExp(`zoom-${level}`));
  }

  /**
   * Assert that the density class is applied
   */
  async expectDensityClass(density: Density): Promise<void> {
    const html = this.page.locator('html');
    await expect(html).toHaveClass(new RegExp(`density-${density}`));
  }

  /**
   * Assert that density CSS variables are correctly set
   * This verifies the actual computed values, not just class presence
   */
  async expectDensityValues(density: Density): Promise<void> {
    const expectedValues: Record<Density, { fontSize: string; spacingMd: string }> = {
      compact: { fontSize: '13px', spacingMd: '8px' },     // 0.8125rem, 0.5rem
      comfortable: { fontSize: '14px', spacingMd: '16px' }, // 0.875rem, 1rem
      spacious: { fontSize: '16px', spacingMd: '24px' },    // 1rem, 1.5rem
    };

    const { fontSize, spacingMd } = await this.page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return {
        fontSize: style.getPropertyValue('--density-font-size').trim(),
        spacingMd: style.getPropertyValue('--density-spacing-md').trim(),
      };
    });

    const expected = expectedValues[density];
    // Convert rem to approximate px for comparison (assuming 16px root)
    const fontSizePx = parseFloat(fontSize) * 16;
    const spacingMdPx = parseFloat(spacingMd) * 16;

    expect(Math.round(fontSizePx)).toBe(parseInt(expected.fontSize));
    expect(Math.round(spacingMdPx)).toBe(parseInt(expected.spacingMd));
  }

  /**
   * Assert that the theme class is applied
   */
  async expectThemeClass(theme: 'light' | 'dark'): Promise<void> {
    const html = this.page.locator('html');
    await expect(html).toHaveClass(new RegExp(theme));
  }

  /**
   * Assert that reduce-motion class is present or absent
   */
  async expectReduceMotion(enabled: boolean): Promise<void> {
    const html = this.page.locator('html');
    if (enabled) {
      await expect(html).toHaveClass(/reduce-motion/);
    } else {
      await expect(html).not.toHaveClass(/reduce-motion/);
    }
  }
}
