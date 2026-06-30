export interface OperatorHelp {
  name: string;
  displayName: string;
  category: string;
  description: string;
  longDescription?: string;
  parameters?: Record<
    string,
    {
      description: string;
      type: string;
      default?: string | number | boolean;
      range?: { min?: number; max?: number };
      options?: string[];
      tip?: string;
    }
  >;
  examples?: string[];
  tips?: string[];
  seeAlso?: string[];
  docUrl?: string;
}

/** Built-in operator help content */
const OPERATOR_HELP: Record<string, OperatorHelp> = {
  SNV: {
    name: "SNV",
    displayName: "Standard Normal Variate",
    category: "Scatter Correction",
    description: "Removes multiplicative scatter effects by centering and scaling each spectrum.",
    longDescription:
      "SNV is a row-wise operation that normalizes each spectrum independently. It subtracts the mean and divides by the standard deviation of each spectrum. This is particularly effective for removing physical effects like particle size variation.",
    tips: [
      "Best used as an early preprocessing step",
      "Works well before derivative operations",
      "Consider MSC as an alternative if you have a reference spectrum",
    ],
    seeAlso: ["MSC", "RobustSNV"],
    docUrl: "https://nirs4all.readthedocs.io/en/latest/operators/snv.html",
  },
  MSC: {
    name: "MSC",
    displayName: "Multiplicative Scatter Correction",
    category: "Scatter Correction",
    description: "Corrects for scatter using a reference spectrum (typically the mean).",
    parameters: {
      reference: {
        description: "Method to compute the reference spectrum",
        type: "choice",
        default: "mean",
        options: ["mean", "first", "median"],
        tip: "Use 'mean' for most cases. 'median' is more robust to outliers.",
      },
    },
    tips: [
      "Use when you have consistent baseline shifts",
      "The mean reference works well for homogeneous sample sets",
    ],
    seeAlso: ["SNV", "EMSC"],
  },
  SavitzkyGolay: {
    name: "SavitzkyGolay",
    displayName: "Savitzky-Golay Filter",
    category: "Smoothing / Derivatives",
    description: "Polynomial smoothing filter that can also compute derivatives.",
    parameters: {
      window_length: {
        description: "Size of the smoothing window (must be odd)",
        type: "int",
        default: 11,
        range: { min: 3, max: 51 },
        tip: "Larger windows = more smoothing. Use odd numbers only.",
      },
      polyorder: {
        description: "Order of the polynomial used in the fit",
        type: "int",
        default: 2,
        range: { min: 0, max: 5 },
        tip: "Should be less than window_length. 2-3 is typical.",
      },
      deriv: {
        description: "Order of derivative to compute (0 = smoothing only)",
        type: "int",
        default: 0,
        range: { min: 0, max: 2 },
        tip: "1st derivative enhances peaks, 2nd derivative enhances edges.",
      },
    },
    examples: [
      "window_length=11, polyorder=2, deriv=1  # Standard 1st derivative",
      "window_length=15, polyorder=3, deriv=0  # Smoothing only",
    ],
    seeAlso: ["FirstDerivative", "SecondDerivative", "Gaussian"],
  },
  PLSRegression: {
    name: "PLSRegression",
    displayName: "Partial Least Squares Regression",
    category: "Model",
    description: "Projects X and Y to latent variables to maximize covariance.",
    parameters: {
      n_components: {
        description: "Number of latent variables (components) to extract",
        type: "int",
        default: 10,
        range: { min: 1, max: 100 },
        tip: "Start with 10-15 and tune based on cross-validation results.",
      },
      max_iter: {
        description: "Maximum number of iterations for the algorithm",
        type: "int",
        default: 500,
        range: { min: 100, max: 10000 },
      },
    },
    tips: [
      "The most common model for NIRS data",
      "Use cross-validation to find optimal n_components",
      "Consider OPLS for data with strong orthogonal variation",
    ],
    seeAlso: ["OPLS", "IKPLS", "IntervalPLS"],
    docUrl: "https://scikit-learn.org/stable/modules/generated/sklearn.cross_decomposition.PLSRegression.html",
  },
  KFold: {
    name: "KFold",
    displayName: "K-Fold Cross-Validation",
    category: "Splitting",
    description: "Splits data into K consecutive folds for cross-validation.",
    parameters: {
      n_splits: {
        description: "Number of folds",
        type: "int",
        default: 5,
        range: { min: 2, max: 20 },
        tip: "5-10 folds is standard. More folds = more computation but better estimates.",
      },
      shuffle: {
        description: "Whether to shuffle the data before splitting",
        type: "bool",
        default: true,
        tip: "Enable for random data, disable for time-series data.",
      },
    },
    seeAlso: ["StratifiedKFold", "ShuffleSplit", "KennardStoneSplitter"],
  },
  KennardStoneSplitter: {
    name: "KennardStoneSplitter",
    displayName: "Kennard-Stone Splitter",
    category: "Splitting",
    description: "Selects samples to uniformly cover the feature space.",
    longDescription:
      "The Kennard-Stone algorithm iteratively selects samples that are maximally distant from already-selected samples. This ensures good coverage of the feature space in both training and test sets.",
    parameters: {
      test_size: {
        description: "Proportion of samples to include in the test set",
        type: "float",
        default: 0.2,
        range: { min: 0.1, max: 0.5 },
      },
      metric: {
        description: "Distance metric to use",
        type: "choice",
        default: "euclidean",
        options: ["euclidean", "mahalanobis"],
      },
    },
    tips: [
      "Excellent for ensuring representative test sets",
      "Works well with small datasets",
      "Pairs well with PLS models",
    ],
    seeAlso: ["SPXYSplitter", "KFold"],
  },
};

/** Get help for an operator */
export function getOperatorHelp(name: string): OperatorHelp | null {
  return OPERATOR_HELP[name] || null;
}
