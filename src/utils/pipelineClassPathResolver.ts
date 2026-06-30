import type { StepType } from "@/components/pipeline-editor/types";
import { stepOptions } from "@/components/pipeline-editor/stepOptions";
import preprocessingNodes from "@/data/nodes/definitions/preprocessing";
import splittingNodes from "@/data/nodes/definitions/splitting";
import modelNodes from "@/data/nodes/definitions/models";
import yProcessingNodes from "@/data/nodes/definitions/y-processing";
import filterNodes from "@/data/nodes/definitions/filters";
import augmentationNodes from "@/data/nodes/definitions/augmentation";
import { parametersToDefaultParams, type NodeDefinition } from "@/data/nodes/types";
import { castParamRecord } from "./pipelineValueUtils";

export interface ResolvedClassInfo {
  name: string;
  type: StepType;
  classPath?: string;
}

export interface PipelineStepClassReference {
  type: StepType;
  name: string;
  classPath?: string;
  functionPath?: string;
}

export const SUPPORTED_OPERATOR_NODES: NodeDefinition[] = [
  ...preprocessingNodes,
  ...splittingNodes,
  ...modelNodes,
  ...yProcessingNodes,
  ...filterNodes,
  ...augmentationNodes,
];

/**
 * Curated `${type}:${displayName} -> class path` overrides for the few nirs4all
 * operators whose editor display name or preferred public export path is not
 * encoded by the registry definition's `name`/`aliases`/`classPath`.
 */
const CURATED_NAME_TO_CLASS_PATH: Record<string, string> = {
  "augmentation:GaussianNoise": "nirs4all.operators.transforms.GaussianAdditiveNoise",
  "augmentation:MultiplicativeNoise": "nirs4all.operators.transforms.MultiplicativeNoise",
  "augmentation:WavelengthShift": "nirs4all.operators.transforms.WavelengthShift",
  "augmentation:LinearBaselineDrift": "nirs4all.operators.transforms.LinearBaselineDrift",
  "model:nicon": "nirs4all.operators.models.pytorch.nicon.nicon",
};

function buildClassPathMappings(): Record<string, { name: string; type: StepType }> {
  const mappings: Record<string, { name: string; type: StepType }> = {};
  for (const node of SUPPORTED_OPERATOR_NODES) {
    const value = { name: node.name, type: node.type as StepType };
    const paths = [node.classPath, ...(node.legacyClassPaths || [])];
    for (const path of paths) {
      if (path && !(path in mappings)) {
        mappings[path] = value;
      }
    }
  }
  return mappings;
}

function buildNameToClassPath(): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const node of SUPPORTED_OPERATOR_NODES) {
    if (!node.classPath) {
      continue;
    }
    for (const name of [node.name, ...(node.aliases || [])]) {
      const key = `${node.type}:${name}`;
      if (!(key in mapping)) {
        mapping[key] = node.classPath;
      }
    }
  }
  return { ...mapping, ...CURATED_NAME_TO_CLASS_PATH };
}

const CLASS_PATH_MAPPINGS: Record<string, { name: string; type: StepType }> = buildClassPathMappings();
const NAME_TO_CLASS_PATH: Record<string, string> = buildNameToClassPath();

export function getClassNameFromPath(classPath: string): string {
  const parts = classPath.split(".");
  return parts[parts.length - 1];
}

export function isFunctionModelPath(reference?: string): boolean {
  if (!reference || !reference.includes(".")) {
    return false;
  }

  const leafName = getClassNameFromPath(reference);
  return leafName.length > 0 && leafName[0] === leafName[0].toLowerCase();
}

export function inferFunctionModelFramework(reference?: string): string | undefined {
  if (!reference) {
    return undefined;
  }

  const normalized = reference.toLowerCase();
  if (normalized.includes(".pytorch.") || normalized.includes(".torch.")) {
    return "pytorch";
  }
  if (normalized.includes(".tensorflow.") || normalized.includes(".keras.")) {
    return "tensorflow";
  }
  if (normalized.includes(".jax.") || normalized.includes(".flax.")) {
    return "jax";
  }
  return undefined;
}

function buildClassReferenceLookup(): Map<string, ResolvedClassInfo> {
  const lookup = new Map<string, ResolvedClassInfo>();

  const register = (
    key: string | undefined,
    value: ResolvedClassInfo,
    overwrite = false
  ) => {
    if (!key) return;
    const normalized = key.trim().toLowerCase();
    if (!normalized) return;
    if (!overwrite && lookup.has(normalized)) return;
    lookup.set(normalized, value);
  };

  const optionLookup = new Map<string, ResolvedClassInfo>();
  for (const type of Object.keys(stepOptions) as StepType[]) {
    const options = stepOptions[type];
    for (const option of options) {
      const key = option.name.toLowerCase();
      if (optionLookup.has(key)) continue;
      optionLookup.set(key, {
        name: option.name,
        type,
        classPath: NAME_TO_CLASS_PATH[`${type}:${option.name}`],
      });
    }
  }

  for (const node of SUPPORTED_OPERATOR_NODES) {
    const type = node.type as StepType;
    const preferredOption = optionLookup.get(node.name.toLowerCase());
    const preferredAlias = (node.aliases || [])
      .map(alias => optionLookup.get(alias.toLowerCase()))
      .find(Boolean);
    const preferred = preferredOption || preferredAlias;

    const resolved: ResolvedClassInfo = {
      name: preferred?.name || node.name,
      type: preferred?.type || type,
      classPath: node.classPath,
    };

    register(node.name, resolved);
    register(node.classPath, resolved);
    register(getClassNameFromPath(node.classPath || ""), resolved);

    for (const alias of node.aliases || []) {
      register(alias, resolved);
    }
    for (const legacyPath of node.legacyClassPaths || []) {
      register(legacyPath, resolved);
      register(getClassNameFromPath(legacyPath), resolved);
    }
  }

  for (const [key, classPath] of Object.entries(NAME_TO_CLASS_PATH)) {
    const [type, name] = key.split(":") as [StepType, string];
    const resolved: ResolvedClassInfo = { name, type, classPath };
    register(name, resolved);
    register(classPath, resolved);
    register(getClassNameFromPath(classPath), resolved);
  }

  return lookup;
}

