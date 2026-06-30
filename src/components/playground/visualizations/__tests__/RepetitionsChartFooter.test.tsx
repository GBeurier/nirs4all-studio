/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { RepetitionsChartFooter } from '../RepetitionsChartFooter';
import type { RepetitionDataPoint, RepetitionResult } from '@/types/playground';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let mountedContainers: HTMLDivElement[] = [];

async function render(element: ReactNode) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  mountedContainers.push(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(element);
  });

  return { container, root };
}

afterEach(() => {
  for (const container of mountedContainers) {
    container.remove();
  }
  mountedContainers = [];
});

describe('RepetitionsChartFooter', () => {
  it('renders repetition counts, stats, selected count, and high-variability details', async () => {
    const highVariabilitySamples: RepetitionDataPoint[] = [
      { bio_sample: 'bio-a', rep_index: 0, sample_index: 0, sample_id: 'bio-a-1', distance: 0.5 },
      { bio_sample: 'bio-b', rep_index: 1, sample_index: 1, sample_id: 'bio-b-2', distance: 0.7 },
    ];
    const repetitionData: RepetitionResult = {
      has_repetitions: true,
      n_bio_samples: 5,
      n_with_reps: 3,
      n_singletons: 2,
      total_repetitions: 9,
      high_variability_samples: highVariabilitySamples,
    };

    const { container, root } = await render(
      <RepetitionsChartFooter
        hasRepetitions
        repetitionData={repetitionData}
        plotDataLength={9}
        sortBy="index"
        metadataSortColumn={null}
        groupCount={3}
        scaleType="linear"
        statistics={{ mean_distance: 0.25, max_distance: 1.5 }}
        selectedCount={2}
        highVariabilitySamples={highVariabilitySamples}
      />
    );

    expect(container.textContent).toContain('9 measurements from 3 samples');
    expect(container.textContent).toContain('(2 singletons hidden)');
    expect(container.textContent).toContain('Mean: 0.25');
    expect(container.textContent).toContain('Max: 1.50');
    expect(container.textContent).toContain('2 selected');
    expect(container.textContent).toContain('2 sample(s) with high variability');
    expect(container.textContent).toContain('bio-a, bio-b');

    await act(async () => {
      root.unmount();
    });
  });

  it('renders metadata grouping summary for no-repetition fallback data', async () => {
    const { container, root } = await render(
      <RepetitionsChartFooter
        hasRepetitions={false}
        repetitionData={null}
        plotDataLength={12}
        sortBy="metadata_column"
        metadataSortColumn="batch"
        groupCount={4}
        scaleType="linear"
        statistics={null}
        selectedCount={0}
      />
    );

    expect(container.textContent).toContain('12 samples grouped by "batch" (4 groups)');

    await act(async () => {
      root.unmount();
    });
  });
});
