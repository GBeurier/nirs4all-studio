/**
 * Spectra Synthesis Step Definitions
 *
 * Defines all available synthesis steps, their parameters, and categories.
 * Maps to nirs4all SyntheticDatasetBuilder methods.
 */

import type {
  SynthesisStepDefinition,
  SynthesisCategoryDefinition,
  ChemicalComponent,
} from "./types";

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

/**
 * All synthesis step definitions
 */
export const SYNTHESIS_STEPS: SynthesisStepDefinition[] = [
  // === Basic ===
  {
    id: "synthesis.features",
    type: "features",
    method: "with_features",
    name: "Features",
    description: "Configure spectral feature generation with detailed physics-based parameters",
    category: "basic",
    icon: "Waves",
    color: {
      border: "border-blue-500/30",
      bg: "bg-blue-500/10",
      text: "text-blue-600 dark:text-blue-400",
    },
    parameters: [
      // === Wavelength Configuration ===
      {
        name: "wavelength_range",
        label: "Wavelength Range",
        type: "range",
        default: [1000, 2500],
        min: 350,
        max: 3000,
        unit: "nm",
        description: "NIR wavelength range (start, end)",
        group: "wavelength",
      },
      {
        name: "wavelength_step",
        label: "Wavelength Step",
        type: "float",
        default: 2.0,
        min: 0.5,
        max: 10,
        step: 0.5,
        unit: "nm",
        description: "Sampling resolution between wavelengths",
        group: "wavelength",
      },
      // === Components ===
      {
        name: "components",
        label: "Components",
        type: "multiselect",
        default: ["water", "protein", "lipid"],
        dynamicOptions: "components",
        description: "Chemical components to simulate in spectra",
        group: "components",
      },
      // === Complexity Preset (optional quick setup) ===
      {
        name: "complexity",
        label: "Complexity Preset",
        type: "select",
        default: "custom",
        options: [
          { value: "simple", label: "Simple", description: "Minimal noise, ideal conditions" },
          { value: "realistic", label: "Realistic", description: "Typical NIR conditions" },
          { value: "complex", label: "Complex", description: "Challenging conditions" },
          { value: "custom", label: "Custom", description: "Use manual parameters below" },
        ],
        description: "Quick preset or custom configuration",
        group: "preset",
      },
      // === Path Length & Beer-Lambert ===
      {
        name: "path_length_std",
        label: "Path Length Variation",
        type: "float",
        default: 0.05,
        min: 0,
        max: 0.2,
        step: 0.01,
        description: "Standard deviation of optical path length variation (Beer-Lambert L factor)",
        group: "physics",
      },
      // === Baseline Effects ===
      {
        name: "baseline_amplitude",
        label: "Baseline Amplitude",
        type: "float",
        default: 0.02,
        min: 0,
        max: 0.2,
        step: 0.005,
        description: "Amplitude of polynomial baseline drift",
        group: "baseline",
      },
      {
        name: "tilt_std",
        label: "Spectral Tilt",
        type: "float",
        default: 0.01,
        min: 0,
        max: 0.1,
        step: 0.005,
        description: "Standard deviation of linear spectral tilt",
        group: "baseline",
      },
      {
        name: "global_slope_mean",
        label: "Global Slope Mean",
        type: "float",
        default: 0.05,
        min: -0.2,
        max: 0.2,
        step: 0.01,
        description: "Mean slope across all spectra",
        group: "baseline",
      },
      {
        name: "global_slope_std",
        label: "Global Slope Std",
        type: "float",
        default: 0.03,
        min: 0,
        max: 0.2,
        step: 0.01,
        description: "Standard deviation of global slope",
        group: "baseline",
      },
      // === Scattering Effects ===
      {
        name: "scatter_alpha_std",
        label: "Scatter Alpha (Multiplicative)",
        type: "float",
        default: 0.05,
        min: 0,
        max: 0.2,
        step: 0.01,
        description: "MSC-like multiplicative scattering coefficient variation",
        group: "scatter",
      },
      {
        name: "scatter_beta_std",
        label: "Scatter Beta (Additive)",
        type: "float",
        default: 0.01,
        min: 0,
        max: 0.1,
        step: 0.005,
        description: "Additive scattering offset variation",
        group: "scatter",
      },
      // === Wavelength Shifts ===
      {
        name: "shift_std",
        label: "Wavelength Shift",
        type: "float",
        default: 0.5,
        min: 0,
        max: 5,
        step: 0.1,
        unit: "nm",
        description: "Random wavelength axis shift (instrument calibration variation)",
        group: "wavelength_effects",
      },
      {
        name: "stretch_std",
        label: "Wavelength Stretch",
        type: "float",
        default: 0.001,
        min: 0,
        max: 0.01,
        step: 0.0005,
        description: "Wavelength axis stretching/compression factor",
        group: "wavelength_effects",
      },
      // === Instrumental Effects ===
      {
        name: "instrumental_fwhm",
        label: "Instrumental FWHM",
        type: "float",
        default: 8,
        min: 1,
        max: 30,
        step: 1,
        unit: "nm",
        description: "Instrumental broadening (full width at half maximum)",
        group: "instrument",
      },
      // === Noise Model ===
      {
        name: "noise_base",
        label: "Base Noise Level",
        type: "float",
        default: 0.005,
        min: 0,
        max: 0.05,
        step: 0.001,
        description: "Constant noise floor (detector noise)",
        group: "noise",
      },
      {
        name: "noise_signal_dep",
        label: "Signal-Dependent Noise",
        type: "float",
        default: 0.01,
        min: 0,
        max: 0.1,
        step: 0.005,
        description: "Noise proportional to signal intensity (shot noise)",
        group: "noise",
      },
      // === Artifacts ===
      {
        name: "artifact_prob",
        label: "Artifact Probability",
        type: "float",
        default: 0.02,
        min: 0,
        max: 0.2,
        step: 0.01,
        description: "Probability of spectral artifacts (spikes, dropouts)",
        group: "artifacts",
      },
      // === Instrument Archetype (Phase 2) ===
      {
        name: "instrument",
        label: "Instrument Archetype",
        type: "select",
        default: null,
        allowNull: true,
        options: [
          { value: null, label: "Generic", description: "No specific instrument simulation" },
          // Lab-grade FT-NIR
          { value: "foss_xds", label: "FOSS XDS", description: "FOSS XDS Rapid Content Analyzer" },
          { value: "foss_infratec", label: "FOSS Infratec", description: "FOSS Infratec grain analyzer" },
          { value: "bruker_mpa", label: "Bruker MPA", description: "Bruker MPA FT-NIR" },
          { value: "thermo_antaris", label: "Thermo Antaris", description: "Thermo Antaris II FT-NIR" },
          { value: "perkin_spectrum_two", label: "PerkinElmer Spectrum Two", description: "PerkinElmer Spectrum Two FT-NIR" },
          { value: "abb_mb3600", label: "ABB MB3600", description: "ABB MB3600 FT-NIR" },
          { value: "buchi_nirmaster", label: "Buchi NIRMaster", description: "Buchi NIRMaster FT-NIR" },
          { value: "metrohm_ds2500", label: "Metrohm DS2500", description: "Metrohm/FOSS DS2500 scanning monochromator" },
          // Process/at-line
          { value: "perten_da7200", label: "Perten DA7200", description: "Perten DA7200 diode array" },
          { value: "unity_spectrastar", label: "Unity SpectraStar", description: "Unity Scientific SpectraStar" },
          { value: "nir_o_process", label: "NIR-O Process", description: "Process NIR analyzer" },
          // Field portable
          { value: "asd_fieldspec", label: "ASD FieldSpec", description: "ASD FieldSpec portable spectrometer" },
          { value: "viavi_micronir", label: "Viavi MicroNIR", description: "Viavi MicroNIR handheld" },
          // Miniature/consumer
          { value: "neospectra_micro", label: "NeoSpectra Micro", description: "Si-Ware NeoSpectra MEMS-based" },
          { value: "siware_neoscanner", label: "Si-Ware NeoScanner", description: "Si-Ware NeoScanner handheld" },
          { value: "scio", label: "SCiO", description: "Consumer Molecular Sensor SCiO" },
          { value: "tellspec", label: "TellSpec", description: "TellSpec food scanner" },
          { value: "linksquare", label: "LinkSquare", description: "LinkSquare pocket spectrometer" },
          { value: "innospectra", label: "InnoSpectra", description: "InnoSpectra NIR scanner" },
        ],
        description: "Simulate specific instrument characteristics",
        group: "instrument",
      },
      // === Measurement Mode (Phase 2) ===
      {
        name: "measurement_mode",
        label: "Measurement Mode",
        type: "select",
        default: null,
        allowNull: true,
        options: [
          { value: null, label: "Default", description: "No specific measurement mode" },
          { value: "transmittance", label: "Transmittance", description: "Light passes through sample" },
          { value: "reflectance", label: "Reflectance", description: "Diffuse reflectance mode" },
          { value: "transflectance", label: "Transflectance", description: "Combined transmission-reflection" },
          { value: "interactance", label: "Interactance", description: "Fiber-optic interactance probe" },
          { value: "atr", label: "ATR", description: "Attenuated Total Reflectance" },
        ],
        description: "Physical measurement configuration",
        group: "instrument",
      },
    ],
  },

  // === Targets ===
  {
    id: "synthesis.targets",
    type: "targets",
    method: "with_targets",
    name: "Targets (Regression)",
    description: "Configure continuous target values for regression tasks",
    category: "targets",
    icon: "Target",
    color: {
      border: "border-green-500/30",
      bg: "bg-green-500/10",
      text: "text-green-600 dark:text-green-400",
    },
    mutuallyExclusive: ["classification"],
    parameters: [
      {
        name: "distribution",
        label: "Distribution",
        type: "select",
        default: "dirichlet",
        options: [
          { value: "dirichlet", label: "Dirichlet", description: "Compositional (sum to ~1)" },
          { value: "uniform", label: "Uniform", description: "Independent [0,1] values" },
          { value: "lognormal", label: "Log-normal", description: "Right-skewed distribution" },
          { value: "correlated", label: "Correlated", description: "With specified correlations" },
        ],
        description: "How concentration values are distributed",
      },
      {
        name: "range",
        label: "Target Range",
        type: "range",
        default: [0, 100],
        min: -1000,
        max: 1000,
        description: "Scale target values to this range",
      },
      {
        name: "component",
        label: "Target Component",
        type: "select",
        default: null,
        allowNull: true,
        dynamicOptions: "components",
        description: "Use specific component as target (null = multi-output)",
      },
      {
        name: "transform",
        label: "Transform",
        type: "select",
        default: null,
        allowNull: true,
        options: [
          { value: null, label: "None", description: "No transformation" },
          { value: "log", label: "Log", description: "Logarithmic transform" },
          { value: "sqrt", label: "Square Root", description: "Square root transform" },
        ],
        description: "Apply transformation to target values",
      },
    ],
  },
  {
    id: "synthesis.classification",
    type: "classification",
    method: "with_classification",
    name: "Classification",
    description: "Configure discrete class labels for classification tasks",
    category: "targets",
    icon: "Tags",
    color: {
      border: "border-purple-500/30",
      bg: "bg-purple-500/10",
      text: "text-purple-600 dark:text-purple-400",
    },
    mutuallyExclusive: ["targets"],
    parameters: [
      {
        name: "n_classes",
        label: "Number of Classes",
        type: "int",
        default: 2,
        min: 2,
        max: 20,
        description: "Total number of discrete classes",
      },
      {
        name: "separation",
        label: "Class Separation",
        type: "float",
        default: 1.5,
        min: 0.5,
        max: 3.0,
        step: 0.1,
        description: "Higher values = more distinguishable classes",
      },
      {
        name: "class_weights",
        label: "Class Weights",
        type: "array",
        default: null,
        allowNull: true,
        description: "Optional imbalanced class proportions (e.g., [0.5, 0.3, 0.2])",
      },
      {
        name: "separation_method",
        label: "Separation Method",
        type: "select",
        default: "component",
        options: [
          { value: "component", label: "Component-based", description: "Separate by chemical composition" },
          { value: "threshold", label: "Threshold-based", description: "Threshold on concentration" },
          { value: "cluster", label: "Cluster-based", description: "Cluster-based separation" },
        ],
        description: "Method for creating class boundaries",
      },
    ],
  },

  // === Metadata ===
  {
    id: "synthesis.metadata",
    type: "metadata",
    method: "with_metadata",
    name: "Metadata",
    description: "Configure sample IDs, groups, and repetitions",
    category: "metadata",
    icon: "FileText",
    color: {
      border: "border-orange-500/30",
      bg: "bg-orange-500/10",
      text: "text-orange-600 dark:text-orange-400",
    },
    parameters: [
      {
        name: "sample_ids",
        label: "Generate Sample IDs",
        type: "boolean",
        default: true,
        description: "Generate unique sample identifiers",
      },
      {
        name: "sample_id_prefix",
        label: "Sample ID Prefix",
        type: "string",
        default: "sample",
        description: "Prefix for sample IDs (e.g., 'sample' → sample_001)",
      },
      {
        name: "n_groups",
        label: "Number of Groups",
        type: "int",
        default: null,
        allowNull: true,
        min: 2,
        max: 100,
        description: "For grouped cross-validation",
      },
      {
        name: "n_repetitions",
        label: "Repetitions per Sample",
        type: "int",
        default: 1,
        min: 1,
        max: 10,
        description: "Number of spectral repetitions per sample",
      },
      {
        name: "group_names",
        label: "Group Names",
        type: "array",
        default: null,
        allowNull: true,
        description: "Custom names for groups",
      },
    ],
  },
  {
    id: "synthesis.partitions",
    type: "partitions",
    method: "with_partitions",
    name: "Partitions",
    description: "Configure train/test split",
    category: "metadata",
    icon: "Split",
    color: {
      border: "border-cyan-500/30",
      bg: "bg-cyan-500/10",
      text: "text-cyan-600 dark:text-cyan-400",
    },
    parameters: [
      {
        name: "train_ratio",
        label: "Train Ratio",
        type: "float",
        default: 0.8,
        min: 0.1,
        max: 0.99,
        step: 0.05,
        description: "Proportion of data for training (0.8 = 80% train, 20% test)",
      },
      {
        name: "stratify",
        label: "Stratify",
        type: "boolean",
        default: false,
        description: "Maintain class proportions in splits (for classification)",
      },
      {
        name: "shuffle",
        label: "Shuffle",
        type: "boolean",
        default: true,
        description: "Randomize sample order before splitting",
      },
    ],
  },

  // === Effects ===
  {
    id: "synthesis.batch_effects",
    type: "batch_effects",
    method: "with_batch_effects",
    name: "Batch Effects",
    description: "Simulate batch/session variations in measurements",
    category: "effects",
    icon: "Layers",
    color: {
      border: "border-yellow-500/30",
      bg: "bg-yellow-500/10",
      text: "text-yellow-600 dark:text-yellow-400",
    },
    parameters: [
      {
        name: "enabled",
        label: "Enable Batch Effects",
        type: "boolean",
        default: true,
        description: "Enable batch effect simulation",
      },
      {
        name: "n_batches",
        label: "Number of Batches",
        type: "int",
        default: 3,
        min: 2,
        max: 20,
        description: "Number of simulated measurement sessions",
      },
    ],
  },
  {
    id: "synthesis.sources",
    type: "sources",
    method: "with_sources",
    name: "Multi-Source",
    description: "Configure multiple data sources (NIR + auxiliary data)",
    category: "effects",
    icon: "GitMerge",
    color: {
      border: "border-pink-500/30",
      bg: "bg-pink-500/10",
      text: "text-pink-600 dark:text-pink-400",
    },
    parameters: [
      {
        name: "sources",
        label: "Data Sources",
        type: "array",
        default: [
          { name: "NIR", type: "nir", wavelength_range: [1000, 2500] },
        ],
        description: "Configure multiple data sources with their properties",
      },
    ],
  },

  // === Complexity ===
  {
    id: "synthesis.nonlinear_targets",
    type: "nonlinear_targets",
    method: "with_nonlinear_targets",
    name: "Non-linear Targets",
    description: "Add polynomial or other non-linear interactions to targets",
    category: "complexity",
    icon: "TrendingUp",
    color: {
      border: "border-red-500/30",
      bg: "bg-red-500/10",
      text: "text-red-600 dark:text-red-400",
    },
    requires: ["targets"],
    parameters: [
      {
        name: "interactions",
        label: "Interaction Type",
        type: "select",
        default: "polynomial",
        options: [
          { value: "polynomial", label: "Polynomial", description: "Quadratic and higher-order terms" },
          { value: "synergistic", label: "Synergistic", description: "Positive component interactions" },
          { value: "antagonistic", label: "Antagonistic", description: "Negative component interactions" },
        ],
        description: "Type of non-linear relationship",
      },
      {
        name: "interaction_strength",
        label: "Interaction Strength",
        type: "float",
        default: 0.5,
        min: 0,
        max: 1,
        step: 0.1,
        description: "0 = linear, 1 = fully non-linear",
      },
      {
        name: "hidden_factors",
        label: "Hidden Factors",
        type: "int",
        default: 0,
        min: 0,
        max: 5,
        description: "Latent variables affecting y but not visible in spectra",
      },
      {
        name: "polynomial_degree",
        label: "Polynomial Degree",
        type: "int",
        default: 2,
        min: 2,
        max: 5,
        description: "Maximum polynomial degree for interactions",
      },
    ],
  },
  {
    id: "synthesis.target_complexity",
    type: "target_complexity",
    method: "with_target_complexity",
    name: "Target Complexity",
    description: "Add confounders and partial predictability",
    category: "complexity",
    icon: "Shuffle",
    color: {
      border: "border-indigo-500/30",
      bg: "bg-indigo-500/10",
      text: "text-indigo-600 dark:text-indigo-400",
    },
    requires: ["targets"],
    parameters: [
      {
        name: "signal_to_confound_ratio",
        label: "Signal-to-Confound Ratio",
        type: "float",
        default: 1.0,
        min: 0,
        max: 1,
        step: 0.1,
        description: "1.0 = fully predictable, 0.5 = 50% confounded",
      },
      {
        name: "n_confounders",
        label: "Number of Confounders",
        type: "int",
        default: 0,
        min: 0,
        max: 5,
        description: "Variables affecting both spectra and target differently",
      },
      {
        name: "spectral_masking",
        label: "Spectral Masking",
        type: "float",
        default: 0.0,
        min: 0,
        max: 1,
        step: 0.1,
        description: "Fraction of signal hidden in noisy spectral regions",
      },
      {
        name: "temporal_drift",
        label: "Temporal Drift",
        type: "boolean",
        default: false,
        description: "Target relationship changes over sample order",
      },
    ],
  },
  {
    id: "synthesis.complex_landscape",
    type: "complex_landscape",
    method: "with_complex_target_landscape",
    name: "Complex Landscape",
    description: "Multi-regime target relationships with heteroscedasticity",
    category: "complexity",
    icon: "Mountain",
    color: {
      border: "border-emerald-500/30",
      bg: "bg-emerald-500/10",
      text: "text-emerald-600 dark:text-emerald-400",
    },
    requires: ["targets"],
    parameters: [
      {
        name: "n_regimes",
        label: "Number of Regimes",
        type: "int",
        default: 1,
        min: 1,
        max: 10,
        description: "Number of different relationship subpopulations",
      },
      {
        name: "regime_method",
        label: "Regime Assignment",
        type: "select",
        default: "concentration",
        options: [
          { value: "concentration", label: "Concentration-based", description: "Based on component levels" },
          { value: "spectral", label: "Spectral-based", description: "Based on spectral features" },
          { value: "random", label: "Random", description: "Random assignment" },
        ],
        description: "How samples are assigned to regimes",
      },
      {
        name: "regime_overlap",
        label: "Regime Overlap",
        type: "float",
        default: 0.2,
        min: 0,
        max: 0.5,
        step: 0.05,
        description: "0 = hard boundaries, 0.5 = smooth transitions",
      },
      {
        name: "noise_heteroscedasticity",
        label: "Noise Heteroscedasticity",
        type: "float",
        default: 0.0,
        min: 0,
        max: 1,
        step: 0.1,
        description: "How much noise varies by regime (0 = constant noise)",
      },
    ],
  },

  // === Output ===
  {
    id: "synthesis.output",
    type: "output",
    method: "with_output",
    name: "Output Format",
    description: "Configure output format preferences",
    category: "output",
    icon: "FileOutput",
    color: {
      border: "border-gray-500/30",
      bg: "bg-gray-500/10",
      text: "text-gray-600 dark:text-gray-400",
    },
    parameters: [
      {
        name: "as_dataset",
        label: "Return as Dataset",
        type: "boolean",
        default: true,
        description: "Return SpectroDataset (true) or (X, y) tuple (false)",
      },
      {
        name: "include_metadata",
        label: "Include Metadata",
        type: "boolean",
        default: false,
        description: "Include additional metadata in output",
      },
    ],
  },
];

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