const CLASS_REFERENCE_LOOKUP = buildClassReferenceLookup();

export function matchesNodeDefinitionReference(
  node: NodeDefinition,
  type: StepType,
  reference: string
): boolean {
  if (node.type !== type) {
    return false;
  }

  const normalizedReference = reference.trim().toLowerCase();
  return (
    node.name.toLowerCase() === normalizedReference ||
    node.classPath?.toLowerCase() === normalizedReference ||
    (node.aliases || []).some(alias => alias.toLowerCase() === normalizedReference) ||
    (node.legacyClassPaths || []).some(path => path.toLowerCase() === normalizedReference)
  );
}

function getNodeDefaultParams(node: NodeDefinition): Record<string, unknown> {
  const defaults = (node as NodeDefinition & { defaultParams?: Record<string, unknown> }).defaultParams;
  return castParamRecord(defaults);
}

export function getDefaultParamsForStep(step: PipelineStepClassReference): Record<string, unknown> {
  const references = [step.name, step.classPath, step.functionPath].filter(
    (reference): reference is string => typeof reference === "string" && reference.trim().length > 0
  );

  for (const reference of references) {
    const node = SUPPORTED_OPERATOR_NODES.find(candidate =>
      matchesNodeDefinitionReference(candidate, step.type, reference)
    );
    if (!node) {
      continue;
    }

    const registryDefaults = {
      ...parametersToDefaultParams(node.parameters || []),
      ...getNodeDefaultParams(node),
    };
    if (Object.keys(registryDefaults).length > 0) {
      return registryDefaults;
    }
  }

  return castParamRecord(
    stepOptions[step.type]?.find(option => option.name === step.name)?.defaultParams as
      | Record<string, unknown>
      | undefined
  );
}

export function resolveClassPath(classPath: string): ResolvedClassInfo {
  if (CLASS_PATH_MAPPINGS[classPath]) {
    return { ...CLASS_PATH_MAPPINGS[classPath], classPath };
  }

  const directLookup = CLASS_REFERENCE_LOOKUP.get(classPath.trim().toLowerCase());
  if (directLookup) {
    return {
      ...directLookup,
      classPath: classPath.includes(".") ? classPath : directLookup.classPath,
    };
  }

  const className = getClassNameFromPath(classPath);
  const classNameLookup = CLASS_REFERENCE_LOOKUP.get(className.toLowerCase());
  if (classNameLookup) {
    return {
      ...classNameLookup,
      classPath: classPath.includes(".") ? classPath : classNameLookup.classPath,
    };
  }

  if (classPath.includes("model_selection") || classPath.includes("splitters")) {
    return { name: className, type: "splitting", classPath };
  }
  if (classPath.includes("cross_decomposition") || classPath.includes("ensemble") ||
      classPath.includes("linear_model") || classPath.includes("svm") ||
      classPath.includes("models")) {
    return { name: className, type: "model", classPath };
  }
  if (classPath.includes("preprocessing") || classPath.includes("decomposition") ||
      classPath.includes("transforms")) {
    return { name: className, type: "preprocessing", classPath };
  }
  if (classPath.includes("augmentation")) {
    return { name: className, type: "augmentation", classPath };
  }
  if (classPath.includes("filters")) {
    return { name: className, type: "filter", classPath };
  }

  return { name: className, type: "preprocessing", classPath: classPath.includes(".") ? classPath : undefined };
}

export function getClassPath(type: StepType, name: string): string {
  const normalizedName = name.trim();
  const key = `${type}:${normalizedName}`;
  if (NAME_TO_CLASS_PATH[key]) {
    return NAME_TO_CLASS_PATH[key];
  }

  const lookupByName = CLASS_REFERENCE_LOOKUP.get(normalizedName.toLowerCase());
  if (lookupByName?.type === type && lookupByName.classPath) {
    return lookupByName.classPath;
  }

  if (normalizedName.includes(".")) {
    return resolveClassPath(normalizedName).classPath || normalizedName;
  }

  if (type === "preprocessing") {
    return `sklearn.preprocessing.${normalizedName}`;
  }
  if (type === "y_processing") {
    return `sklearn.preprocessing.${normalizedName}`;
  }
  if (type === "splitting") {
    return `sklearn.model_selection.${normalizedName}`;
  }

  return normalizedName;
}

export function resolveConfiguredClassPath(
  type: StepType,
  name: string,
  classPath?: string
): string {
  const explicit = classPath?.trim();
  if (type !== "model" && explicit?.includes(".")) {
    return explicit;
  }

  const preferred = getClassPath(type, name);
  if (preferred.includes(".")) {
    return preferred;
  }

  if (explicit?.includes(".")) {
    return explicit;
  }

  return preferred;
}

export function resolveRequiredClassPath(
  step: PipelineStepClassReference,
  type: StepType = step.type
): string {
  const resolved = resolveConfiguredClassPath(type, step.name, step.classPath);
  if (resolved.includes(".")) {
    return resolved;
  }
  throw new Error(
    `Could not resolve class path for ${type} step "${step.name}". Check that the step definition is valid.`
  );
}
