import { useMemo } from "react";
import { parametersToDefaultParams, type ParameterDefinition } from "@/data/nodes";
import {
  useNodeRegistryOptional,
  type NodeDefinition,
  type NodeRegistryContextValue,
} from "../contexts/useNodeRegistry";
import {
  usePipelineEditorPreferencesOptional,
  type TierLevel,
} from "../contexts/usePipelineEditorPreferences";
import { stepOptions } from "../stepOptions";
import type { PipelineStep, StepOption, StepType } from "../types";
import { useDeepLearningAvailable } from "@/hooks/useBackendCapabilities";
import { usePyTorchInstallPrompt } from "@/context/usePyTorchInstallPrompt";
import { requiresPyTorch } from "@/lib/pytorchRequirement";

export type StepMetadataRegistry = Pick<
  NodeRegistryContextValue,
  | "getNodesByType"
  | "getNodeDefinition"
  | "getDefaultParams"
  | "getSweepableParams"
>;

export type StepMetadataSource = "registry" | "legacy" | "missing";

export interface StepMetadata {
  option?: StepOption;
  node?: NodeDefinition;
  parameters: ParameterDefinition[];
  sweepable: ParameterDefinition[];
  defaultParams: Record<string, unknown>;
  source: StepMetadataSource;
  isRegistryBacked: boolean;
}

export interface StepMetadataCatalog {
  getStepOptions: (type: StepType, options?: StepMetadataCatalogOptions) => StepOption[];
  getStepOption: (type: StepType, name: string) => StepOption | undefined;
  getStepMetadata: (type: StepType, name: string) => StepMetadata;
}

export interface StepMetadataCatalogOptions {
  tierLevel?: TierLevel;
  /** Hide the deep-learning operators that need a framework (torch/tensorflow/jax)
   *  when none is installed. A registry node that declares no package (the
   *  scikit-learn MLP) needs none and stays listed. */
  hideDeepLearning?: boolean;
  /** Keep PyTorch operators listed while deep learning is hidden: Studio can
   *  install PyTorch when one of them is picked. */
  pyTorchInstallable?: boolean;
}

const REGISTRY_LEGACY_ALIAS_FALLBACKS: Partial<Record<StepType, Record<string, string[]>>> = {
  model: {
    nicon: ["NICoN", "NICoNClassifier"],
    MLP: ["MLPRegressor", "MLPClassifier"],
    LSTM: ["LSTMRegressor", "LSTMClassifier"],
  },
};

function normalizeOptionName(name: string): string {
  return name.trim().toLowerCase();
}

function resolveOptionTier(option: StepOption): "core" | "standard" | "advanced" {
  return option.tier ?? (option.isAdvanced ? "advanced" : "standard");
}

function matchesTierLevel(option: StepOption, tierLevel?: TierLevel): boolean {
  if (!tierLevel || tierLevel === "all") {
    return true;
  }

  const tier = resolveOptionTier(option);
  if (tierLevel === "core") {
    return tier === "core";
  }

  return tier !== "advanced";
}

function getQuarantinedLegacyNames(type: StepType, registryNodes: NodeDefinition[]): Set<string> {
  const aliases = REGISTRY_LEGACY_ALIAS_FALLBACKS[type];
  if (!aliases || registryNodes.length === 0) {
    return new Set();
  }

  const registryNames = new Set(registryNodes.map((node) => normalizeOptionName(node.name)));
  return new Set(
    Object.entries(aliases)
      .filter(([, canonicalNames]) =>
        canonicalNames.some((canonicalName) => registryNames.has(normalizeOptionName(canonicalName))),
      )
      .map(([legacyName]) => normalizeOptionName(legacyName)),
  );
}

function buildDefaultBranches(node: NodeDefinition): PipelineStep[][] | undefined {
  if (node.defaultBranches !== undefined && node.defaultBranches > 0) {
    return Array.from({ length: node.defaultBranches }, () => []);
  }

  if (node.isContainer || node.isGenerator) {
    return [[], []];
  }

  return undefined;
}

function getRegistryDefaultParams(
  registry: StepMetadataRegistry,
  type: StepType,
  node: NodeDefinition,
): Record<string, unknown> {
  const defaults = registry.getDefaultParams(type, node.name);
  if (Object.keys(defaults).length > 0) {
    return defaults;
  }

  if (node.defaultParams) {
    return node.defaultParams;
  }

  return parametersToDefaultParams(node.parameters ?? []);
}

export function nodeDefinitionToStepOption(
  node: NodeDefinition,
  defaultParams: Record<string, unknown>,
): StepOption {
  return {
    name: node.name,
    description: node.description,
    defaultParams,
    defaultBranches: buildDefaultBranches(node),
    generatorKind: node.generatorKind,
    classPath: node.classPath,
    category: node.category,
    isDeepLearning: node.isDeepLearning,
    requires: node.requires,
    isAdvanced: node.isAdvanced,
    tags: node.tags,
    tier: node.tier,
  };
}

