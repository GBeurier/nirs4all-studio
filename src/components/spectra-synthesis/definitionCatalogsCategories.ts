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
    icon: "Waves",
  },
  {
    id: "targets",
    icon: "Target",
    exclusive: true,  // Only targets OR classification
  },
  {
    id: "metadata",
    icon: "Database",
  },
  {
    id: "effects",
    icon: "Sparkles",
  },
  {
    id: "complexity",
    icon: "Brain",
  },
  {
    id: "output",
    icon: "FileOutput",
  },
];
