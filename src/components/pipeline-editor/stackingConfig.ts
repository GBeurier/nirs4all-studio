export interface StackingConfig {
  enabled: boolean;
  metaModel: string;
  metaModelParams: Record<string, unknown>;
  sourceModels: string[];
  coverageStrategy: "drop" | "fill" | "model";
  fillValue?: number;
  useOriginalFeatures: boolean;
  passthrough: boolean;
}

export function defaultStackingConfig(): StackingConfig {
  return {
    enabled: false,
    metaModel: "Ridge",
    metaModelParams: { alpha: 1.0 },
    sourceModels: [],
    coverageStrategy: "drop",
    useOriginalFeatures: false,
    passthrough: false,
  };
}
