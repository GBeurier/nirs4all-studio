/**
 * Node Registry Types
 * ====================
 *
 * TypeScript types for node definitions, generated from JSON Schema.
 * These types define the structure of node definitions used throughout
 * the pipeline editor.
 *
 * @see schema/node.schema.json
 * @see schema/parameter.schema.json
 */

// ============================================================================
// Node Types
// ============================================================================

/**
 * All possible node types (step categories).
 */
export type NodeType =
  | "preprocessing"
  | "y_processing"
  | "splitting"
  | "model"
  | "generator"
  | "branch"
  | "merge"
  | "filter"
  | "augmentation"
  | "sample_augmentation"
  | "feature_augmentation"
  | "sample_filter"
  | "concat_transform"
  | "chart"
  | "comment";

/**
 * Generator kinds for generator nodes.
 */
export type GeneratorKind = "or" | "cartesian";

/**
 * Container organization types.
 */
export type ContainerType = "branches" | "children";

/**
 * Source of node definition.
 */
export type NodeSource = "nirs4all" | "sklearn" | "custom";

// ============================================================================
// Parameter Types
// ============================================================================

/**
 * Parameter value types supported by the UI.
 */
export type ParameterType =
  | "int"
  | "float"
  | "bool"
  | "string"
  | "select"
  | "range"
  | "array"
  | "object";

/**
 * Finetune parameter types for Optuna optimization.
 */
export type FinetuneParamType = "int" | "float" | "log_float" | "categorical";

/**
 * Sweep preset types.
 */
export type SweepPresetType = "range" | "log_range" | "choices";

/**
 * Select option for dropdown parameters.
 */
export interface SelectOption {
  /** The actual value */
  value: string | number | boolean;
  /** Display label */
  label: string;
  /** Optional description for tooltip */
  description?: string;
}

/**
 * Sweep preset configuration for quick parameter sweep setup.
 */
export interface SweepPreset {
  /** Display label for the preset */
  label: string;
  /** Type of sweep */
  type: SweepPresetType;
  /** Values - object for range types, array for choices */
  values: RangeValues | (string | number | boolean)[];
}

/**
 * Range values for range/log_range sweep presets.
 */
export interface RangeValues {
  from: number;
  to: number;
  step?: number;
  count?: number;
}

/**
 * Conditional default configuration.
 */
export interface ConditionalDefault {
  /** Parameter name this depends on */
  param: string;
  /** Mapping of dependent param values to default values */
  mapping: Record<string, unknown>;
}

/**
 * Full parameter definition.
 */
export interface ParameterDefinition {
  // === Identity ===
  /** Parameter name (Python argument name) */
  name: string;
  /** Display label (defaults to humanized name) */
  label?: string;

  // === Type ===
  /** Parameter value type */
  type: ParameterType;

  // === Constraints ===
  /** Is this parameter required? */
  required?: boolean;
  /** Default value */
  default?: unknown;
  /** Minimum value (numeric types) */
  min?: number;
  /** Maximum value (numeric types) */
  max?: number;
  /** Step size for numeric inputs */
  step?: number;
  /** Min length (string/array) */
  minLength?: number;
  /** Max length (string/array) */
  maxLength?: number;
  /** Regex pattern (strings) */
  pattern?: string;

  // === Select Options ===
  /** Options for select type */
  options?: SelectOption[];
  /** Allow values not in options */
  allowCustom?: boolean;

  // === Display ===
  /** Tooltip/help text */
  description?: string;
  /** Input placeholder */
  placeholder?: string;
  /** Display unit */
  unit?: string;
  /** Parameter group */
  group?: string;
  /** Display order within group */
  order?: number;

  // === Behavior ===
  /** Hide in basic view */
  isAdvanced?: boolean;
  /** Require expert mode to edit */
  isExpert?: boolean;
  /** Never show in UI (internal use) */
  isHidden?: boolean;

  // === Validation ===
  /** Custom validator function name */
  validator?: string;
  /** Only show if this param has specific value */
  dependsOn?: string;
  /** Value that enables this param */
  dependsOnValue?: unknown;
  /** Default varies based on other params */
  conditionalDefault?: ConditionalDefault;

  // === Generator Support ===
  /** Can this param have a sweep attached? */
  sweepable?: boolean;
  /** Quick presets for this param */
  sweepPresets?: SweepPreset[];
  /** Can this param be finetuned with Optuna? */
  finetunable?: boolean;
  /** Type for finetuning */
  finetuneType?: FinetuneParamType;
  /** Default finetune range [min, max] */
  finetuneRange?: [number, number];
}

// ============================================================================
// Node Definition
// ============================================================================

/**
 * Color scheme for node styling.
 */
export interface ColorScheme {
  border?: string;
  bg?: string;
  hover?: string;
  selected?: string;
  text?: string;
  active?: string;
  gradient?: string;
}