function getLegacyStepOption(type: StepType, name: string): StepOption | undefined {
  return stepOptions[type]?.find((option) => option.name === name);
}

export function createStepMetadataCatalog(
  registry?: StepMetadataRegistry,
  options: StepMetadataCatalogOptions = {},
): StepMetadataCatalog {
  const optionCache = new Map<StepType, StepOption[]>();
  // Options built from registry nodes: their `requires` is the node's complete
  // declaration, unlike the static fallback options, which declare nothing.
  const registryBacked = new WeakSet<StepOption>();
  const metadataCache = new Map<string, StepMetadata>();

  const getMergedStepOptions = (type: StepType): StepOption[] => {
    const cached = optionCache.get(type);
    if (cached) {
      return cached;
    }

    const registryNodes = registry ? registry.getNodesByType(type) : [];
    const registryOptions = registry
      ? registryNodes.map((node) =>
          nodeDefinitionToStepOption(node, getRegistryDefaultParams(registry, type, node)),
        )
      : [];

    registryOptions.forEach((option) => registryBacked.add(option));

    const seenNames = new Set(registryOptions.map((option) => normalizeOptionName(option.name)));
    const quarantinedLegacyNames = getQuarantinedLegacyNames(type, registryNodes);
    const fallbackOptions = (stepOptions[type] ?? []).filter(
      (option) =>
        !seenNames.has(normalizeOptionName(option.name)) &&
        !quarantinedLegacyNames.has(normalizeOptionName(option.name)),
    );

    const merged = [...registryOptions, ...fallbackOptions];
    optionCache.set(type, merged);
    return merged;
  };

  const getStepOptions = (type: StepType, queryOptions: StepMetadataCatalogOptions = {}): StepOption[] => {
    const mergedOptions = getMergedStepOptions(type);
    const tierLevel = queryOptions.tierLevel ?? options.tierLevel;
    const hideDeepLearning = queryOptions.hideDeepLearning ?? options.hideDeepLearning ?? false;

    let result = mergedOptions;
    if (tierLevel && tierLevel !== "all") {
      result = result.filter((option) => matchesTierLevel(option, tierLevel));
    }
    if (hideDeepLearning) {
      const pyTorchInstallable = queryOptions.pyTorchInstallable ?? options.pyTorchInstallable ?? false;
      result = result.filter((option) => (
        option.isDeepLearning !== true
        || (registryBacked.has(option) && !option.requires?.length)
        || (pyTorchInstallable && requiresPyTorch(option.requires))
      ));
    }
    return result;
  };

  const getStepMetadata = (type: StepType, name: string): StepMetadata => {
    const cacheKey = `${type}:${name}`;
    const cached = metadataCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    if (registry) {
      const node = registry.getNodeDefinition(type, name);
      if (node) {
        const defaultParams = getRegistryDefaultParams(registry, type, node);
        const metadata: StepMetadata = {
          option: nodeDefinitionToStepOption(node, defaultParams),
          node,
          parameters: node.parameters ?? [],
          sweepable: registry.getSweepableParams(type, name),
          defaultParams,
          source: "registry",
          isRegistryBacked: true,
        };
        metadataCache.set(cacheKey, metadata);
        return metadata;
      }
    }

    const legacyOption = getLegacyStepOption(type, name);
    if (legacyOption) {
      const metadata: StepMetadata = {
        option: legacyOption,
        parameters: [],
        sweepable: [],
        defaultParams: legacyOption.defaultParams,
        source: "legacy",
        isRegistryBacked: false,
      };
      metadataCache.set(cacheKey, metadata);
      return metadata;
    }

    const metadata: StepMetadata = {
      parameters: [],
      sweepable: [],
      defaultParams: {},
      source: "missing",
      isRegistryBacked: false,
    };
    metadataCache.set(cacheKey, metadata);
    return metadata;
  };

  return {
    getStepOptions,
    getStepOption: (type: StepType, name: string) => getStepMetadata(type, name).option,
    getStepMetadata,
  };
}

export function useStepMetadataCatalog(
  options: StepMetadataCatalogOptions = {},
): StepMetadataCatalog {
  const registry = useNodeRegistryOptional();
  const prefs = usePipelineEditorPreferencesOptional();
  const tierLevel = options.tierLevel ?? prefs?.tierLevel;
  const deepLearningAvailable = useDeepLearningAvailable();
  const hideDeepLearning = options.hideDeepLearning ?? !deepLearningAvailable;
  const { canInstall } = usePyTorchInstallPrompt();
  const pyTorchInstallable = options.pyTorchInstallable ?? canInstall;

  return useMemo(
    () => createStepMetadataCatalog(registry, { tierLevel, hideDeepLearning, pyTorchInstallable }),
    [registry, tierLevel, hideDeepLearning, pyTorchInstallable],
  );
}
