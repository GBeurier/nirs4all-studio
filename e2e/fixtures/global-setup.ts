import { chromium, type FullConfig } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    // Wait for backend to start (up to 15 seconds)
    let backendReady = false;
    for (let attempt = 0; attempt < 15; attempt++) {
      try {
        const response = await page.request.get('http://127.0.0.1:8000/api/health');
        if (response.ok()) {
          console.log('Backend is ready');
          backendReady = true;
          break;
        }
      } catch {
        if (attempt === 14) {
          console.warn('Backend health check timed out - tests may fail if backend is not running');
        } else {
          await page.waitForTimeout(1000);
        }
      }
    }

    // Wait for Vite dev server to be ready (proxies API requests to backend)
    let frontendReady = false;
    for (let attempt = 0; attempt < 15; attempt++) {
      try {
        const response = await page.request.get('http://localhost:5173/');
        if (response.ok()) {
          console.log('Frontend dev server is ready');
          frontendReady = true;
          break;
        }
      } catch {
        if (attempt === 14) {
          console.warn('Frontend dev server not responding — tests may fail');
        } else {
          await page.waitForTimeout(1000);
        }
      }
    }

    // Warm Vite's on-demand dependency optimization. The probe above fetches
    // index.html over HTTP, which does NOT load /src/main.tsx in a browser, so
    // esbuild's first-load optimizeDeps never runs. The first REAL navigation
    // then triggers it mid-load and Vite force-reloads the page — which
    // supersedes the navigation Playwright is tracking and makes
    // page.goto(waitUntil:'domcontentloaded') time out on a cold cache. We
    // absorb that one reload here so every test navigates against a warm cache.
    if (frontendReady) {
      // Visit the routes the timed projects start on so Vite has already
      // compiled their module subtrees (and run any one-time dep optimization
      // + reload) before the per-test 60s clock starts. The settings route is
      // the gate project, so warm it explicitly — its first cold compile would
      // otherwise land inside the first timed test.
      for (const route of ['/', '/settings']) {
        try {
          await page.goto(`http://localhost:5173${route}`, { waitUntil: 'commit', timeout: 30000 });
          await page.waitForLoadState('networkidle', { timeout: 90000 }).catch(() => {});
        } catch (e) {
          console.warn(`Vite warm-up navigation to ${route} failed:`, e);
        }
      }
      console.log('Vite dependency cache warmed');
    }

    // Skip first-launch setup wizard to prevent redirect to /setup during tests.
    // In CI the setup_status.json doesn't exist, so useStartupUpdateCheck would
    // redirect every page to /setup before tests can interact with it.
    if (backendReady) {
      try {
        const setupResponse = await page.request.get('http://127.0.0.1:8000/api/config/setup-status');
        if (setupResponse.ok()) {
          const status = await setupResponse.json();
          if (!status.setup_completed) {
            console.log('Skipping first-launch setup for E2E tests...');
            await page.request.post('http://127.0.0.1:8000/api/config/skip-setup');
          }
        }
      } catch (e) {
        console.warn('Could not skip setup:', e);
      }

      // Force English language in workspace settings for deterministic tests
      try {
        await page.request.put('http://127.0.0.1:8000/api/workspace/settings', {
          data: { general: { language: 'en' } },
        });
      } catch (e) {
        console.warn('Could not reset language to English:', e);
      }
    }
  } finally {
    await browser.close();
  }
}

export default globalSetup;