/**
 * Full node definition.
 */
export interface NodeDefinition {
  // === Identity ===
  /** Unique identifier: "preprocessing.snv" */
  id: string;
  /** Display name: "SNV" */
  name: string;
  /** Category: "preprocessing", "model", etc. */
  type: NodeType;

  // === nirs4all Mapping ===
  /** Full import path: "nirs4all.operators.transforms.StandardNormalVariate" */
  classPath?: string;
  /** Alternative names: ["StandardNormalVariate", "standard_normal_variate"] */
  aliases?: string[];
  /** For function-based operators */
  functionPath?: string;

  // === Display ===
  /** Short description for tooltips */
  description: string;
  /** Extended documentation */
  longDescription?: string;
  /** Subcategory: "NIRS Core", "Baseline", etc. */
  category?: string;
  /** Optional icon override */
  icon?: string;
  /** Optional color override */
  color?: ColorScheme;
  /** Searchable tags: ["scatter", "normalization"] */
  tags?: string[];

  // === Parameters ===
  parameters: ParameterDefinition[];

  // === Behavior ===
  /** Hide in basic mode */
  isAdvanced?: boolean;
  /** Show training config tab */
  isDeepLearning?: boolean;
  /** Show warning badge */
  isExperimental?: boolean;
  /** Show deprecation notice */
  isDeprecated?: boolean;
  /** Migration guidance */
  deprecationMessage?: string;

  // === Constraints ===
  /** Can only appear after these types */
  validAfter?: NodeType[];
  /** Can only appear before these types */
  validBefore?: NodeType[];
  /** Must have a splitter before this node */
  requiresSplitter?: boolean;
  /** Max occurrences in pipeline */
  maxInstances?: number;

  // === Generator Support ===
  /** Can use _range_, _or_, etc. */
  supportsParameterSweeps?: boolean;
  /** Can use finetune_params (models only) */
  supportsFinetuning?: boolean;
  /** Can be wrapped in _or_ at step level */
  supportsStepGenerator?: boolean;
  /** Is this node a generator type (_or_, _range_, etc.) */
  isGenerator?: boolean;

  // === Container Behavior ===
  /** Has children (sample_augmentation, branch, etc.) */
  isContainer?: boolean;
  /** How children are organized */
  containerType?: ContainerType;
  /** Initial branch count for container nodes */
  defaultBranches?: number;
  /** For generator nodes */
  generatorKind?: GeneratorKind;

  // === Versioning & Migration ===
  source: NodeSource;
  /** Minimum nirs4all version required */
  version?: string;
  /** Maximum supported version (for deprecated) */
  maxVersion?: string;
  /** Previous class paths for backwards compatibility */
  legacyClassPaths?: string[];
}

// ============================================================================
// Category Types
// ============================================================================

/**
 * Subcategory configuration.
 */
export interface SubcategoryConfig {
  id: string;
  label: string;
  description?: string;
  displayOrder: number;
}

/**
 * Category configuration for a node type.
 */
export interface CategoryConfig {
  type: NodeType;
  label: string;
  description: string;
  icon: string;
  color: ColorScheme;
  subcategories: SubcategoryConfig[];
  defaultOpen?: boolean;
  displayOrder: number;
}

// ============================================================================
// Registry Types
// ============================================================================

/**
 * Feature flag configuration for gradual rollout.
 */
export interface FeatureFlags {
  /** Use JSON registry instead of stepOptions */
  useNodeRegistry: boolean;
  /** Enable custom node support */
  allowCustomNodes: boolean;
  /** Enable validation panel */
  enableValidation: boolean;
}

/**
 * Node registry configuration.
 */
export interface RegistryConfig {
  /** Current registry version */
  version: string;
  /** nirs4all version this registry is synced with */
  nirs4allVersion?: string;
  /** Last sync date */
  lastSyncDate?: string;
  /** Feature flags */
  featureFlags: FeatureFlags;
}

/**
 * Custom node storage format.
 */
export interface CustomNodesFile {
  version: string;
  nodes: NodeDefinition[];
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Default params type (for backwards compatibility with stepOptions).
 */
export type DefaultParams = Record<string, string | number | boolean>;

/**
 * Convert ParameterDefinition[] to DefaultParams.
 */
export function parametersToDefaultParams(
  parameters: ParameterDefinition[]
): DefaultParams {
  const result: DefaultParams = {};
  for (const param of parameters) {
    if (param.default !== undefined) {
      if (
        typeof param.default === "string" ||
        typeof param.default === "number" ||
        typeof param.default === "boolean"
      ) {
        result[param.name] = param.default;
      }
    }
  }
  return result;
}

/**
 * Get the display label for a parameter.
 */
export function getParameterLabel(param: ParameterDefinition): string {
  if (param.label) return param.label;
  // Humanize the name: snake_case -> Title Case
  return param.name
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
