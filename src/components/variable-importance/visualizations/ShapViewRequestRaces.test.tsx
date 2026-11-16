/** @vitest-environment jsdom */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SampleExplanationResponse, ShapResultsResponse, SpectralDetailData } from '@/types/shap';

const mocks = vi.hoisted(() => ({
  detail: vi.fn(),
  sample: vi.fn(),
  t: (key: string) => key,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock('@/api/shap', () => ({ getSpectralDetail: mocks.detail, getSampleExplanation: mocks.sample }));
vi.mock('@/hooks/useElementWidth', () => ({ useElementWidth: () => [undefined, 760] }));
vi.mock('@/components/playground/visualizations/chartConfig', () => ({ formatWavelengthUnit: () => 'nm' }));
vi.mock('nirs4all-ui/viz', () => ({
  SpectralImportanceChart: ({ importance }: { importance: number[] }) => <output data-testid="curve">{JSON.stringify(importance)}</output>,
  WaterfallChart: ({ predicted }: { predicted: number }) => <output data-testid="prediction">{predicted}</output>,
  compactNumber: String,
  signedNumber: String,
}));

import { SpectralImportanceChart } from './SpectralImportanceChart';
import { WaterfallChart } from './WaterfallChart';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];
async function mount(node: ReactNode) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  const render = async (next: ReactNode) => { await act(async () => { root.render(next); }); };
  await render(node);
  return { container, render };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const results: ShapResultsResponse = {
  job_id: 'job', model_id: 'model', dataset_id: 'dataset', explainer_type: 'kernel',
  n_samples: 3, n_features: 2, base_value: 0, execution_time_ms: 1,
  feature_importance: [], wavelengths: [1100, 1200], axis_unit: 'nm',
  mean_abs_shap: [0.1, 0.2], mean_spectrum: [1, 2], sample_indices: [0, 1, 2],
  binned_importance: { bin_centers: [1150], bin_values: [0.3], bin_ranges: [[1100, 1200]], bin_size: 2, bin_stride: 1, aggregation: 'sum' },
};
const detail = (value: number): SpectralDetailData => ({
  wavelengths: [1100, 1200], mean_abs_shap: [value, value], mean_spectrum: [1, 2], n_samples: 1,
});
const sample = (index: number): SampleExplanationResponse => ({
  sample_idx: index, base_value: 0, predicted_value: 10 * (index + 1), contributions: [],
});
const spectral = (selected: number[]) => <SpectralImportanceChart jobId="job" results={results} selectedSamples={selected} />;
const waterfall = (index: number) => <WaterfallChart jobId="job" sampleIdx={index} totalSamples={3} onSampleChange={() => {}} />;

afterEach(async () => {
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => { root.unmount(); });
    container.remove();
  }
  vi.useRealTimers();
  mocks.detail.mockReset();
  mocks.sample.mockReset();
});

describe('SHAP view request ownership', () => {
  it('keeps the newest spectral selection when an older response arrives last', async () => {
    vi.useFakeTimers();
    const first = deferred<SpectralDetailData>();
    const second = deferred<SpectralDetailData>();
    mocks.detail.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const view = await mount(spectral([0]));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    await view.render(spectral([1]));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    await act(async () => { second.resolve(detail(2)); });
    expect(view.container.querySelector('output')?.textContent).toBe('[2,2]');
    await act(async () => { first.resolve(detail(1)); });
    expect(view.container.querySelector('output')?.textContent).toBe('[2,2]');
  });

  it('keeps the population curve after selection is cleared during a request', async () => {
    vi.useFakeTimers();
    const pending = deferred<SpectralDetailData>();
    mocks.detail.mockReturnValue(pending.promise);
    const view = await mount(spectral([0]));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    await view.render(spectral([]));
    await act(async () => { pending.resolve(detail(9)); });
    expect(view.container.querySelector('output')?.textContent).toBe('[0.1,0.2]');
  });

  it('reports a failed detail request without claiming the selected curve is displayed', async () => {
    vi.useFakeTimers();
    mocks.detail.mockRejectedValue(new Error('Selected sample unavailable'));
    const view = await mount(spectral([0]));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain('Selected sample unavailable');
    expect(view.container.textContent).not.toContain('results.variableImportance.spectral.showing');
  });

  it('keeps the newest waterfall sample when an older response arrives last', async () => {
    const first = deferred<SampleExplanationResponse>();
    const second = deferred<SampleExplanationResponse>();
    mocks.sample.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const view = await mount(waterfall(0));
    await view.render(waterfall(1));
    await act(async () => { second.resolve(sample(1)); });
    expect(view.container.querySelector('output')?.textContent).toBe('20');
    await act(async () => { first.resolve(sample(0)); });
    expect(view.container.querySelector('output')?.textContent).toBe('20');
  });
});
