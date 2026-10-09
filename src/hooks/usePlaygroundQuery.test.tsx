/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWorkspaceDataset, invalidateLoadedWorkspaceDatasetResults } from '@/api/playground';
import { usePlaygroundQuery, prunePlaygroundResults, type UsePlaygroundQueryOptions } from './usePlaygroundQuery';
import { useSpectralData } from './useSpectralData';
import { useReferenceDatasetQuery } from './useReferenceDatasetQuery';
import type { SpectralData } from '@/types/spectral';
import type { ExecuteResponse, UnifiedOperator } from '@/types/playground';

const mocks = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/api/transport', () => ({ api: { post: mocks.post }, formatApiErrorDetail: String }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const raw: SpectralData = { spectra: [[1, 2], [3, 4]], wavelengths: [100, 200], y: [10, 20] };
const section = { spectra: raw.spectra, wavelengths: raw.wavelengths, y: raw.y, shape: [2, 2] };
const response = { success: true, original: section, processed: section, execution_time_ms: 1, execution_trace: [], step_errors: [] } as ExecuteResponse;
const savgol: UnifiedOperator = { id: 'savgol', name: 'SavitzkyGolay', classPath: 'nirs4all.operators.transforms.nirs.SavitzkyGolay', type: 'preprocessing', params: { window_length: 5 }, enabled: true };
const options: UsePlaygroundQueryOptions = { sampling: { method: 'all' }, executeOptions: { compute_pca: true, compute_repetitions: false }, debounceMs: 80 };
const cleanup: Array<() => Promise<void>> = [];

async function mount<T>(hook: () => T) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let current: T;
  function Probe() { current = hook(); return null; }
  const render = () => act(async () => { root.render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>); });
  cleanup.push(async () => { await act(async () => root.unmount()); client.clear(); container.remove(); });
  await render();
  return { get current() { return current; }, render, client };
}
async function tick(ms = 100) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
beforeEach(() => { vi.useFakeTimers(); mocks.post.mockResolvedValue(response); });
afterEach(async () => { for (const unmount of cleanup.splice(0)) await unmount(); vi.useRealTimers(); mocks.post.mockReset(); });

