import type { BeeswarmFeature } from 'nirs4all-ui/viz';
import type { BeeswarmBin } from '@/types/shap';

/** Default number of beeswarm rows; the backend orders bins by mean |SHAP|. */
export const SHAP_BEESWARM_DEFAULT_ROWS = 20;

/**
 * Project backend beeswarm bins onto the shared beeswarm contract, keeping the
 * backend order (strongest mean |SHAP| first) and each point's sample identity.
 */
export function buildShapBeeswarmFeatures(bins: BeeswarmBin[], limit?: number): BeeswarmFeature[] {
  const kept = limit === undefined ? bins : bins.slice(0, Math.max(0, limit));
  return kept.map((bin) => ({
    label: bin.label,
    points: bin.points.map((point) => ({
      shap: point.shap_value,
      featureValue: point.feature_value,
      sampleId: point.sample_idx,
    })),
  }));
}
