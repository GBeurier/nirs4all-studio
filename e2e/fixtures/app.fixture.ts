/* eslint-disable react-hooks/rules-of-hooks */
// Playwright fixture `use` callbacks are not React hooks; disable the rule for this file.
import { test as base, expect } from '@playwright/test';
import { SidebarPage } from '../pages/sidebar.page';
import { DatasetsPage } from '../pages/datasets.page';
import { PipelinesPage } from '../pages/pipelines.page';
import { RunsPage } from '../pages/runs.page';
import { PredictionsPage } from '../pages/predictions.page';
import { SettingsPage } from '../pages/settings.page';

/**
 * Custom test fixtures that provide page objects for each test
 */
export interface AppFixtures {
  sidebar: SidebarPage;
  datasetsPage: DatasetsPage;
  pipelinesPage: PipelinesPage;
  runsPage: RunsPage;
  predictionsPage: PredictionsPage;
  settingsPage: SettingsPage;
}

export const test = base.extend<AppFixtures>({
  sidebar: async ({ page }, use) => {
    const sidebar = new SidebarPage(page);
    await use(sidebar);
  },

  datasetsPage: async ({ page }, use) => {
    const datasetsPage = new DatasetsPage(page);
    await use(datasetsPage);
  },

  pipelinesPage: async ({ page }, use) => {
    const pipelinesPage = new PipelinesPage(page);
    await use(pipelinesPage);
  },

  runsPage: async ({ page }, use) => {
    const runsPage = new RunsPage(page);
    await use(runsPage);
  },

  predictionsPage: async ({ page }, use) => {
    const predictionsPage = new PredictionsPage(page);
    await use(predictionsPage);
  },

  settingsPage: async ({ page }, use) => {
    const settingsPage = new SettingsPage(page);
    await use(settingsPage);
  },
});

export { expect };
