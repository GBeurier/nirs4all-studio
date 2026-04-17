/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearShapSessionState,
  loadShapSessionState,
  persistShapSessionState,
} from './shapSessionCache';

const STORAGE_KEY = 'nirs4all_shap_session';

afterEach(() => {
  sessionStorage.clear();
  vi.useRealTimers();
});

describe('shapSessionCache', () => {
  it('persists and reloads a SHAP session snapshot', () => {
    persistShapSessionState({
      chainId: 'chain-123',
      datasetName: 'corn',
      partition: 'test',
      explainerType: 'auto',
      jobId: 'job-123',
      results: {
        job_id: 'job-123',
        model_id: 'chain-123',
        dataset_id: 'corn',
        explainer_type: 'auto',
        n_samples: 10,
        n_features: 3,
        base_value: 0.5,
        execution_time_ms: 42,
        feature_importance: [],
        wavelengths: [1100, 1200, 1300],
        mean_abs_shap: [0.1, 0.2, 0.3],
        mean_spectrum: [1, 2, 3],
        binned_importance: {
          bin_centers: [1150],
          bin_values: [0.6],
          bin_ranges: [[1100, 1200]],
          bin_size: 2,
          bin_stride: 1,
          aggregation: 'mean_abs',
        },
        sample_indices: [0, 1, 2],
      },
      rebinnedData: {
        bin_centers: [1200],
        bin_values: [0.9],
        bin_ranges: [[1150, 1250]],
        bin_size: 3,
        bin_stride: 2,
        aggregation: 'sum_abs',
      },
      isSubmitting: false,
      activeTab: 'beeswarm',
      selectedSamples: [1, 4],
    });

    expect(loadShapSessionState()).toMatchObject({
      chainId: 'chain-123',
      datasetName: 'corn',
      jobId: 'job-123',
      activeTab: 'beeswarm',
      selectedSamples: [1, 4],
      rebinnedData: {
        aggregation: 'sum_abs',
        bin_size: 3,
        bin_stride: 2,
      },
    });
  });

  it('drops stale cached sessions after 24 hours', () => {
    const now = new Date('2026-04-17T10:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);

    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        savedAt: now.getTime() - (24 * 60 * 60 * 1000 + 1),
        chainId: 'chain-123',
        datasetName: 'corn',
        partition: 'test',
        explainerType: 'auto',
        jobId: 'job-123',
        results: null,
        rebinnedData: null,
        isSubmitting: false,
        activeTab: 'spectral',
        selectedSamples: [],
      }),
    );

    expect(loadShapSessionState()).toBeNull();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('clears the SHAP session snapshot explicitly', () => {
    persistShapSessionState({
      chainId: null,
      datasetName: null,
      partition: 'test',
      explainerType: 'auto',
      jobId: 'job-123',
      results: null,
      rebinnedData: null,
      isSubmitting: true,
      activeTab: 'spectral',
      selectedSamples: [],
    });

    clearShapSessionState();

    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
