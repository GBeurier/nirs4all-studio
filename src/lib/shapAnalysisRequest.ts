import type {
  Partition,
  ShapComputeRequest,
} from '@/types/shap';
import {
  activeShapSubset,
  DEFAULT_SHAP_OPTIONS,
  usesShapBaseline,
  usesShapPermutations,
  type ShapAnalysisOptions,
} from '@/lib/shapVariableImportanceFormData';
import type { ResultArtifactRef } from '@/lib/resultArtifacts';

export type ShapExplicitModelRef =
  | { modelSource: 'chain'; chainId: string }
  | { modelSource: 'bundle'; bundlePath: string };

export type ShapModelRequestRef = string | ResultArtifactRef | ShapExplicitModelRef;

export interface BuildShapComputeRequestInput {
  modelRef: ShapModelRequestRef;
  datasetId: string;
  partition: Partition;
  options?: ShapAnalysisOptions;
}

export function isShapBundleReference(modelRef: string): boolean {
  return modelRef.endsWith('.n4a') || modelRef.includes('/') || modelRef.includes('\\');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isExplicitModelRef(modelRef: ShapModelRequestRef): modelRef is ShapExplicitModelRef {
  if (!isRecord(modelRef)) return false;
  if (modelRef.modelSource === 'chain') return hasText(modelRef.chainId);
  if (modelRef.modelSource === 'bundle') return hasText(modelRef.bundlePath);
  return false;
}

export function resolveShapModelRef(modelRef: ShapModelRequestRef): ShapExplicitModelRef {
  if (typeof modelRef === 'string') {
    return isShapBundleReference(modelRef)
      ? { modelSource: 'bundle', bundlePath: modelRef }
      : { modelSource: 'chain', chainId: modelRef };
  }

  if (isExplicitModelRef(modelRef)) return modelRef;

  if (hasText(modelRef.bundlePath)) {
    return { modelSource: 'bundle', bundlePath: modelRef.bundlePath };
  }
  if (hasText(modelRef.chainId)) {
    return { modelSource: 'chain', chainId: modelRef.chainId };
  }
  if (hasText(modelRef.artifactId)) {
    return isShapBundleReference(modelRef.artifactId)
      ? { modelSource: 'bundle', bundlePath: modelRef.artifactId }
      : { modelSource: 'chain', chainId: modelRef.artifactId };
  }

  return { modelSource: 'chain', chainId: modelRef.id };
}

export function buildShapComputeRequest({
  modelRef,
  datasetId,
  partition,
  options = DEFAULT_SHAP_OPTIONS,
}: BuildShapComputeRequestInput): ShapComputeRequest {
  if (!datasetId) throw new Error('The model has no authorized dataset link.');
  const resolvedModelRef = resolveShapModelRef(modelRef);
  const isBundle = resolvedModelRef.modelSource === 'bundle';

  return {
    chain_id: isBundle ? undefined : resolvedModelRef.chainId,
    bundle_path: isBundle ? resolvedModelRef.bundlePath : undefined,
    dataset_id: datasetId,
    partition,
    explainer_type: options.explainerType,
    n_samples: options.nSamples,
    n_background: options.nBackground,
    bin_size: 20,
    bin_stride: 10,
    bin_aggregation: 'sum',
    ...(options.engine === 'native' ? {
      explainer_backend: 'methods' as const,
      seed: options.seed,
      // The engine default is the background-rows baseline; leaving it unset
      // keeps native auto free to choose path-dependent TreeSHAP for trees.
      ...(usesShapBaseline(options) && options.baseline !== 'background' ? { baseline: options.baseline } : {}),
      ...(options.groupWidth !== null ? { group_width: options.groupWidth } : {}),
      ...(usesShapPermutations(options) && options.nPermutations !== null ? { n_permutations: options.nPermutations } : {}),
    } : {}),
    ...(options.subsets.enabled ? { subsets: {
      background: activeShapSubset(options.subsets.background),
      explained: activeShapSubset(options.subsets.explained),
    } } : {}),
  };
}
