import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E Test Configuration for nirs4all_webapp
 *
 * Supports both web mode (Vite dev server) and desktop mode (FastAPI serving static files).
 * Run specific mode with: npm run e2e:web or npm run e2e:desktop
 */
export default defineConfig({
  testDir: './e2e/tests',

  // Test execution settings
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,

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

    // Tracing and debugging
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',

    // Timeouts
    actionTimeout: 10000,
    navigationTimeout: 30000,
  },

  // Global setup for test data preparation
  globalSetup: './e2e/fixtures/global-setup.ts',

  // Projects for different browsers and modes
  projects: [
    // Web mode tests (Vite dev server + FastAPI backend)
    {
      name: 'web-chromium',
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
