/**
 * Spectra Synthesis Types
 *
 * Type definitions for the synthetic NIRS dataset builder interface.
 * Maps to nirs4all SyntheticDatasetBuilder API.
 */

import type { LucideIcon } from "lucide-react";

// Builder step types - each maps to a with_*() method
export type SynthesisStepType =
  | "features"           // with_features()
  | "targets"            // with_targets()
  | "classification"     // with_classification()
  | "metadata"           // with_metadata()
  | "sources"            // with_sources()
  | "partitions"         // with_partitions()
  | "batch_effects"      // with_batch_effects()
  | "nonlinear_targets"  // with_nonlinear_targets()
  | "target_complexity"  // with_target_complexity()
  | "complex_landscape"  // with_complex_target_landscape()
  | "output";            // with_output()

// Complexity levels for spectral features
export type Complexity = "simple" | "realistic" | "complex";

// Concentration distribution methods
export type Distribution = "dirichlet" | "uniform" | "lognormal" | "correlated";

// Target transform types
export type TargetTransform = "log" | "sqrt" | null;

// Class separation methods
export type SeparationMethod = "component" | "threshold" | "cluster";

// Non-linear interaction types
export type InteractionType = "polynomial" | "synergistic" | "antagonistic";

// Regime assignment methods
export type RegimeMethod = "concentration" | "spectral" | "random";

// Source type for multi-source datasets
export type SourceType = "nir" | "aux" | "markers";

/**
 * Individual synthesis step
 */
export interface SynthesisStep {
  id: string;
  type: SynthesisStepType;
  method: string;        // e.g., "with_features"
  params: Record<string, unknown>;
  enabled: boolean;
  order: number;
}

/**
 * Complete synthesis configuration
 */
export interface SynthesisConfig {
  name: string;
  n_samples: number;
  random_state: number | null;
  steps: SynthesisStep[];
}

/**
 * Source configuration for multi-source datasets
 */
export interface SourceConfig {
  name: string;
  type: SourceType;
  wavelength_range?: [number, number];
  n_features?: number;
}

/**
 * Step definition for the palette
 */
export interface SynthesisStepDefinition {
  id: string;
  type: SynthesisStepType;
  method: string;
  name: string;
  description: string;
  category: SynthesisCategory;
  icon: string;
  color: {
    border: string;
    bg: string;
    text: string;
  };
  mutuallyExclusive?: SynthesisStepType[];
  requires?: SynthesisStepType[];
  parameters: ParameterDefinition[];
}

/**
 * Parameter definition for step configuration
 */
export interface ParameterDefinition {
  name: string;
  label: string;
  type: ParameterType;
  default: unknown;
  description?: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: ParameterOption[];
  allowNull?: boolean;
  dynamicOptions?: string;  // e.g., "components" to get from features step
}

export type ParameterType =
  | "int"
  | "float"
  | "boolean"
  | "string"
  | "select"
  | "multiselect"
  | "range"     // [min, max] tuple
  | "array";    // Array of values

export interface ParameterOption {
  value: string | number | boolean | null;
  label: string;
  description?: string;
}

/**
 * Category for grouping steps in the palette
 */
export type SynthesisCategory =
  | "basic"
  | "targets"
  | "metadata"
  | "effects"
  | "complexity"
  | "output";

export interface SynthesisCategoryDefinition {
  id: SynthesisCategory;
  label: string;
  icon: string;
  description: string;
  exclusive?: boolean;  // Only one step from this category allowed
}

/**
 * Validation types
 */
export interface ValidationError {
  stepId?: string;
  field?: string;
  message: string;
  severity: "error";
}

export interface ValidationWarning {
  stepId?: string;
  field?: string;
  message: string;
  severity: "warning";
}

export type ValidationResult = ValidationError | ValidationWarning;

/**
 * Preview data from the backend
 */
export interface PreviewData {
  spectra: number[][];     // Shape: [n_samples, n_wavelengths]
  wavelengths: number[];
  targets: number[];
  target_type: "regression" | "classification";
  statistics: PreviewStatistics;
  actual_samples: number;  // Full dataset would have this many
  execution_time_ms: number;
}

export interface PreviewStatistics {
  spectra: {
    mean: number;
    std: number;
    min: number;
    max: number;
  };
  targets: {
    mean: number;
    std: number;
    min: number;
    max: number;
  };
  n_wavelengths: number;
  n_components?: number;
  class_distribution?: Record<string, number>;
}

/**
 * Export options
 */
export type ExportFormat = "workspace" | "csv" | "folder";

export interface ExportOptions {
  format: ExportFormat;
  path?: string;
  name: string;
  includeConfig: boolean;
}

/**
 * Predefined chemical component
 */
export interface ChemicalComponent {
  name: string;
  displayName: string;
  description: string;
  category: ComponentCategory;
}

export type ComponentCategory =
  | "proteins"
  | "carbohydrates"
  | "lipids"
  | "water"
  | "alcohols"
  | "acids"
  | "pigments"
  | "pharmaceuticals"
  | "polymers"
  | "minerals"
  | "other";
