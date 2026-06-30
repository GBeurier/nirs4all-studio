import { describe, expect, it } from 'vitest';

import {
  buildMetricSelectorData,
  getMetricDirectionSymbol,
  toggleMetricSelection,
} from '@/lib/metricSelectorData';

describe('metric selector data helpers', () => {
  it('builds regression selector sections and presets by default', () => {
    const data = buildMetricSelectorData({
      taskType: 'regression',
      selectedMetrics: ['rmse', 'r2'],
    });

    expect(data.selectedCount).toBe(2);
    expect(data.availableSections.map((section) => section.group)).toEqual(['regression']);
    expect(data.availableSections[0].metrics.map((metric) => metric.key)).toContain('rmse');
    expect(data.presets.map((preset) => preset.id)).toEqual(['essential', 'nirs', 'ml', 'full']);
  });

  it('filters presets to explicit available metric keys', () => {
    const data = buildMetricSelectorData({
      taskType: 'regression',
      selectedMetrics: [],
      availableMetricKeys: ['rmse', 'r2', 'accuracy'],
    });

    expect(data.availableSections.map((section) => section.group)).toEqual(['regression', 'multiclass']);
    expect(data.presets).toEqual([
      { id: 'essential', label: 'Essential', keys: ['r2', 'rmse'] },
      { id: 'nirs', label: 'NIRS', keys: ['r2', 'rmse'] },
      { id: 'ml', label: 'ML', keys: ['r2', 'rmse'] },
      { id: 'full', label: 'Full', keys: ['r2', 'rmse'] },
    ]);
  });

  it('keeps runtime-only benchmark metrics selectable in a custom section', () => {
    const data = buildMetricSelectorData({
      taskType: 'regression',
      selectedMetrics: ['benchmark_latency_ms'],
      availableMetricKeys: ['rmse', 'benchmark_latency_ms', 'repository_score'],
    });

    expect(data.availableSections.map((section) => [section.group, section.label])).toEqual([
      ['regression', 'Regression'],
      ['custom', 'Custom'],
    ]);
    expect(data.availableSections[1].metrics).toEqual([
      {
        key: 'benchmark_latency_ms',
        label: 'Benchmark Latency MS',
        abbreviation: 'BENCHMARK_LATENCY_MS',
        direction: 'higher',
        group: 'general',
        isCustom: true,
      },
      {
        key: 'repository_score',
        label: 'Repository Score',
        abbreviation: 'REPOSITORY_SCORE',
        direction: 'higher',
        group: 'general',
        isCustom: true,
      },
    ]);
    expect(data.presets).toEqual([
      { id: 'essential', label: 'Essential', keys: ['rmse'] },
      { id: 'nirs', label: 'NIRS', keys: ['rmse'] },
      { id: 'ml', label: 'ML', keys: ['rmse'] },
      { id: 'full', label: 'Full', keys: ['rmse'] },
    ]);
  });

  it('normalizes runtime metric aliases before building sections', () => {
    const data = buildMetricSelectorData({
      taskType: 'regression',
      selectedMetrics: [],
      availableMetricKeys: ['root_mean_squared_error', 'rmse', 'custom-loss'],
    });

    expect(data.availableSections[0].metrics.map((metric) => metric.key)).toEqual(['rmse']);
    expect(data.availableSections[1].metrics.map((metric) => metric.key)).toEqual(['custom_loss']);
  });

  it('uses mixed task presets when taskTypes are provided', () => {
    const data = buildMetricSelectorData({
      taskType: 'regression',
      taskTypes: ['regression', 'classification'],
      selectedMetrics: [],
      availableMetricKeys: ['rmse', 'r2', 'accuracy', 'f1'],
    });

    expect(data.presets).toEqual([
      { id: 'essential', label: 'Essential', keys: ['r2', 'rmse', 'accuracy', 'f1'] },
      { id: 'nirs', label: 'NIRS', keys: ['r2', 'rmse', 'accuracy', 'f1'] },
      { id: 'ml', label: 'ML', keys: ['r2', 'rmse', 'accuracy', 'f1'] },
      { id: 'full', label: 'Full', keys: ['r2', 'rmse', 'accuracy', 'f1'] },
    ]);
  });

  it('toggles selected metric keys without mutating the current selection', () => {
    const selected = ['rmse', 'r2'];

    expect(toggleMetricSelection(selected, 'rmse')).toEqual(['r2']);
    expect(toggleMetricSelection(selected, 'mae')).toEqual(['rmse', 'r2', 'mae']);
    expect(selected).toEqual(['rmse', 'r2']);
  });

  it('maps metric direction to compact symbols', () => {
    expect(getMetricDirectionSymbol('higher')).toBe('↑');
    expect(getMetricDirectionSymbol('lower')).toBe('↓');
    expect(getMetricDirectionSymbol('zero')).toBe('~0');
  });
});
