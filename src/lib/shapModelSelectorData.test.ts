import { describe, expect, it } from 'vitest';

import type { AvailableBundle, AvailableChain, DatasetChains } from '@/types/shap';
import {
  buildShapChainLabel,
  buildShapChainTooltip,
  countShapModelChains,
  filterShapModelBundles,
  filterShapModelDatasets,
  formatShapModelScore,
  getShapModelClassOptions,
  getShapModelDatasetOptions,
  getShapModelScoreDisplays,
  getShortShapModelClass,
  getVisibleShapChainScore,
  hasVisibleShapModelOptions,
  resolveShapModelSelection,
  SHAP_MODEL_SELECTOR_ALL_VALUE,
} from './shapModelSelectorData';

function chain(overrides: Partial<AvailableChain> = {}): AvailableChain {
  return {
    chain_id: 'chain-rf',
    dataset_name: 'Dataset A',
    model_class: 'sklearn.ensemble.RandomForestRegressor',
    model_name: '',
    preprocessings: '',
    run_id: 'run-1',
    metric: 'r2',
    cv_val_score: null,
    final_test_score: null,
    cv_fold_count: 5,
    has_refit: true,
    ...overrides,
  };
}

function dataset(overrides: Partial<DatasetChains> = {}): DatasetChains {
  return {
    dataset_name: 'Dataset A',
    metric: 'r2',
    task_type: 'regression',
    chains: [
      chain({ chain_id: 'low', final_test_score: 0.4 }),
      chain({ chain_id: 'high', final_test_score: 0.9 }),
      chain({ chain_id: 'scoreless' }),
    ],
    ...overrides,
  };
}

function bundle(overrides: Partial<AvailableBundle> = {}): AvailableBundle {
  return {
    bundle_path: '/tmp/model.n4a',
    display_name: 'Model bundle',
    dataset_name: 'Dataset A',
    ...overrides,
  };
}

describe('shapModelSelectorData', () => {
  it('builds dataset and model-class options from scoped datasets', () => {
    const datasets = [
      dataset(),
      dataset({
        dataset_name: 'Dataset B',
        chains: [
          chain({
            chain_id: 'pls',
            dataset_name: 'Dataset B',
            model_class: 'nirs4all.methods.PLSRegression',
          }),
        ],
      }),
    ];

    expect(getShapModelDatasetOptions(datasets)).toEqual(['Dataset A', 'Dataset B']);
    expect(getShapModelClassOptions(datasets, SHAP_MODEL_SELECTOR_ALL_VALUE)).toEqual([
      'PLSRegression',
      'RandomForestRegressor',
    ]);
    expect(getShapModelClassOptions(datasets, 'Dataset B')).toEqual(['PLSRegression']);
  });

  it('filters datasets and sorts chains according to metric direction', () => {
    expect(filterShapModelDatasets([dataset()], SHAP_MODEL_SELECTOR_ALL_VALUE, SHAP_MODEL_SELECTOR_ALL_VALUE)[0].chains.map((item) => item.chain_id)).toEqual([
      'high',
      'low',
      'scoreless',
    ]);

    expect(filterShapModelDatasets([
      dataset({
        metric: 'rmse',
        chains: [
          chain({ chain_id: 'worse', final_test_score: 0.9 }),
          chain({ chain_id: 'better', final_test_score: 0.4 }),
        ],
      }),
    ], SHAP_MODEL_SELECTOR_ALL_VALUE, SHAP_MODEL_SELECTOR_ALL_VALUE)[0].chains.map((item) => item.chain_id)).toEqual([
      'better',
      'worse',
    ]);
  });

  it('filters datasets by dataset and model class', () => {
    const datasets = [
      dataset(),
      dataset({
        dataset_name: 'Dataset B',
        chains: [chain({
          chain_id: 'pls',
          dataset_name: 'Dataset B',
          model_class: 'nirs4all.methods.PLSRegression',
        })],
      }),
    ];

    expect(filterShapModelDatasets(datasets, 'Dataset B', 'PLSRegression')).toEqual([
      {
        dataset_name: 'Dataset B',
        metric: 'r2',
        task_type: 'regression',
        chains: [datasets[1].chains[0]],
      },
    ]);
    expect(filterShapModelDatasets(datasets, 'Dataset B', 'RandomForestRegressor')).toEqual([]);
  });

  it('filters bundles only when model class filter is broad', () => {
    const bundles = [
      bundle(),
      bundle({ bundle_path: '/tmp/other.n4a', dataset_name: 'Dataset B' }),
    ];

    expect(filterShapModelBundles(bundles, 'Dataset A', SHAP_MODEL_SELECTOR_ALL_VALUE)).toEqual([bundles[0]]);
    expect(filterShapModelBundles(bundles, SHAP_MODEL_SELECTOR_ALL_VALUE, 'PLSRegression')).toEqual([]);
  });

  it('resolves selected chain and bundle dataset names', () => {
    const datasets = [dataset()];
    const bundles = [bundle()];

    expect(resolveShapModelSelection('', datasets, bundles)).toEqual({ chainId: null, datasetName: null, modelRef: null });
    expect(resolveShapModelSelection('high', datasets, bundles)).toEqual({
      chainId: 'high',
      datasetName: 'Dataset A',
      modelRef: { modelSource: 'chain', chainId: 'high' },
    });
    expect(resolveShapModelSelection('/tmp/model.n4a', datasets, bundles)).toEqual({
      chainId: '/tmp/model.n4a',
      datasetName: 'Dataset A',
      modelRef: { modelSource: 'bundle', bundlePath: '/tmp/model.n4a' },
    });
    expect(resolveShapModelSelection('future-id', datasets, bundles)).toEqual({
      chainId: 'future-id',
      datasetName: null,
      modelRef: { modelSource: 'chain', chainId: 'future-id' },
    });
  });

  it('builds labels, scores, tooltips, and counts', () => {
    const labelled = chain({
      model_name: 'Best RF',
      preprocessings: 'SNV → SG',
      metric: 'rmse',
      final_test_score: 0.123456,
      cv_val_score: 0.234567,
    });

    expect(getShortShapModelClass('a.b.Model')).toBe('Model');
    expect(formatShapModelScore(null)).toBeNull();
    expect(formatShapModelScore(0.123456)).toBe('0.1235');
    expect(getShapModelScoreDisplays(labelled)).toEqual([
      { kind: 'final_test_score', label: 'RMSEP', value: '0.1235' },
      { kind: 'cv_val_score', label: 'RMSECV', value: '0.2346' },
    ]);
    expect(getShapModelScoreDisplays(chain({ metric: 'r2', cv_val_score: 0.98765 }))).toEqual([
      { kind: 'cv_val_score', label: 'CV R2', value: '0.9877' },
    ]);
    expect(getShapModelScoreDisplays({ final_test_score: 0.42 })).toEqual([
      { kind: 'final_test_score', label: 'Final SCORE', value: '0.4200' },
    ]);
    expect(buildShapChainLabel(labelled)).toBe('SNV → SG → Best RF');
    expect(buildShapChainTooltip(labelled)).toBe([
      'Full chain: SNV → SG → Best RF',
      'RMSEP: 0.1235',
      'RMSECV: 0.2346',
    ].join('\n'));
    expect(getVisibleShapChainScore(labelled)).toBe('0.1235');
    expect(countShapModelChains([dataset()])).toBe(3);
    expect(hasVisibleShapModelOptions([], [])).toBe(false);
    expect(hasVisibleShapModelOptions([], [bundle()])).toBe(true);
  });
});
