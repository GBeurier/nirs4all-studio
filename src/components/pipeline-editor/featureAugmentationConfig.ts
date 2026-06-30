export type FeatureAugmentationAction = "extend" | "add" | "replace";

export interface FeatureAugmentationConfig {
  enabled: boolean;
  action: FeatureAugmentationAction;
  transforms: FeatureAugmentationTransform[];
}

export interface FeatureAugmentationTransform {
  id: string;
  name: string;
  params: Record<string, unknown>;
  enabled: boolean;
}

export function defaultFeatureAugmentationConfig(): FeatureAugmentationConfig {
  return {
    enabled: false,
    action: "extend",
    transforms: [],
  };
}
