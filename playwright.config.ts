import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E Test Configuration for nirs4all_webapp
 *
 * Supports both web mode (Vite dev server) and desktop mode (FastAPI serving static files).
 * Run specific mode with: npm run e2e:web or npm run e2e:desktop
 */
export default defineConfig({
  testDir: './e2e/tests',

  // Test execution settings — sequential to avoid shared backend state conflicts
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,

  // Test timeout
  timeout: 60000,

  // Reporter configuration
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
    ...(process.env.CI ? [['github'] as const] : []),
  ],

  // Global settings
  use: {
    // Default base URL (overridden per project)
    baseURL: 'http://localhost:5173',

    // Force English locale for deterministic tests regardless of system language
    locale: 'en-US',

    // Tracing and debugging
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',

    // Timeouts — Vite proxy to FastAPI can be slow on Windows
    actionTimeout: 15000,
    navigationTimeout: 60000,
  },

  // Global setup for test data preparation
  globalSetup: './e2e/fixtures/global-setup.ts',

  // Projects for different browsers and modes
  projects: [
    // Run settings mutations in isolation first to avoid cross-file backend contention.
    {
      name: 'web-chromium-settings',
      testMatch: ['**/settings.spec.ts'],
      workers: 1,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:5173',
      },
    },

    // Run navigation tests in isolation to avoid route-transition flakes under heavy parallel load.
    {
      name: 'web-chromium-navigation',
      testMatch: ['**/navigation.spec.ts'],
      workers: 1,
      dependencies: ['web-chromium-settings'],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:5173',
      },
    },

    // Run smoke tests in isolation to avoid backend readiness checks racing against heavy parallel suites.
    {
      name: 'web-chromium-smoke',
      testMatch: ['**/smoke.spec.ts'],
      workers: 1,
      dependencies: ['web-chromium-navigation'],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:5173',
      },
    },

    // Web mode tests (Vite dev server + FastAPI backend)
    {
      name: 'web-chromium',
      dependencies: ['web-chromium-smoke'],
      testIgnore: ['**/settings.spec.ts', '**/navigation.spec.ts', '**/smoke.spec.ts'],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:5173',
      },
    },
    {
      name: 'web-firefox',
      use: {
        ...devices['Desktop Firefox'],
        baseURL: 'http://localhost:5173',
      },
    },
    {
      name: 'web-webkit',
      use: {
        ...devices['Desktop Safari'],
        baseURL: 'http://localhost:5173',
      },
    },

    // Desktop mode tests (FastAPI serves static build)
    {
      name: 'desktop-chromium',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:8000',
      },
    },
  ],

  // Web server configuration - auto-start dev servers
  webServer: [
    // Backend API server (always needed)
    {
      command: process.env.CI
        ? 'python main.py --no-reload'
        : process.platform === 'win32'
          ? '..\\.venv\\Scripts\\python main.py --no-reload'
          : '../.venv/bin/python main.py --no-reload',
      url: 'http://localhost:8000/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
      stdout: process.env.CI ? 'ignore' : 'pipe',
      stderr: 'pipe',
    },
    // Frontend dev server (for web mode projects)
    {
      command: 'npm run dev -- --port 5173',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
      stdout: process.env.CI ? 'ignore' : 'pipe',
      stderr: 'pipe',
    },
  ],
});
