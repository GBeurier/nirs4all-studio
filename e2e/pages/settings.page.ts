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
    // Set up response listener BEFORE navigation to catch the settings GET
    // that fires when UISettingsContext.loadFromWorkspace() runs on mount.
    const settingsSynced = this.page.waitForResponse(
      (response) =>
        response.url().includes('/api/workspace/settings') &&
        response.request().method() === 'GET' &&
        response.status() === 200,
      { timeout: 30000 }
    );
    await super.goto('/settings');
    // Wait for the backend sync to complete, then allow React to process
    // the setHasWorkspace(true) state update before we interact with controls.
    await settingsSynced;
    await this.zoomToggleGroup.waitFor({ state: 'visible', timeout: 15000 });
    // loadFromWorkspace() sets hasWorkspace(true) after the GET response.
    // React 19 batches state updates — wait for the next render cycle to ensure
    // hasWorkspace is propagated before we interact with settings controls.
    await this.page.waitForTimeout(1000);
  }

  /**
   * Wait for settings to be fully loaded and controls to be enabled.
   * Call this after page reloads to ensure settings are ready for interaction.
   *
   * The UISettingsContext calls loadFromWorkspace() on mount, which sets
   * hasWorkspace=true when the GET /api/workspace/settings succeeds.
   * We need to wait for this to complete before interacting with controls,
   * otherwise clicks won't trigger PUT API calls to persist changes.
   */
  async waitForSettingsReady(): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded');
    await this.zoomToggleGroup.waitFor({ state: 'visible', timeout: 15000 });
    // Wait for UISettingsContext.loadFromWorkspace() to complete and React to
    // process the setHasWorkspace(true) state update.
    await this.page.waitForTimeout(1000);
  }

  /**
   * Reset settings to defaults via API and clear browser-side caches.
   * Call before navigating to settings to ensure a clean starting state.
   */
  async resetToDefaults(): Promise<void> {
    const data = {
      general: {
        theme: 'system',
        ui_density: 'comfortable',
        reduce_animations: false,
        sidebar_collapsed: false,
        zoom_level: 100,
        language: 'en',
      },
    };
    // Retry to handle transient ECONNREFUSED under parallel load (backend may be
    // briefly unresponsive for 1-2s due to Windows asyncio ProactorEventLoop issues)
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await this.page.request.put('/api/workspace/settings', { data, timeout: 10000 });
        break;
      } catch {
        if (attempt === 4) throw new Error('Failed to reset settings after 5 attempts');
        await this.page.waitForTimeout(1000);
      }
    }
  }

  /**
   * Navigate to settings with clean browser state.
   * Navigates to /settings (establishing page context), resets backend via API,
   * clears stale localStorage, then reloads for a fresh start.
   */
  async gotoClean(): Promise<void> {
    // Navigate to settings (establishes page context for API calls + localStorage)
    await this.page.goto('/settings', { waitUntil: 'domcontentloaded' });

    // Reset backend settings via API (now the page context exists for Vite proxy)
    await this.resetToDefaults();

    // Clear stale localStorage cached from previous tests
    await this.page.evaluate(() => {
      localStorage.removeItem('nirs4all-ui-density');
      localStorage.removeItem('nirs4all-reduce-animations');
      localStorage.removeItem('nirs4all-ui-zoom');
      localStorage.removeItem('nirs4all-language');
    });

    // Set up listener for the settings GET that fires when the React app syncs
    // with the backend. This ensures hasWorkspace=true before we interact.
    const settingsSynced = this.page.waitForResponse(
      (response) =>
        response.url().includes('/api/workspace/settings') &&
        response.request().method() === 'GET' &&
        response.status() === 200,
      { timeout: 30000 }
    );

    // Reload so the React app starts fresh with empty localStorage + reset backend
    await this.page.reload({ waitUntil: 'domcontentloaded' });

    // Wait for the backend settings sync to complete (sets hasWorkspace=true in the
    // UISettingsContext, so that clicking settings triggers PUT API calls).
    await settingsSynced;
    await this.zoomToggleGroup.waitFor({ state: 'visible', timeout: 15000 });
    // Wait for React to process the setHasWorkspace(true) state update
    await this.page.waitForTimeout(1000);
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
   * Retries if the PUT doesn't fire — hasWorkspace may not be true yet
   * (the UISettingsContext needs to finish loadFromWorkspace before PUT calls work).
   */
  private async clickAndWaitForPut(locator: Locator): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const responsePromise = this.page.waitForResponse(
        (response) =>
          response.url().includes('/api/workspace/settings') &&
          response.request().method() === 'PUT' &&
          response.status() === 200,
        { timeout: 10000 }
      );
      await locator.click();
      try {
        await responsePromise;
        return;
      } catch {
        // PUT didn't fire — workspace sync may not be complete yet
        await this.page.waitForTimeout(2000);
      }
    }
    throw new Error('Settings PUT never fired after 3 attempts — workspace may not be connected');
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
  }

  /**
   * Set the UI density
   */
  async setDensity(density: Density): Promise<void> {
    const capitalizedDensity = density.charAt(0).toUpperCase() + density.slice(1);
    const densityButton = this.page.getByRole('radio', { name: capitalizedDensity });
    await this.clickAndWaitForPut(densityButton);
    await expect(this.page.locator('html')).toHaveClass(new RegExp(`density-${density}`), { timeout: 3000 });
  }

  /**
   * Set the zoom level
   */
  async setZoomLevel(level: ZoomLevel): Promise<void> {
    const zoomButton = this.page.getByRole('radio', { name: `${level}%` });
    await this.clickAndWaitForPut(zoomButton);
  }

  /**
   * Toggle the reduce animations setting
   */
  async toggleReduceAnimations(): Promise<void> {
    await this.clickAndWaitForPut(this.reduceAnimationsSwitch.first());
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
