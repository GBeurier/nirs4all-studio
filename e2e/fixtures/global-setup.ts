import { chromium, type FullConfig, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { resolveE2eRuntimeConfig } from './e2e-env';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const e2eRuntime = resolveE2eRuntimeConfig();

async function readResponseSnippet(response: { text: () => Promise<string> }): Promise<string> {
  const text = await response.text().catch((error: unknown) => `failed to read response body: ${error}`);
  return text.length > 500 ? `${text.slice(0, 500)}...` : text;
}

async function waitForBackend(page: Page): Promise<void> {
  const healthUrl = `${e2eRuntime.backendUrl}/api/health`;
  let lastResult = 'no attempts yet';

  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await page.request.get(healthUrl, { timeout: 5000 });
      const body = await readResponseSnippet(response);
      lastResult = `HTTP ${response.status()} ${body}`;

      if (response.ok()) {
        const data = JSON.parse(body) as { status?: unknown; core_ready?: unknown; ready?: unknown };
        if (data.status === 'healthy' && data.core_ready !== false && data.ready !== false) {
          console.log(`Backend is ready at ${healthUrl}`);
          return;
        }
      }
    } catch (error) {
      lastResult = error instanceof Error ? error.message : String(error);
    }

    await page.waitForTimeout(1000);
  }

  throw new Error(
    `Backend did not become healthy at ${healthUrl}. Last result: ${lastResult}. ` +
    `Check that NIRS4ALL_E2E_BACKEND_PORT=${e2eRuntime.backendPort} is free and that the backend process started successfully.`
  );
}

async function waitForFrontend(page: Page): Promise<void> {
  let lastResult = 'no attempts yet';

  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await page.request.get(`${e2eRuntime.frontendUrl}/`, { timeout: 5000 });
      lastResult = `HTTP ${response.status()} ${await readResponseSnippet(response)}`;
      if (response.ok()) {
        console.log(`Frontend dev server is ready at ${e2eRuntime.frontendUrl}`);
        return;
      }
    } catch (error) {
      lastResult = error instanceof Error ? error.message : String(error);
    }

    await page.waitForTimeout(1000);
  }

  throw new Error(
    `Frontend dev server did not become ready at ${e2eRuntime.frontendUrl}. Last result: ${lastResult}. ` +
    `Check that NIRS4ALL_E2E_FRONTEND_PORT=${e2eRuntime.frontendPort} is free.`
  );
}

/**
 * Global setup for E2E tests
 *
 * Runs once before all tests to:
 * - Ensure test data directories exist
 * - Verify backend health
 * - Skip first-launch setup wizard (prevents redirect to /setup)
 */
async function globalSetup(config: FullConfig) {
  // Ensure test data directory exists
  const testDataDir = path.resolve(__dirname, '../test-data');
  if (!fs.existsSync(testDataDir)) {
    fs.mkdirSync(testDataDir, { recursive: true });
  }

  // Create screenshots directory for test artifacts
  const screenshotsDir = path.resolve(__dirname, '../screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  // Wait for backend to be ready (health check with retry)
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    await waitForBackend(page);

    // Wait for Vite dev server to be ready (proxies API requests to backend)
    await waitForFrontend(page);

    // Warm Vite's on-demand dependency optimization. The probe above fetches
    // index.html over HTTP, which does NOT load /src/main.tsx in a browser, so
    // esbuild's first-load optimizeDeps never runs. The first REAL navigation
    // then triggers it mid-load and Vite force-reloads the page — which
    // supersedes the navigation Playwright is tracking and makes
    // page.goto(waitUntil:'domcontentloaded') time out on a cold cache. We
    // absorb that one reload here so every test navigates against a warm cache.
    // Visit the routes the timed projects start on so Vite has already
    // compiled their module subtrees (and run any one-time dep optimization
    // + reload) before the per-test 60s clock starts. The settings route is
    // the gate project, so warm it explicitly; its first cold compile would
    // otherwise land inside the first timed test.
    for (const route of ['/', '/settings']) {
      try {
        await page.goto(`${e2eRuntime.frontendUrl}${route}`, { waitUntil: 'commit', timeout: 30000 });
        await page.waitForLoadState('networkidle', { timeout: 90000 }).catch(() => {});
      } catch (e) {
        console.warn(`Vite warm-up navigation to ${route} failed:`, e);
      }
    }
    console.log('Vite dependency cache warmed');

    // Skip first-launch setup wizard to prevent redirect to /setup during tests.
    // In CI the setup_status.json doesn't exist, so useStartupUpdateCheck would
    // redirect every page to /setup before tests can interact with it.
    try {
      const setupResponse = await page.request.get(`${e2eRuntime.backendUrl}/api/config/setup-status`);
      if (!setupResponse.ok()) {
        throw new Error(`HTTP ${setupResponse.status()} ${await readResponseSnippet(setupResponse)}`);
      }
      const status = await setupResponse.json();
      if (!status.setup_completed) {
        console.log('Skipping first-launch setup for E2E tests...');
        const skipResponse = await page.request.post(`${e2eRuntime.backendUrl}/api/config/skip-setup`);
        if (!skipResponse.ok()) {
          throw new Error(`HTTP ${skipResponse.status()} ${await readResponseSnippet(skipResponse)}`);
        }
      }
    } catch (e) {
      throw new Error(`Could not prepare first-launch setup state: ${e}`);
    }

    // Force English in the Rust-owned application preferences. This setup must
    // not require an active scientific workspace merely to make UI tests
    // deterministic.
    try {
      const response = await page.request.put(`${e2eRuntime.backendUrl}/api/app/settings`, {
        data: { ui_preferences: { language: 'en' } },
      });
      if (!response.ok()) {
        throw new Error(`HTTP ${response.status()} ${await readResponseSnippet(response)}`);
      }
    } catch (e) {
      throw new Error(`Could not reset application language to English: ${e}`);
    }
  } finally {
    await browser.close();
  }
}

export default globalSetup;
