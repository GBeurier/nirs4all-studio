import { defineConfig, devices } from '@playwright/test';
import { resolveE2eRuntimeConfig } from './e2e/fixtures/e2e-env';

const e2eRuntime = resolveE2eRuntimeConfig();
const nodeExecutable = JSON.stringify(process.execPath);

function buildWebServerEnv(overrides: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') {
      env[key] = value;
    }
  }
  return { ...env, ...overrides };
}

const backendWebServerEnv = buildWebServerEnv({
  NIRS4ALL_CONFIG: e2eRuntime.configDir,
  NIRS4ALL_E2E: '1',
  NIRS4ALL_E2E_BACKEND_URL: e2eRuntime.backendUrl,
  NIRS4ALL_PORT: String(e2eRuntime.backendPort),
  NIRS4ALL_PORTABLE_ROOT: e2eRuntime.portableRoot,
  SENTRY_DSN: '',
});
const frontendWebServerEnv = buildWebServerEnv({
  NIRS4ALL_E2E_BACKEND_URL: e2eRuntime.backendUrl,
  VITE_SENTRY_DSN: '',
});

/**
 * Playwright E2E Test Configuration for nirs4all_webapp
 *
 * Exercises the browser renderer through Vite while the product API and
 * WebSocket surface are owned by the Rust sidecar.
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
    baseURL: e2eRuntime.frontendUrl,

    // Force English locale for deterministic tests regardless of system language
    locale: 'en-US',

    // Tracing and debugging
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',

    // Timeouts — a cold Rust build plus the Vite proxy can be slow on Windows
    actionTimeout: 15000,
    navigationTimeout: 60000,
  },

  // Global setup for test data preparation
  globalSetup: './e2e/fixtures/global-setup.ts',

  // Projects for different browsers and modes
  projects: [
    // Run settings mutations in isolation first to avoid cross-file backend contention.
    // These tests each do several full navigations + reloads + backend round-trips
    // serially (workers:1); under WSL2 / a cold OS cache the per-test wall clock can
    // exceed the 60s default, so give the heavy serial projects more headroom.
    {
      name: 'web-chromium-settings',
      testMatch: ['**/settings.spec.ts'],
      workers: 1,
      timeout: 120000,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: e2eRuntime.frontendUrl,
      },
    },

    // Run navigation tests in isolation to avoid route-transition flakes under heavy parallel load.
    {
      name: 'web-chromium-navigation',
      testMatch: ['**/navigation.spec.ts'],
      workers: 1,
      timeout: 120000,
      dependencies: ['web-chromium-settings'],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: e2eRuntime.frontendUrl,
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
        baseURL: e2eRuntime.frontendUrl,
      },
    },

    // Web mode tests (Vite dev server + Rust product sidecar)
    {
      name: 'web-chromium',
      dependencies: ['web-chromium-smoke'],
      testIgnore: ['**/settings.spec.ts', '**/navigation.spec.ts', '**/smoke.spec.ts'],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: e2eRuntime.frontendUrl,
      },
    },
    {
      name: 'web-firefox',
      use: {
        ...devices['Desktop Firefox'],
        baseURL: e2eRuntime.frontendUrl,
      },
    },
    {
      name: 'web-webkit',
      use: {
        ...devices['Desktop Safari'],
        baseURL: e2eRuntime.frontendUrl,
      },
    },

  ],

  // Web server configuration - auto-start dev servers
  webServer: [
    // Product API server (always Rust; CPython never owns this port).
    {
      command: `cargo run --manifest-path sidecar/Cargo.toml --locked -- --host ${e2eRuntime.backendHost} --port ${e2eRuntime.backendPort}`,
      url: `${e2eRuntime.backendUrl}/api/health`,
      reuseExistingServer: e2eRuntime.reuseExistingServer,
      timeout: 120000,
      stdout: process.env.CI ? 'ignore' : 'pipe',
      stderr: 'pipe',
      env: backendWebServerEnv,
    },
    // Frontend dev server (for web mode projects)
    {
      // Reuse the Node executable that loaded Playwright. This avoids npm
      // crossing into a host Windows installation from a WSL checkout.
      command: `${nodeExecutable} node_modules/vite/bin/vite.js --host ${e2eRuntime.frontendHost} --port ${e2eRuntime.frontendPort} --strictPort`,
      url: e2eRuntime.frontendUrl,
      reuseExistingServer: e2eRuntime.reuseExistingServer,
      timeout: 120000,
      stdout: process.env.CI ? 'ignore' : 'pipe',
      stderr: 'pipe',
      env: frontendWebServerEnv,
    },
  ],
});
