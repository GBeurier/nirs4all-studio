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
  { name: "water", displayName: "Water", description: "H2O absorption bands", category: "water" },
  { name: "moisture", displayName: "Moisture", description: "Sample moisture content", category: "water" },

  // Proteins
  { name: "protein", displayName: "Protein", description: "General protein content", category: "proteins" },
  { name: "nitrogen_compound", displayName: "Nitrogen Compound", description: "N-H bonds", category: "proteins" },
  { name: "urea", displayName: "Urea", description: "Urea content", category: "proteins" },
  { name: "amino_acid", displayName: "Amino Acid", description: "Free amino acids", category: "proteins" },
  { name: "casein", displayName: "Casein", description: "Milk protein", category: "proteins" },
  { name: "gluten", displayName: "Gluten", description: "Wheat protein", category: "proteins" },

  // Carbohydrates
  { name: "starch", displayName: "Starch", description: "Starch content", category: "carbohydrates" },
  { name: "cellulose", displayName: "Cellulose", description: "Cellulose fiber", category: "carbohydrates" },
  { name: "glucose", displayName: "Glucose", description: "Simple sugar", category: "carbohydrates" },
  { name: "fructose", displayName: "Fructose", description: "Fruit sugar", category: "carbohydrates" },
  { name: "sucrose", displayName: "Sucrose", description: "Table sugar", category: "carbohydrates" },
  { name: "lactose", displayName: "Lactose", description: "Milk sugar", category: "carbohydrates" },
  { name: "hemicellulose", displayName: "Hemicellulose", description: "Plant fiber", category: "carbohydrates" },
  { name: "lignin", displayName: "Lignin", description: "Plant structural polymer", category: "carbohydrates" },
  { name: "dietary_fiber", displayName: "Dietary Fiber", description: "Total fiber content", category: "carbohydrates" },

  // Lipids
  { name: "lipid", displayName: "Lipid", description: "General fat content", category: "lipids" },
  { name: "oil", displayName: "Oil", description: "Liquid fats", category: "lipids" },
  { name: "saturated_fat", displayName: "Saturated Fat", description: "No double bonds", category: "lipids" },
  { name: "unsaturated_fat", displayName: "Unsaturated Fat", description: "With double bonds", category: "lipids" },
  { name: "waxes", displayName: "Waxes", description: "Long-chain esters", category: "lipids" },

  // Alcohols
  { name: "ethanol", displayName: "Ethanol", description: "Alcohol content", category: "alcohols" },
  { name: "methanol", displayName: "Methanol", description: "Wood alcohol", category: "alcohols" },
  { name: "glycerol", displayName: "Glycerol", description: "Sugar alcohol", category: "alcohols" },

  // Acids
  { name: "acetic_acid", displayName: "Acetic Acid", description: "Vinegar acid", category: "acids" },
  { name: "citric_acid", displayName: "Citric Acid", description: "Citrus acid", category: "acids" },
  { name: "lactic_acid", displayName: "Lactic Acid", description: "Fermentation acid", category: "acids" },
  { name: "malic_acid", displayName: "Malic Acid", description: "Apple acid", category: "acids" },
  { name: "tartaric_acid", displayName: "Tartaric Acid", description: "Grape acid", category: "acids" },

  // Pigments
  { name: "chlorophyll", displayName: "Chlorophyll", description: "Plant pigment", category: "pigments" },
  { name: "carotenoid", displayName: "Carotenoid", description: "Orange/yellow pigment", category: "pigments" },
  { name: "tannins", displayName: "Tannins", description: "Polyphenolic compounds", category: "pigments" },

  // Pharmaceuticals
  { name: "caffeine", displayName: "Caffeine", description: "Stimulant compound", category: "pharmaceuticals" },
  { name: "aspirin", displayName: "Aspirin", description: "Acetylsalicylic acid", category: "pharmaceuticals" },
  { name: "paracetamol", displayName: "Paracetamol", description: "Pain reliever", category: "pharmaceuticals" },

  // Polymers
  { name: "polyethylene", displayName: "Polyethylene", description: "PE plastic", category: "polymers" },
  { name: "polystyrene", displayName: "Polystyrene", description: "PS plastic", category: "polymers" },
  { name: "natural_rubber", displayName: "Natural Rubber", description: "Latex rubber", category: "polymers" },
  { name: "nylon", displayName: "Nylon", description: "Polyamide", category: "polymers" },
  { name: "cotton", displayName: "Cotton", description: "Natural fiber", category: "polymers" },
  { name: "polyester", displayName: "Polyester", description: "Synthetic fiber", category: "polymers" },

  // Minerals
  { name: "carbonates", displayName: "Carbonates", description: "CO3 minerals", category: "minerals" },
  { name: "gypsum", displayName: "Gypsum", description: "Calcium sulfate", category: "minerals" },
  { name: "kaolinite", displayName: "Kaolinite", description: "Clay mineral", category: "minerals" },

  // Other
  { name: "aromatic", displayName: "Aromatic", description: "Aromatic compounds", category: "other" },
  { name: "alkane", displayName: "Alkane", description: "Saturated hydrocarbons", category: "other" },
  { name: "acetone", displayName: "Acetone", description: "Ketone solvent", category: "other" },
];
