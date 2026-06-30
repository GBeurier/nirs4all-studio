/**
 * Spectra Synthesis Definition Builders
 *
 * Pure lookup and default-value helpers for synthesis definitions.
 */

import type {
  ChemicalComponent,
  SynthesisCategoryDefinition,
  SynthesisStepDefinition,
} from "./types";
import {
  CHEMICAL_COMPONENTS,
  SYNTHESIS_CATEGORIES,
  SYNTHESIS_STEPS,
} from "./definitionCatalogs";

/**
 * Get step definition by type
 */
export function getStepDefinition(type: string): SynthesisStepDefinition | undefined {
  return SYNTHESIS_STEPS.find((s) => s.type === type);
}

/**
 * Get steps by category
 */
export function getStepsByCategory(category: string): SynthesisStepDefinition[] {
  return SYNTHESIS_STEPS.filter((s) => s.category === category);
}

/**
 * Get category definition
 */
export function getCategoryDefinition(id: string): SynthesisCategoryDefinition | undefined {
  return SYNTHESIS_CATEGORIES.find((c) => c.id === id);
}

/**
 * Get components by category
 */
export function getComponentsByCategory(category: string): ChemicalComponent[] {
  return CHEMICAL_COMPONENTS.filter((c) => c.category === category);
}

/**
 * Get all component names as options for multiselect
 */
export function getComponentOptions(): { value: string; label: string; description: string }[] {
  return CHEMICAL_COMPONENTS.map((c) => ({
    value: c.name,
    label: c.displayName,
    description: c.description,
  }));
}

/**
 * Default synthesis configuration
 */
export function getDefaultSynthesisConfig(): {
  name: string;
  n_samples: number;
  random_state: number | null;
} {
  return {
    name: "synthetic_nirs",
    n_samples: 1000,
    random_state: 42,
  };
}

/**
 * Create default step params for a step type
 */
export function getDefaultStepParams(type: string): Record<string, unknown> {
  const definition = getStepDefinition(type);
  if (!definition) return {};

  const params: Record<string, unknown> = {};
  for (const param of definition.parameters) {
    params[param.name] = param.default;
  }
  return params;
}
