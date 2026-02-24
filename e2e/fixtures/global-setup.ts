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
    let retries = 30; // 30 seconds max wait
    let backendReady = false;

    while (retries > 0 && !backendReady) {
      try {
        const response = await page.request.get('http://127.0.0.1:8000/api/health');
        if (response.ok()) {
          console.log('Backend is ready');
          backendReady = true;
        }
      } catch {
        retries--;
        if (retries === 0) {
          console.warn('Backend health check timed out - tests may fail if backend is not running');
        } else {
          await page.waitForTimeout(1000);
        }
      }
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
    }
  } finally {
    await browser.close();
  }
}

export default globalSetup;
