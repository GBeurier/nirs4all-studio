// Automated screenshot capture for nirs4all Studio documentation
// Usage: node docs/user-guide/take-screenshots.mjs

import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const IMG_DIR = join(__dirname, 'source', '_images');
const BASE_URL = 'http://localhost:5173';
const VIEWPORT = { width: 1280, height: 800 };

// Ensure directories exist
const sections = ['getting-started', 'datasets', 'pipelines', 'experiments', 'results', 'explore', 'lab', 'settings'];
for (const section of sections) {
  mkdirSync(join(IMG_DIR, section), { recursive: true });
}

async function screenshot(page, section, name) {
  const path = join(IMG_DIR, section, `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  console.log(`  Captured: ${section}/${name}.png`);
}

async function waitForPage(page, timeout = 3000) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(timeout);
}

async function main() {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();

  // ---- DATASETS PAGE ----
  console.log('\n--- Datasets Page ---');
  await page.goto(`${BASE_URL}/datasets`);
  await waitForPage(page);
  await screenshot(page, 'datasets', 'ds-page-overview');

  // ---- PIPELINES PAGE ----
  console.log('\n--- Pipelines Page ---');
  await page.goto(`${BASE_URL}/pipelines`);
  await waitForPage(page);
  await screenshot(page, 'pipelines', 'pl-page-overview');

  // ---- PIPELINE EDITOR ----
  console.log('\n--- Pipeline Editor ---');
  await page.goto(`${BASE_URL}/pipelines/new`);
  await waitForPage(page);
  await screenshot(page, 'pipelines', 'pe-overview');

  // ---- NEW EXPERIMENT ----
  console.log('\n--- New Experiment ---');
  await page.goto(`${BASE_URL}/editor`);
  await waitForPage(page);
  await screenshot(page, 'experiments', 'exp-wizard-overview');

  // ---- PLAYGROUND ----
  console.log('\n--- Playground ---');
  await page.goto(`${BASE_URL}/playground`);
  await waitForPage(page);
  await screenshot(page, 'explore', 'pg-overview');

  // ---- INSPECTOR ----
  console.log('\n--- Inspector ---');
  await page.goto(`${BASE_URL}/inspector`);
  await waitForPage(page);
  await screenshot(page, 'explore', 'ins-overview');

  // ---- RUNS / HISTORY ----
  console.log('\n--- History ---');
  await page.goto(`${BASE_URL}/runs`);
  await waitForPage(page);
  await screenshot(page, 'results', 'res-history-overview');

  // ---- RESULTS ----
  console.log('\n--- Results ---');
  await page.goto(`${BASE_URL}/results`);
  await waitForPage(page);
  await screenshot(page, 'results', 'res-scores-overview');

  // ---- AGGREGATED RESULTS ----
  console.log('\n--- Aggregated Results ---');
  await page.goto(`${BASE_URL}/results/aggregated`);
  await waitForPage(page);
  await screenshot(page, 'results', 'res-aggregated-overview');

  // ---- PREDICTIONS ----
  console.log('\n--- Predictions ---');
  await page.goto(`${BASE_URL}/predictions`);
  await waitForPage(page);
  await screenshot(page, 'results', 'res-predictions-overview');

  // ---- LAB: SYNTHESIS ----
  console.log('\n--- Lab: Synthesis ---');
  await page.goto(`${BASE_URL}/lab/synthesis`);
  await waitForPage(page);
  await screenshot(page, 'lab', 'lab-synthesis-overview');

  // ---- LAB: TRANSFER ----
  console.log('\n--- Lab: Transfer ---');
  await page.goto(`${BASE_URL}/lab/transfer`);
  await waitForPage(page);
  await screenshot(page, 'lab', 'lab-transfer-overview');

  // ---- LAB: SHAP ----
  console.log('\n--- Lab: SHAP ---');
  await page.goto(`${BASE_URL}/lab/shapley`);
  await waitForPage(page);
  await screenshot(page, 'lab', 'lab-shap-overview');

  // ---- SETTINGS: General ----
  console.log('\n--- Settings ---');
  await page.goto(`${BASE_URL}/settings`);
  await waitForPage(page);
  await screenshot(page, 'settings', 'st-general');

  // Try clicking workspace tab
  try {
    const workspaceTab = page.getByRole('tab', { name: /workspace/i }).or(page.locator('text=Workspace').first());
    if (await workspaceTab.isVisible()) {
      await workspaceTab.click();
      await page.waitForTimeout(1000);
      await screenshot(page, 'settings', 'st-workspaces');
    }
  } catch (e) { console.log('  Workspace tab not found, skipping'); }

  // Try clicking data defaults tab
  try {
    const dataTab = page.getByRole('tab', { name: /data/i }).or(page.locator('text=Data').first());
    if (await dataTab.isVisible()) {
      await dataTab.click();
      await page.waitForTimeout(1000);
      await screenshot(page, 'settings', 'st-data-defaults');
    }
  } catch (e) { console.log('  Data tab not found, skipping'); }

  // Try clicking advanced tab
  try {
    const advTab = page.getByRole('tab', { name: /advanced/i }).or(page.locator('text=Advanced').first());
    if (await advTab.isVisible()) {
      await advTab.click();
      await page.waitForTimeout(1000);
      await screenshot(page, 'settings', 'st-advanced');
    }
  } catch (e) { console.log('  Advanced tab not found, skipping'); }

  // ---- GETTING STARTED SCREENSHOTS ----
  // Reuse datasets page as "first launch" equivalent
  console.log('\n--- Getting Started ---');
  await page.goto(`${BASE_URL}/datasets`);
  await waitForPage(page);
  await screenshot(page, 'getting-started', 'gs-first-launch');

  // Take a sidebar-focused screenshot
  await screenshot(page, 'getting-started', 'gs-sidebar-overview');

  // ---- DARK THEME VARIANT ----
  console.log('\n--- Dark Theme ---');
  await page.goto(`${BASE_URL}/settings`);
  await waitForPage(page);
  // Try to toggle dark mode
  try {
    const darkOption = page.locator('text=Dark').first();
    if (await darkOption.isVisible()) {
      await darkOption.click();
      await page.waitForTimeout(1500);
      await page.goto(`${BASE_URL}/datasets`);
      await waitForPage(page);
      await screenshot(page, 'settings', 'st-dark-theme-preview');
      // Switch back to light
      await page.goto(`${BASE_URL}/settings`);
      await waitForPage(page);
      const lightOption = page.locator('text=Light').first();
      if (await lightOption.isVisible()) {
        await lightOption.click();
        await page.waitForTimeout(500);
      }
    }
  } catch (e) { console.log('  Dark theme toggle not found, skipping'); }

  console.log('\n--- Done! ---');
  await browser.close();
  console.log('All screenshots captured successfully.');
}

main().catch(err => {
  console.error('Screenshot capture failed:', err);
  process.exit(1);
});
