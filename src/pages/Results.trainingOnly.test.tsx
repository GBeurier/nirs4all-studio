/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';

const transport = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/api/transport', () => ({ api: transport }));
vi.mock('@/context/useMlReadiness', () => ({ useMlReadiness: () => ({ mlReady: true, workspaceReady: true }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, fallback?: string | { defaultValue?: string }) => typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? key }) }));
// Closed chart/detail dialogs are outside this page load/refresh regression.
vi.mock('@/components/predictions/ChainDetailSheet', () => ({ ChainDetailSheet: () => null }));
vi.mock('@/components/predictions/viewer/PredictionViewer', () => ({ PredictionViewer: () => null }));
import Results from './Results';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function waitFor(assertion: () => void) {
  const deadline = Date.now() + 2000;
  while (true) {
    try { assertion(); return; } catch (error) {
      if (Date.now() >= deadline) throw error;
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    }
  }
}

afterEach(() => { vi.clearAllMocks(); localStorage.clear(); document.documentElement.classList.remove('reduce-motion'); });

it('shows a results API failure and permits recovery instead of claiming an empty database', async () => {
  document.documentElement.classList.add('reduce-motion');
  let failing = true;
  transport.get.mockImplementation(async (path: string) => {
    if (path === '/workspaces') return { workspaces: [{ id: 'workspace', name: 'Workspace', is_active: true }] };
    if (path === '/workspaces/workspace/results/summary') {
      if (failing) throw new Error('Cannot read stored predictions');
      return { workspace_id: 'workspace', datasets: [] };
    }
    throw new Error(`Unexpected API request: ${path}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => { root.render(<QueryClientProvider client={client}><MemoryRouter><TooltipProvider>
      <Results />
    </TooltipProvider></MemoryRouter></QueryClientProvider>); });
    await waitFor(() => expect(container.textContent).toContain('Cannot read stored predictions'));
    expect(container.textContent).toContain('Error loading results');
    expect(container.textContent).not.toContain('No results found');
    failing = false;
    await act(async () => {
      [...container.querySelectorAll('button')].find(button => button.textContent?.includes('Refresh'))!.click();
    });
    await waitFor(() => expect(container.textContent).not.toContain('Cannot read stored predictions'));
  } finally {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
  }
});

it('renders training-only models on the actual Results page and refreshes the expanded model history', async () => {
  document.documentElement.classList.add('reduce-motion');
  const chain = (name: string, score: number) => ({
    chain_id: name, run_id: 'run', pipeline_id: 'pipeline', model_name: name, model_class: name,
    preprocessings: 'StandardScaler', cv_val_score: null, cv_test_score: null,
    cv_train_score: score, cv_fold_count: 0, cv_scores: { train: { rmse: score }, val: {}, test: {} },
    final_test_score: null, final_train_score: null, final_scores: {}, metric: 'rmse', task_type: 'regression',
  });
  let rows = [chain('Ridge', 0.42)];
  const summaryPath = '/workspaces/workspace/results/summary';
  const chainsPath = '/workspaces/workspace/results/datasets/Spectra/chains';
  transport.get.mockImplementation(async (path: string) => {
    if (path === '/workspaces') return { workspaces: [{ id: 'workspace', name: 'Workspace', is_active: true }] };
    if (path === summaryPath) return { workspace_id: 'workspace', datasets: [{
      dataset_name: 'Spectra', metric: 'rmse', task_type: 'regression', top_chains: rows.map(row => ({
        ...row, avg_train_score: row.cv_train_score, avg_val_score: null, avg_test_score: null,
        fold_count: 0, scores: row.cv_scores,
      })),
    }] };
    if (path === chainsPath) return { chains: rows, total: rows.length, metric: 'rmse' };
    throw new Error(`Unexpected API request: ${path}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => { root.render(<QueryClientProvider client={client}><MemoryRouter><TooltipProvider>
      <Results />
    </TooltipProvider></MemoryRouter></QueryClientProvider>); });
    await waitFor(() => expect(container.querySelector('h3')?.textContent).toBe('Spectra'));
    await act(async () => { container.querySelector('h3')!.click(); });
    await waitFor(() => {
      expect(transport.get).toHaveBeenCalledWith(chainsPath);
      expect(container.textContent).toContain('Training only');
      expect(container.textContent).toContain('0.42');
    });
    const initialHistoryCalls = transport.get.mock.calls.filter(([path]) => path === chainsPath).length;
    rows = [chain('Ridge', 0.42), chain('PLSRegression', 0.23), chain('TabPFNRegressor', 0.12)];
    const refresh = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('Refresh'))!;
    await act(async () => { refresh.click(); });
    await waitFor(() => {
      expect(transport.get.mock.calls.filter(([path]) => path === chainsPath).length).toBeGreaterThan(initialHistoryCalls);
      expect(container.textContent).toContain('TabPFNRegressor');
      expect(container.textContent).toContain('PLSRegression');
      expect(container.textContent).toContain('Ridge');
      expect(container.textContent).toContain('0.12');
      expect(container.textContent).toContain('0.23');
      expect(container.textContent).toContain('0.42');
      expect([...container.querySelectorAll('.shrink-0')].filter(element => element.textContent === 'Training only')).toHaveLength(3);
      expect(container.textContent).not.toContain('CV models');
      expect(container.textContent).not.toContain('Refit models');
      expect(container.textContent).not.toMatch(/\b1 fold/);
    });
  } finally {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
  }
});
