/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const desktop = {
    platform: 'linux', startEnvSetup: vi.fn(), restartBackend: vi.fn(),
    detectExistingEnvs: vi.fn(), getCurrentEnvSummary: vi.fn(), isPortable: vi.fn(),
    onEnvSetupProgress: vi.fn(() => () => {}),
  };
  Object.defineProperty(window, 'electronApi', { configurable: true, value: desktop });
  return { desktop, align: vi.fn(), complete: vi.fn(), get: vi.fn(), reset: vi.fn(),
    config: { profiles: [{ id: 'cpu-lite', label: 'CPU Lite', description: 'Standard CPU',
      platforms: [], packages: {} }], optional: [] },
    gpu: { has_cuda: false, has_metal: false, recommended_profiles: ['cpu-lite'] },
  };
});
vi.mock('@/api/config', () => ({
  alignConfig: mocks.align, completeSetup: mocks.complete,
  detectGPU: async () => mocks.gpu, getRecommendedConfig: async () => mocks.config,
  getSetupStatus: async () => ({}), skipSetup: vi.fn(),
}));
vi.mock('@/api/system', () => ({ getRuntimeSummary: async () => ({ core_ready: true, missing_optional_packages: [] }) }));
vi.mock('@/api/transport', () => ({ api: { get: mocks.get }, resetBackendUrl: mocks.reset }));
vi.mock('@/api/updates', () => ({ requestRestart: vi.fn() }));
vi.mock('@/api/dependencies', () => ({ getDependencies: async () => ({ categories: [] }) }));
vi.mock('@/hooks/useRecommendedConfig', () => ({
  useRecommendedConfig: () => ({ data: mocks.config, isLoading: false }),
  useGPUDetection: () => ({ data: mocks.gpu, isLoading: false }),
  useCompleteSetup: () => ({ mutateAsync: mocks.complete }),
  useSkipSetup: () => ({ mutate: vi.fn() }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import EnvSetup from './EnvSetup';
import SetupWizard from '@/pages/SetupWizard';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let client: QueryClient;
let ready: { ml_ready: boolean; workspace_ready: boolean; requires_restart?: boolean; ml_error?: string };

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  document.documentElement.classList.add('reduce-motion');
  mocks.desktop.startEnvSetup.mockResolvedValue({ success: true });
  mocks.desktop.restartBackend.mockResolvedValue({ success: true });
  mocks.desktop.detectExistingEnvs.mockResolvedValue([]);
  mocks.desktop.getCurrentEnvSummary.mockResolvedValue(null);
  mocks.desktop.isPortable.mockResolvedValue(false);
  mocks.complete.mockResolvedValue({ success: true });
  mocks.align.mockImplementation(async ({ dry_run }: { dry_run?: boolean }) => ({
    success: true, installed: dry_run ? ['nirs4all'] : [], requires_restart: !dry_run,
  }));
  ready = { ml_ready: false, workspace_ready: false, requires_restart: true };
  mocks.get.mockImplementation(async (path: string) => {
    if (path === '/system/readiness') return ready;
    if (path === '/config/install-log') return { lines: [], status: 'idle' };
    throw new Error(`Unexpected request ${path}`);
  });
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear(); container.remove();
  vi.useRealTimers(); document.documentElement.classList.remove('reduce-motion');
});
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function click(label: string) {
  const button = [...container.querySelectorAll('button')].find(element => element.textContent?.includes(label));
  expect(button, `Missing ${label}: ${container.textContent}`).toBeDefined();
  await act(async () => { button!.click(); });
}
async function install(screen: 'bootstrap' | 'wizard') {
  await act(async () => { root.render(<QueryClientProvider client={client}><MemoryRouter>
    {screen === 'bootstrap' ? <EnvSetup onComplete={vi.fn()} /> : <SetupWizard />}
  </MemoryRouter></QueryClientProvider>); });
  if (screen === 'bootstrap') await click('setupWizard.env.autoSetup');
  await advance(2500);
  await click('common.next');
  await click('setupWizard.extras.install');
}

describe.each(['bootstrap', 'wizard'] as const)('%s first installation', screen => {
  it('restarts changed Python and waits for ML and workspace readiness before completing setup', async () => {
    await install(screen);
    expect(mocks.desktop.restartBackend).toHaveBeenCalledExactlyOnceWith({ skipEnsure: true });
    expect(container.textContent).toContain('Restarting the Python environment');
    expect(mocks.complete).not.toHaveBeenCalled();
    ready = { ml_ready: true, workspace_ready: false };
    await advance(500);
    expect(mocks.complete).not.toHaveBeenCalled();
    ready = { ml_ready: true, workspace_ready: true, requires_restart: true };
    await advance(500);
    expect(mocks.complete).not.toHaveBeenCalled();
    ready = { ml_ready: true, workspace_ready: true };
    await advance(500);
    expect(mocks.complete).toHaveBeenCalledTimes(1);
    await advance(500);
    expect(container.textContent).toContain('setupWizard.ready');
  });
  it('surfaces a failed new Python runtime instead of marking setup complete', async () => {
    ready = { ml_ready: false, workspace_ready: true, ml_error: 'Cannot import installed operator' };
    await install(screen);
    expect(container.textContent).toContain('Cannot import installed operator');
    expect(container.textContent).toContain('Installation failed');
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it('does not restart Python when alignment did not change packages', async () => {
    mocks.align.mockResolvedValue({ success: true, installed: [], requires_restart: false });
    await install(screen);
    expect(mocks.desktop.restartBackend).not.toHaveBeenCalled();
    expect(mocks.complete).toHaveBeenCalledTimes(1);
  });
});
