import type {
  ExplainerType,
  Partition,
  ShapComputeRequest,
} from '@/types/shap';
import type { ResultArtifactRef } from '@/lib/resultArtifacts';

export type ShapExplicitModelRef =
  | { modelSource: 'chain'; chainId: string }
  | { modelSource: 'bundle'; bundlePath: string };

export type ShapModelRequestRef = string | ResultArtifactRef | ShapExplicitModelRef;

export interface BuildShapComputeRequestInput {
  modelRef: ShapModelRequestRef;
  datasetName: string;
  partition: Partition;
  explainerType: ExplainerType;
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
  datasetName,
  partition,
  explainerType,
}: BuildShapComputeRequestInput): ShapComputeRequest {
  const resolvedModelRef = resolveShapModelRef(modelRef);
  const isBundle = resolvedModelRef.modelSource === 'bundle';

  return {
    chain_id: isBundle ? undefined : resolvedModelRef.chainId,
    bundle_path: isBundle ? resolvedModelRef.bundlePath : undefined,
    dataset_id: datasetName,
    partition,
    explainer_type: explainerType,
    n_samples: null,
    n_background: 100,
    bin_size: 20,
    bin_stride: 10,
    bin_aggregation: 'sum',
  };
}
