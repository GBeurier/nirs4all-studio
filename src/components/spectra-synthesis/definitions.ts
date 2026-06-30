/**
 * Spectra Synthesis Step Definitions
 *
 * Compatibility entry point for synthesis catalogs and pure definition helpers.
 */

export {
  CHEMICAL_COMPONENTS,
  SYNTHESIS_CATEGORIES,
  SYNTHESIS_STEPS,
} from "./definitionCatalogs";
export {
  getCategoryDefinition,
  getComponentOptions,
  getComponentsByCategory,
  getDefaultStepParams,
  getDefaultSynthesisConfig,
  getStepDefinition,
  getStepsByCategory,
} from "./definitionBuilders";
