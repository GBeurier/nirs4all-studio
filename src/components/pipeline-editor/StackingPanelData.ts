import type { StackingConfig } from "./stackingConfig";

export interface AvailableStackingModel {
  id: string;
  name: string;
  type: string;
}

export type MetaModelCategory = "Linear" | "PLS" | "Ensemble" | "SVM";

export interface MetaModelOption {
  name: string;
  description: string;
  category: MetaModelCategory;
  defaultParams: Readonly<Record<string, unknown>>;
  icon: string;
}

export const META_MODEL_CATEGORIES = [
  "Linear",
  "PLS",
  "Ensemble",
  "SVM",
] as const satisfies readonly MetaModelCategory[];

export const META_MODEL_OPTIONS = [
  {
    name: "Ridge",
    description: "Ridge regression - simple and effective",
    category: "Linear",
    defaultParams: { alpha: 1.0 },
    icon: "📈",
  },
  {
    name: "Lasso",
    description: "Lasso - sparse feature selection",
    category: "Linear",
    defaultParams: { alpha: 1.0 },
    icon: "🎯",
  },
  {
    name: "ElasticNet",
    description: "Elastic Net - balanced regularization",
    category: "Linear",
    defaultParams: { alpha: 1.0, l1_ratio: 0.5 },
    icon: "⚖️",
  },
  {
    name: "PLSRegression",
    description: "PLS - latent variable projection",
    category: "PLS",
    defaultParams: { n_components: 3 },
    icon: "🔄",
  },
  {
    name: "RandomForestRegressor",
    description: "Random Forest - non-linear ensemble",
    category: "Ensemble",
    defaultParams: { n_estimators: 50, max_depth: 5 },
    icon: "🌲",
  },
  {
    name: "XGBoost",
    description: "XGBoost - gradient boosting",
    category: "Ensemble",
    defaultParams: { n_estimators: 50, learning_rate: 0.1, max_depth: 3 },
    icon: "🚀",
  },
  {
    name: "SVR",
    description: "Support Vector Regression",
    category: "SVM",
    defaultParams: { kernel: "rbf", C: 1.0 },
    icon: "📊",
  },
] as const satisfies readonly MetaModelOption[];

export interface StackingSourceSelection {
  isUsingAllSources: boolean;
  selectedSourceCount: number;
}

export function getMetaModelOption(
  name: string,
): MetaModelOption | undefined {
  return META_MODEL_OPTIONS.find((model) => model.name === name);
}

export function getMetaModelDefaultParams(
  option: Pick<MetaModelOption, "defaultParams"> | undefined,
): Record<string, unknown> {
  if (!option) return {};

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(option.defaultParams)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

export function getMetaModelDefaultParamsByName(
  name: string,
): Record<string, unknown> {
  return getMetaModelDefaultParams(getMetaModelOption(name));
}

export function setStackingEnabled(
  config: StackingConfig,
  enabled: boolean,
): StackingConfig {
  return { ...config, enabled };
}

export function selectStackingMetaModel(
  config: StackingConfig,
  name: string,
): StackingConfig {
  return {
    ...config,
    metaModel: name,
    metaModelParams: getMetaModelDefaultParamsByName(name),
  };
}

export function setStackingMetaModelParam(
  config: StackingConfig,
  key: string,
  value: unknown,
): StackingConfig {
  return {
    ...config,
    metaModelParams: { ...config.metaModelParams, [key]: value },
  };
}

export function toggleStackingSourceModel(
  config: StackingConfig,
  id: string,
  checked: boolean,
): StackingConfig {
  if (checked) {
    return {
      ...config,
      sourceModels: [...config.sourceModels, id],
    };
  }

  return {
    ...config,
    sourceModels: config.sourceModels.filter((sourceId) => sourceId !== id),
  };
}

export function selectAllStackingSourceModels(
  config: StackingConfig,
): StackingConfig {
  return { ...config, sourceModels: [] };
}

export function setStackingCoverageStrategy(
  config: StackingConfig,
  coverageStrategy: StackingConfig["coverageStrategy"],
): StackingConfig {
  return { ...config, coverageStrategy };
}

export function setStackingFillValue(
  config: StackingConfig,
  fillValue: number,
): StackingConfig {
  return { ...config, fillValue };
}

export function setStackingPassthrough(
  config: StackingConfig,
  passthrough: boolean,
): StackingConfig {
  return { ...config, passthrough };
}

export function getStackingSourceSelection(
  config: Pick<StackingConfig, "sourceModels">,
  availableModels: readonly AvailableStackingModel[],
): StackingSourceSelection {
  const isUsingAllSources = config.sourceModels.length === 0;
  return {
    isUsingAllSources,
    selectedSourceCount: isUsingAllSources
      ? availableModels.length
      : config.sourceModels.length,
  };
}

export function isStackingSourceSelected(
  sourceModels: readonly string[],
  sourceId: string,
): boolean {
  return sourceModels.length === 0 || sourceModels.includes(sourceId);
}

export function getVisibleStackingBaseModelCount(sourceCount: number): number {
  return Math.min(sourceCount, 4);
}

export function coerceStackingNumberInput(rawValue: string): number {
  return parseFloat(rawValue) || 0;
}

export function coerceStackingParamValue(
  defaultValue: unknown,
  rawValue: string,
): unknown {
  return typeof defaultValue === "number"
    ? coerceStackingNumberInput(rawValue)
    : rawValue;
}

export function getStackingParamInputValue(
  params: Readonly<Record<string, unknown>>,
  key: string,
  defaultValue: unknown,
): string {
  const value = params[key];
  if (typeof value === "boolean") {
    return String(value);
  }
  return String(value ?? defaultValue);
}

export function getStackingParamInputStep(defaultValue: unknown): number {
  return typeof defaultValue === "number" && defaultValue < 1 ? 0.1 : 1;
}
