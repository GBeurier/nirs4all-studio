import { isLowerBetter } from '@/lib/scores';
import type { ShapExplicitModelRef } from '@/lib/shapAnalysisRequest';
import type { AvailableBundle, AvailableChain, DatasetChains } from '@/types/shap';

export const SHAP_MODEL_SELECTOR_ALL_VALUE = '__all__';

export interface ShapModelSelectionResolution {
  chainId: string | null;
  datasetName: string | null;
  modelRef: ShapExplicitModelRef | null;
}

export type ShapModelScoreKind = 'final_test_score' | 'cv_val_score';

export interface ShapModelScoreSource {
  metric?: string | null;
  final_test_score?: number | null;
  cv_val_score?: number | null;
}

export interface ShapModelScoreDisplay {
  kind: ShapModelScoreKind;
  label: string;
  value: string;
}

interface ShapModelScoreLabels {
  finalTest: string;
  cvVal: string;
}

export function getShortShapModelClass(modelClass: string): string {
  const parts = modelClass.split('.');
  return parts[parts.length - 1];
}

export function getShapModelDatasetOptions(datasets: DatasetChains[]): string[] {
  return datasets.map((dataset) => dataset.dataset_name);
}

export function getShapModelClassOptions(
  datasets: DatasetChains[],
  datasetFilter: string,
): string[] {
  const scoped = datasetFilter === SHAP_MODEL_SELECTOR_ALL_VALUE
    ? datasets
    : datasets.filter((dataset) => dataset.dataset_name === datasetFilter);

  return Array.from(
    new Set(scoped.flatMap((dataset) => dataset.chains.map((chain) => getShortShapModelClass(chain.model_class)))),
  ).sort();
}

export function filterShapModelDatasets(
  datasets: DatasetChains[],
  datasetFilter: string,
  modelFilter: string,
): DatasetChains[] {
  return datasets
    .filter((dataset) => datasetFilter === SHAP_MODEL_SELECTOR_ALL_VALUE || dataset.dataset_name === datasetFilter)
    .map((dataset) => {
      const chains = modelFilter === SHAP_MODEL_SELECTOR_ALL_VALUE
        ? dataset.chains
        : dataset.chains.filter((chain) => getShortShapModelClass(chain.model_class) === modelFilter);

      return {
        ...dataset,
        chains: sortShapChainsByScore(chains, dataset.metric),
      };
    })
    .filter((dataset) => dataset.chains.length > 0);
}

export function filterShapModelBundles(
  bundles: AvailableBundle[],
  datasetFilter: string,
  modelFilter: string,
): AvailableBundle[] {
  if (modelFilter !== SHAP_MODEL_SELECTOR_ALL_VALUE) return [];

  return datasetFilter === SHAP_MODEL_SELECTOR_ALL_VALUE
    ? bundles
    : bundles.filter((bundle) => bundle.dataset_name === datasetFilter);
}

export function countShapModelChains(datasets: DatasetChains[]): number {
  return datasets.reduce((count, dataset) => count + dataset.chains.length, 0);
}

export function hasVisibleShapModelOptions(
  datasets: DatasetChains[],
  bundles: AvailableBundle[],
): boolean {
  return datasets.length > 0 || bundles.length > 0;
}

export function resolveShapModelSelection(
  value: string,
  datasets: DatasetChains[],
  bundles: AvailableBundle[] = [],
): ShapModelSelectionResolution {
  if (!value) {
    return { chainId: null, datasetName: null, modelRef: null };
  }

  for (const dataset of datasets) {
    const chain = dataset.chains.find((candidate) => candidate.chain_id === value);
    if (chain) {
      return {
        chainId: chain.chain_id,
        datasetName: chain.dataset_name,
        modelRef: { modelSource: 'chain', chainId: chain.chain_id },
      };
    }
  }

  const bundle = bundles.find((candidate) => candidate.bundle_path === value);
  if (bundle) {
    return {
      chainId: value,
      datasetName: bundle.dataset_name || null,
      modelRef: { modelSource: 'bundle', bundlePath: bundle.bundle_path },
    };
  }

  return { chainId: value, datasetName: null, modelRef: { modelSource: 'chain', chainId: value } };
}

export function formatShapModelScore(score: number | null | undefined): string | null {
  if (score === null || score === undefined) return null;
  return score.toFixed(4);
}

export function getShapModelScoreDisplays(scoreSource: ShapModelScoreSource): ShapModelScoreDisplay[] {
  const labels = getShapModelScoreLabels(scoreSource.metric);
  const scoreDisplays: ShapModelScoreDisplay[] = [];

  const finalScore = formatShapModelScore(scoreSource.final_test_score);
  if (finalScore) {
    scoreDisplays.push({
      kind: 'final_test_score',
      label: labels.finalTest,
      value: finalScore,
    });
  }

  const cvScore = formatShapModelScore(scoreSource.cv_val_score);
  if (cvScore) {
    scoreDisplays.push({
      kind: 'cv_val_score',
      label: labels.cvVal,
      value: cvScore,
    });
  }

  return scoreDisplays;
}

export function buildShapChainLabel(chain: AvailableChain): string {
  const modelLabel = chain.model_name || getShortShapModelClass(chain.model_class);
  return chain.preprocessings ? `${chain.preprocessings} → ${modelLabel}` : modelLabel;
}

export function buildShapChainTooltip(chain: AvailableChain): string {
  const lines = [`Full chain: ${buildShapChainLabel(chain)}`];

  for (const scoreDisplay of getShapModelScoreDisplays(chain)) {
    lines.push(`${scoreDisplay.label}: ${scoreDisplay.value}`);
  }

  return lines.join('\n');
}

export function getVisibleShapChainScore(chain: AvailableChain): string | null {
  return getShapModelScoreDisplays(chain)[0]?.value ?? null;
}

function sortShapChainsByScore(chains: AvailableChain[], metric: string): AvailableChain[] {
  const lowerBetter = isLowerBetter(metric);

  return [...chains].sort((left, right) => {
    const leftScore = getShapChainScore(left);
    const rightScore = getShapChainScore(right);

    if (leftScore === null && rightScore === null) return 0;
    if (leftScore === null) return 1;
    if (rightScore === null) return -1;

    return lowerBetter ? leftScore - rightScore : rightScore - leftScore;
  });
}

function getShapChainScore(chain: AvailableChain): number | null {
  return chain.final_test_score ?? chain.cv_val_score;
}

function getShapModelScoreLabels(metric: string | null | undefined): ShapModelScoreLabels {
  const normalizedMetric = (metric || '').toLowerCase();
  if (normalizedMetric === 'rmse') {
    return { finalTest: 'RMSEP', cvVal: 'RMSECV' };
  }

  const metricLabel = normalizedMetric ? normalizedMetric.toUpperCase() : 'SCORE';
  return { finalTest: `Final ${metricLabel}`, cvVal: `CV ${metricLabel}` };
}