describe('playground request lifecycle', () => {
  it('bounds oversized display curves and retains full-dataset computation on subsequent edits', async () => {
    mocks.post.mockRejectedValueOnce({ detail: 'Playground response exceeds 32 MiB' }).mockResolvedValue(response);
    const data = await loadWorkspaceDataset('large');
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(mocks.post.mock.calls[1][1].options.max_wavelengths_returned).toBe(256);
    expect(mocks.post.mock.calls[1][1]).not.toHaveProperty('sampling');
    const view = await mount(() => usePlaygroundQuery(data, [savgol], { ...options, datasetId: 'large' }));
    await tick();
    expect(mocks.post.mock.calls.at(-1)?.[1].options.max_wavelengths_returned).toBe(256);
    expect(mocks.post.mock.calls.at(-1)?.[1].sampling).toBeUndefined();
    expect(view.current.error).toBeNull();
  });

  it('does not retry unrelated dataset failures with reduced curves', async () => {
    mocks.post.mockRejectedValueOnce({ detail: 'Dataset is not available' });
    await expect(loadWorkspaceDataset('missing')).rejects.toEqual({ detail: 'Dataset is not available' });
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });
  it('bounds inactive matrices and removes inactive snapshots without touching unrelated queries', () => {
    const client = new QueryClient();
    for (let index = 0; index < 10; index += 1) client.setQueryData(['playground', 'execute', 'current', `step-${index}`], response, { updatedAt: index + 1 });
    client.setQueryData(['playground', 'execute', 'old', 'step'], response);
    client.setQueryData(['datasets', 'list'], { datasets: [] });
    prunePlaygroundResults(client, 'current');
    expect(client.getQueryCache().findAll({ queryKey: ['playground', 'execute'] })).toHaveLength(3);
    expect(client.getQueryData(['playground', 'execute', 'old', 'step'])).toBeUndefined();
    expect(client.getQueryData(['datasets', 'list'])).toEqual({ datasets: [] });
    client.clear();
  });

  it('uses the dataset loading result for the first query without a second POST', async () => {
    const view = await mount(() => {
      const dataset = useSpectralData();
      const query = usePlaygroundQuery(dataset.rawData, [], { ...options, datasetId: dataset.currentDatasetInfo?.datasetId });
      return { dataset, query };
    });
    await act(async () => { await view.current.dataset.loadFromWorkspace('dataset-a', 'A'); });
    await tick();
    expect(view.current.query.result?.original.spectra).toEqual(raw.spectra);
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it('does not seed an old runtime result after the scientific runtime changes', async () => {
    const data = await loadWorkspaceDataset('dataset-a');
    invalidateLoadedWorkspaceDatasetResults();
    await mount(() => usePlaygroundQuery(data, [], { ...options, datasetId: 'dataset-a' }));
    await tick();
    expect(mocks.post).toHaveBeenCalledTimes(2);
  });

  it('does not execute for hiding a computed chart or editing a disabled operator', async () => {
    let operators = [savgol, { ...savgol, id: 'disabled', enabled: false }];
    let visible = true;
    const view = await mount(() => usePlaygroundQuery(raw, operators, { ...options, executeOptions: { compute_pca: visible, compute_repetitions: false } }));
    await tick();
    expect(mocks.post).toHaveBeenCalledTimes(1);
    visible = false;
    operators = [savgol, { ...operators[1], params: { window_length: 99 } }];
    await view.render();
    await tick();
    expect(mocks.post).toHaveBeenCalledTimes(1);
    operators = [savgol, { ...operators[1], enabled: true }];
    await view.render();
    await tick();
    expect(mocks.post).toHaveBeenCalledTimes(2);
  });

  it('debounces a matching key and payload and cancels the obsolete fetch', async () => {
    let firstSignal: AbortSignal | undefined;
    mocks.post.mockImplementationOnce((_path, _request, transportOptions) => {
      firstSignal = transportOptions.signal;
      return new Promise((_resolve, reject) => firstSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
    });
    let operators = [savgol];
    const view = await mount(() => usePlaygroundQuery(raw, operators, options));
    operators = [{ ...savgol, params: { window_length: 7 } }];
    await view.render();
    await tick(40);
    operators = [{ ...savgol, params: { window_length: 9 } }];
    await view.render();
    await tick(100);
    expect(firstSignal?.aborted).toBe(true);
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(mocks.post.mock.calls[1][1].steps[0].params.window_length).toBe(9);
    const execution = view.client.getQueryCache().findAll({ queryKey: ['playground', 'execute'] }).find(query => query.state.status === 'success');
    expect(execution?.queryKey[3]).toContain('"window_length":9');
  });

  it('does not display a previous dataset result under a new dataset identity', async () => {
    let data = raw;
    const view = await mount(() => usePlaygroundQuery(data, [], options));
    await tick();
    mocks.post.mockReturnValueOnce(new Promise(() => {}));
    data = { ...raw, spectra: [[9, 8], [7, 6]] };
    await view.render();
    expect(view.current.result).toBeNull();
    expect(mocks.post).toHaveBeenCalledTimes(2);
  });

  it('does not reuse stochastic operator results without a seed', async () => {
    const noise: UnifiedOperator = { ...savgol, name: 'GaussianAdditiveNoise', type: 'augmentation', classPath: 'nirs4all.operators.transforms.GaussianAdditiveNoise', params: {} };
    let operators = [noise];
    const view = await mount(() => usePlaygroundQuery(raw, operators, options));
    await tick();
    expect(mocks.post.mock.calls[0][1].options.use_cache).toBe(false);
    operators = [];
    await view.render();
    await tick();
    operators = [noise];
    await view.render();
    await tick();
    expect(mocks.post).toHaveBeenCalledTimes(3);
  });

  it('honours the requested sampling seed in both the key and inline payload', async () => {
    await mount(() => usePlaygroundQuery(raw, [], { ...options, sampling: { method: 'random', seed: 17, n_samples: 1 } }));
    await tick();
    expect(mocks.post.mock.calls[0][1].sampling.seed).toBe(17);
  });

  it('distinguishes reference datasets with equal dimensions and changed metadata', async () => {
    let data = { ...raw, metadata: [{ group: 'a' }, { group: 'a' }] };
    const view = await mount(() => useReferenceDatasetQuery(data, [savgol]));
    await tick();
    data = { ...raw, metadata: [{ group: 'a' }, { group: 'b' }] };
    await view.render();
    await tick();
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(mocks.post.mock.calls[1][1].data.metadata.group).toEqual(['a', 'b']);
  });

  it('keeps unlabelled workspace data unlabelled and preserves its partitions', async () => {
    const partitions = { has_test: true, n_train: 1, n_test: 1 };
    mocks.post.mockResolvedValueOnce({ ...response, original: { ...section, y: null }, source_partitions: partitions });
    const data = await loadWorkspaceDataset('unlabelled');
    expect(data.y).toEqual([]);
    expect(data.sourcePartitions).toEqual(partitions);
  });

  it('ignores a superseded dataset load even if the transport still resolves it', async () => {
    let finishFirst!: (value: ExecuteResponse) => void;
    mocks.post.mockReturnValueOnce(new Promise(resolve => { finishFirst = resolve; }));
    const view = await mount(useSpectralData);
    let first!: Promise<void>;
    await act(async () => { first = view.current.loadFromWorkspace('first', 'First'); });
    await act(async () => { await view.current.loadFromWorkspace('second', 'Second'); });
    await act(async () => { finishFirst(response); await first; });
    expect(view.current.currentDatasetInfo?.datasetId).toBe('second');
    expect(mocks.post.mock.calls[0][2].signal.aborted).toBe(true);
  });
});
