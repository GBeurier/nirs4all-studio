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
    await super.goto('/settings');
    // Wait for the UI to finish loading (controls become enabled)
    // This directly checks the React state rather than tracking HTTP responses,
    // which avoids race conditions between API responses and React state updates.
    await this.waitForSettingsReady();
  }

  /**
   * Wait for settings to be fully loaded and controls to be enabled.
   * Call this after page reloads to ensure settings are ready for interaction.
   */
  async waitForSettingsReady(): Promise<void> {
    // Wait for the density controls to be enabled (indicates settings have loaded).
    // Use a longer timeout for CI environments where backend + React hydration is slower.
    const compactButton = this.page.getByRole('radio', { name: 'Compact' });
    await expect(compactButton).toBeEnabled({ timeout: 15000 });
  }

  /**
   * Reset settings to defaults via API to ensure test isolation
   */
  async resetToDefaults(): Promise<void> {
    // The backend API always runs on port 8000
    await this.page.request.put('http://localhost:8000/api/workspace/settings', {
      data: {
        general: {
          theme: 'system',
          ui_density: 'comfortable',
          reduce_animations: false,
          sidebar_collapsed: false,
          zoom_level: 100,
        },
      },
    });
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
   * Set the theme and wait for the API call to complete
   */
  async setTheme(theme: Theme): Promise<void> {
    const themeMap: Record<Theme, Locator> = {
      light: this.themeLightButton,
      dark: this.themeDarkButton,
      system: this.themeSystemButton,
    };
    // Wait for the settings API call to complete after clicking
    const responsePromise = this.page.waitForResponse(
      (response) =>
        response.url().includes('/api/workspace/settings') &&
        response.request().method() === 'PUT' &&
        response.status() === 200,
      { timeout: 5000 }
    );
    await themeMap[theme].click();
    await responsePromise;
  }

  /**
   * Set the UI density and wait for the API call to complete
   */
  async setDensity(density: Density): Promise<void> {
    // Capitalize the density name to match the radio button label
    const capitalizedDensity = density.charAt(0).toUpperCase() + density.slice(1);
    // Find the toggle item with the density name
    const densityButton = this.page.getByRole('radio', { name: capitalizedDensity });
    // Wait for the settings API call to complete after clicking
    const responsePromise = this.page.waitForResponse(
      (response) =>
        response.url().includes('/api/workspace/settings') &&
        response.request().method() === 'PUT' &&
        response.status() === 200,
      { timeout: 5000 }
    );
    await densityButton.click();
    await responsePromise;
    // Wait for the class change
    await expect(this.page.locator('html')).toHaveClass(new RegExp(`density-${density}`), { timeout: 3000 });
  }

  /**
   * Set the zoom level and wait for the API call to complete
   */
  async setZoomLevel(level: ZoomLevel): Promise<void> {
    const zoomButton = this.page.getByRole('radio', { name: `${level}%` });
    // Wait for the settings API call to complete after clicking
    const responsePromise = this.page.waitForResponse(
      (response) =>
        response.url().includes('/api/workspace/settings') &&
        response.request().method() === 'PUT' &&
        response.status() === 200,
      { timeout: 5000 }
    );
    await zoomButton.click();
    await responsePromise;
  }

  /**
   * Toggle the reduce animations setting and wait for the API call to complete
   */
  async toggleReduceAnimations(): Promise<void> {
    // Wait for the settings API call to complete after clicking
    const responsePromise = this.page.waitForResponse(
      (response) =>
        response.url().includes('/api/workspace/settings') &&
        response.request().method() === 'PUT' &&
        response.status() === 200,
      { timeout: 5000 }
    );
    await this.reduceAnimationsSwitch.first().click();
    await responsePromise;
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
