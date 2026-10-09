/**
 * Spectra Synthesis Component Catalog
 *
 * Defines predefined chemical components for synthesis configuration.
 */

import type { ChemicalComponent } from "./types";

/**
 * Predefined chemical components
 */
export const CHEMICAL_COMPONENTS: ChemicalComponent[] = [
  // Water
  { name: "water", category: "water" },
  { name: "moisture", category: "water" },

  // Proteins
  { name: "protein", category: "proteins" },
  { name: "nitrogen_compound", category: "proteins" },
  { name: "urea", category: "proteins" },
  { name: "amino_acid", category: "proteins" },
  { name: "casein", category: "proteins" },
  { name: "gluten", category: "proteins" },

  // Carbohydrates
  { name: "starch", category: "carbohydrates" },
  { name: "cellulose", category: "carbohydrates" },
  { name: "glucose", category: "carbohydrates" },
  { name: "fructose", category: "carbohydrates" },
  { name: "sucrose", category: "carbohydrates" },
  { name: "lactose", category: "carbohydrates" },
  { name: "hemicellulose", category: "carbohydrates" },
  { name: "lignin", category: "carbohydrates" },
  { name: "dietary_fiber", category: "carbohydrates" },

  // Lipids
  { name: "lipid", category: "lipids" },
  { name: "oil", category: "lipids" },
  { name: "saturated_fat", category: "lipids" },
  { name: "unsaturated_fat", category: "lipids" },
  { name: "waxes", category: "lipids" },

  // Alcohols
  { name: "ethanol", category: "alcohols" },
  { name: "methanol", category: "alcohols" },
  { name: "glycerol", category: "alcohols" },

  // Acids
  { name: "acetic_acid", category: "acids" },
  { name: "citric_acid", category: "acids" },
  { name: "lactic_acid", category: "acids" },
  { name: "malic_acid", category: "acids" },
  { name: "tartaric_acid", category: "acids" },

  // Pigments
  { name: "chlorophyll", category: "pigments" },
  { name: "carotenoid", category: "pigments" },
  { name: "tannins", category: "pigments" },

  // Pharmaceuticals
  { name: "caffeine", category: "pharmaceuticals" },
  { name: "aspirin", category: "pharmaceuticals" },
  { name: "paracetamol", category: "pharmaceuticals" },

  // Polymers
  { name: "polyethylene", category: "polymers" },
  { name: "polystyrene", category: "polymers" },
  { name: "natural_rubber", category: "polymers" },
  { name: "nylon", category: "polymers" },
  { name: "cotton", category: "polymers" },
  { name: "polyester", category: "polymers" },

  // Minerals
  { name: "carbonates", category: "minerals" },
  { name: "gypsum", category: "minerals" },
  { name: "kaolinite", category: "minerals" },

  // Other
  { name: "aromatic", category: "other" },
  { name: "alkane", category: "other" },
  { name: "acetone", category: "other" },
];
