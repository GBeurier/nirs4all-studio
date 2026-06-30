/**
 * Spectra Synthesis Category Catalog
 *
 * Defines palette categories for synthesis steps.
 */

import type { SynthesisCategoryDefinition } from "./types";

/**
 * Category definitions for the palette
 */
export const SYNTHESIS_CATEGORIES: SynthesisCategoryDefinition[] = [
  {
    id: "basic",
    label: "Basic Configuration",
    icon: "Waves",
    description: "Configure spectral features and wavelength range",
  },
  {
    id: "targets",
    label: "Target Configuration",
    icon: "Target",
    description: "Configure regression targets or classification labels",
    exclusive: true,  // Only targets OR classification
  },
  {
    id: "metadata",
    label: "Metadata & Partitions",
    icon: "Database",
    description: "Configure sample metadata and train/test splits",
  },
  {
    id: "effects",
    label: "Effects & Sources",
    icon: "Sparkles",
    description: "Add batch effects and multi-source support",
  },
  {
    id: "complexity",
    label: "Target Complexity",
    icon: "Brain",
    description: "Add non-linear interactions and complex relationships",
  },
  {
    id: "output",
    label: "Output",
    icon: "FileOutput",
    description: "Configure output format",
  },
];
