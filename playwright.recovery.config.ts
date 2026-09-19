import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Deliberately starts dedicated servers: never reuse a developer's workspace.
const root = process.env.RECOVERY_E2E_ROOT ||= mkdtempSync(join(tmpdir(), 'studio-recovery-e2e-'));
const apiPort = Number(process.env.RECOVERY_E2E_API_PORT || 8156);
const uiPort = Number(process.env.RECOVERY_E2E_UI_PORT || 5196);
process.env.PLAYWRIGHT_API_BASE_URL = `http://127.0.0.1:${apiPort}`;
const python = process.env.RECOVERY_E2E_PYTHON || 'python';

export default defineConfig({
  testDir: './e2e/tests',
  testMatch: ['pipeline-editor-handoff.spec.ts', 'partial-results-visibility.spec.ts'],
  workers: 1,
  retries: 0,
  timeout: 90000,
  globalSetup: './e2e/fixtures/recovery-setup.ts',
  reporter: [['list']],
  use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${uiPort}`, locale: 'en-US',
    viewport: { width: 1600, height: 1100 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: [
    { command: `"${python}" -m uvicorn main:app --host 127.0.0.1 --port ${apiPort}`,
      url: `${process.env.PLAYWRIGHT_API_BASE_URL}/api/health`, reuseExistingServer: false, timeout: 90000,
      env: { NIRS4ALL_CONFIG: join(root, 'config'), NIRS4ALL_PORTABLE_ROOT: root,
        NIRS4ALL_WORKSPACE: join(root, 'workspace'),
        SENTRY_DSN: '', OPENBLAS_NUM_THREADS: '1', OMP_NUM_THREADS: '1' } },
    { command: `"${process.execPath}" node_modules/vite/bin/vite.js --config e2e/vite.recovery.config.ts --host 127.0.0.1 --port ${uiPort} --strictPort`,
      url: `http://127.0.0.1:${uiPort}`, reuseExistingServer: false, timeout: 60000 },
  ],
});
