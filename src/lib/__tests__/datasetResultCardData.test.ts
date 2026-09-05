import { describe, expect, it } from 'vitest';

import {
  buildDatasetResultDetailFocus,
  buildDatasetResultDetailMetaHint,
  buildDatasetResultHeaderSummary,
  buildPredictionViewerHeader,
  buildPredictionViewerPartitions,
  normalizeAllChainEntry,
  resolveDatasetResultChains,
  resolveDetailChain,
  shouldUseFullDatasetChains,
} from '@/lib/datasetResultCardData';
import type { PartitionPrediction } from '@/types/aggregated-predictions';
import type { AllChainEntry, EnrichedDatasetRun, TopChainResult } from '@/types/enriched-runs';
import type { ScoreCardRow } from '@/types/score-cards';

function topChain(overrides: Partial<TopChainResult> = {}): TopChainResult {
  return {
    chain_id: 'chain-1',
    run_id: 'run-1',
    model_name: 'PLS',
    model_class: 'PLSRegression',
    preprocessings: 'SNV',
    avg_val_score: 0.2,
    avg_test_score: 0.25,
    avg_train_score: 0.15,
    fold_count: 3,
    scores: { val: {}, test: {} },
    final_test_score: null,
    final_train_score: null,
    final_scores: {},
    best_params: null,
    ...overrides,
  };
}

function scoreRow(overrides: Partial<ScoreCardRow> = {}): ScoreCardRow {
  return {
    id: 'row-1',
    chainId: 'chain-1',
    modelName: 'PLS',
    modelClass: 'PLSRegression',
    preprocessings: 'SNV',
    bestParams: null,
    cardType: 'crossval',
    metric: 'rmse',
    taskType: 'regression',
    testScores: {},
    valScores: {},
    trainScores: {},
    primaryTestScore: null,
    primaryValScore: 0.2,
    primaryTrainScore: null,
    hasRefitArtifact: false,
    ...overrides,
  };
}

function prediction(overrides: Partial<PartitionPrediction> = {}): PartitionPrediction {
  return {
    prediction_id: 'pred-1',
    pipeline_id: 'pipe-1',
    chain_id: 'chain-1',
    dataset_name: 'dataset-a',
    model_name: 'PLS',
    model_class: 'PLSRegression',
    fold_id: 'fold-0',
    partition: 'Test',
    val_score: 0.2,
    test_score: 0.25,
    train_score: 0.15,
    metric: 'rmse',
    task_type: 'regression',
    n_samples: 12,
    n_features: 128,
    preprocessings: 'SNV',
    ...overrides,
  };
}

describe('dataset result card data helpers', () => {
  it('labels explicit CV substitutes without changing scores or inventing a refit gain', () => {
    const row = scoreRow({
      cardType: 'refit',
      syntheticRefit: true,
      primaryTestScore: 0.15,
      children: [scoreRow({ primaryValScore: 0.2 })],
    });
    const summary = buildDatasetResultHeaderSummary({
      scoreRows: [row], chains: [topChain({ synthetic_refit: true })], metric: 'rmse',
    });
    expect(summary).toMatchObject({ bestSummaryLabel: 'CV estimate', refitCount: 0, delta: null });
    expect(summary.bestRow).toBe(row);
    expect(row.primaryTestScore).toBe(0.15);
  });

  it('normalizes all-chain entries to top-chain results', () => {
    const chain: AllChainEntry = {
      chain_id: 'chain-a',
      model_name: 'PLS',
      model_class: 'PLSRegression',
      preprocessings: '',
      best_params: { n_components: 5 },
      variant_params: { n_components: 7 },
      cv_val_score: 0.2,
      cv_test_score: 0.24,
      cv_train_score: 0.1,
      cv_fold_count: 0,
      cv_scores: { val: { rmse: 0.2 }, test: { rmse: 0.24 } },
      final_test_score: 0.22,
      final_train_score: 0.08,
      final_scores: { rmse: 0.22 },
      metric: 'rmse',
      task_type: 'regression',
    };

    expect(normalizeAllChainEntry(chain, 'fallback-run')).toMatchObject({
      chain_id: 'chain-a',
      run_id: 'fallback-run',
      preprocessings: '',
      avg_val_score: 0.2,
      scores: { val: { rmse: 0.2 }, test: { rmse: 0.24 } },
      best_params: { n_components: 7 },
      variant_params: { n_components: 7 },
      is_refit_only: false,
      synthetic_refit: false,
    });
  });

  it('resolves chain sources and detail chain params', () => {
    const explicitChains = [topChain({ chain_id: 'explicit' })];
    const fallbackChains = [topChain({ chain_id: 'fallback' })];

    expect(shouldUseFullDatasetChains({ allChains: explicitChains, workspaceId: 'workspace' })).toBe(false);
    expect(shouldUseFullDatasetChains({ workspaceId: 'workspace' })).toBe(true);
    expect(resolveDatasetResultChains({
      allChains: explicitChains,
      fallbackChains,
    })).toBe(explicitChains);
    expect(resolveDatasetResultChains({
      fallbackChains,
      allChainEntries: [{
        chain_id: 'entry',
        model_name: 'PLS',
        model_class: 'PLSRegression',
        preprocessings: 'MSC',
        best_params: null,
        cv_val_score: null,
        cv_test_score: null,
        cv_train_score: null,
        cv_fold_count: 1,
        cv_scores: null,
        final_test_score: null,
        final_train_score: null,
        final_scores: null,
        metric: 'rmse',
        task_type: 'regression',
      }],
    })[0].chain_id).toBe('entry');
    expect(resolveDetailChain(topChain({ best_params: null }), scoreRow({ bestParams: { alpha: 1 } })).best_params).toEqual({ alpha: 1 });
  });

  it('builds detail meta/focus and prediction viewer data', () => {
    const dataset: Pick<EnrichedDatasetRun, 'dataset_name' | 'metric' | 'task_type'> = {
      dataset_name: 'dataset-a',
      metric: 'rmse',
      task_type: 'regression',
    };
    const chain = topChain({ final_test_score: 0.2 });

    expect(buildDatasetResultDetailMetaHint(chain, dataset)).toEqual({
      modelName: 'PLS',
      modelClass: 'PLSRegression',
      datasetName: 'dataset-a',
      metric: 'rmse',
      taskType: 'regression',
      preprocessings: 'SNV',
    });
    expect(buildDatasetResultDetailFocus(chain)).toEqual({ cardType: 'refit', foldId: 'final' });

    const quickPrediction = prediction();
    expect(buildPredictionViewerHeader({
      quickViewPrediction: quickPrediction,
      datasetName: 'fallback-dataset',
      taskType: 'classification',
    })).toMatchObject({
      datasetName: 'dataset-a',
      modelName: 'PLS',
      foldId: 'fold-0',
      taskType: 'regression',
      nSamples: 12,
    });
    expect(buildPredictionViewerPartitions(quickPrediction, {
      predictions: [
        quickPrediction,
        prediction({ prediction_id: 'pred-2', partition: 'Val' }),
        prediction({ prediction_id: 'pred-3', fold_id: 'fold-1', partition: 'Train' }),
      ],
    })).toEqual([
      { predictionId: 'pred-1', partition: 'test', label: 'Test', source: 'aggregated' },
      { predictionId: 'pred-2', partition: 'val', label: 'Val', source: 'aggregated' },
    ]);
  });

  it('summarizes best row, refit count, top chain, and refit/CV delta', () => {
    const refitRow = scoreRow({
      id: 'refit',
      cardType: 'refit',
      primaryTestScore: 0.15,
      children: [scoreRow({ id: 'cv', cardType: 'crossval', primaryValScore: 0.2 })],
    });
    const summary = buildDatasetResultHeaderSummary({
      scoreRows: [refitRow, scoreRow({ chainId: 'chain-2', cardType: 'crossval' })],
      chains: [topChain({ chain_id: 'chain-1' })],
      metric: 'rmse',
    });

    expect(summary).toMatchObject({
      bestRow: refitRow,
      bestContext: 'refit',
      bestSummaryLabel: 'Best Refit',
      deltaDirection: 'down',
      refitCount: 1,
    });
    expect(summary.delta).toBeCloseTo(0.05);
    expect(summary.topChain?.chain_id).toBe('chain-1');
  });
});
