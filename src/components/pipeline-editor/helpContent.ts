import i18n from "i18next";

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

/** Non-textual part of the help entries; all user-facing text lives in the `pipelineEditor.help.operators.<name>` locale keys. */
interface OperatorHelpSkeleton {
  hasLongDescription?: boolean;
  parameters?: Record<
    string,
    {
      type: string;
      default?: string | number | boolean;
      range?: { min?: number; max?: number };
      options?: string[];
      hasTip?: boolean;
    }
  >;
  examples?: string[];
  tipCount?: number;
  seeAlso?: string[];
  docUrl?: string;
}

/** Built-in operator help content (structure only; text is resolved lazily from the locale files). */
const OPERATOR_HELP: Record<string, OperatorHelpSkeleton> = {
  SNV: {
    hasLongDescription: true,
    tipCount: 3,
    seeAlso: ["MSC", "RobustSNV"],
    docUrl: "https://nirs4all.readthedocs.io/en/latest/operators/snv.html",
  },
  MSC: {
    parameters: {
      reference: {
        type: "choice",
        default: "mean",
        options: ["mean", "first", "median"],
        hasTip: true,
      },
    },
    tipCount: 2,
    seeAlso: ["SNV", "EMSC"],
  },
  SavitzkyGolay: {
    parameters: {
      window_length: {
        type: "int",
        default: 11,
        range: { min: 3, max: 51 },
        hasTip: true,
      },
      polyorder: {
        type: "int",
        default: 2,
        range: { min: 0, max: 5 },
        hasTip: true,
      },
      deriv: {
        type: "int",
        default: 0,
        range: { min: 0, max: 2 },
        hasTip: true,
      },
    },
    examples: [
      "window_length=11, polyorder=2, deriv=1  # Standard 1st derivative",
      "window_length=15, polyorder=3, deriv=0  # Smoothing only",
    ],
    seeAlso: ["FirstDerivative", "SecondDerivative", "Gaussian"],
  },
  PLSRegression: {
    parameters: {
      n_components: {
        type: "int",
        default: 10,
        range: { min: 1, max: 100 },
        hasTip: true,
      },
      max_iter: {
        type: "int",
        default: 500,
        range: { min: 100, max: 10000 },
      },
    },
    tipCount: 3,
    seeAlso: ["OPLS", "IKPLS", "IntervalPLS"],
    docUrl: "https://scikit-learn.org/stable/modules/generated/sklearn.cross_decomposition.PLSRegression.html",
  },
  KFold: {
    parameters: {
      n_splits: {
        type: "int",
        default: 5,
        range: { min: 2, max: 20 },
        hasTip: true,
      },
      shuffle: {
        type: "bool",
        default: true,
        hasTip: true,
      },
    },
    seeAlso: ["StratifiedKFold", "ShuffleSplit", "KennardStoneSplitter"],
  },
  KennardStoneSplitter: {
    hasLongDescription: true,
    parameters: {
      test_size: {
        type: "float",
        default: 0.2,
        range: { min: 0.1, max: 0.5 },
      },
      metric: {
        type: "choice",
        default: "euclidean",
        options: ["euclidean", "mahalanobis"],
      },
    },
    tipCount: 3,
    seeAlso: ["SPXYSplitter", "KFold"],
  },
};

/** Get help for an operator (text resolved in the active language at call time) */
export function getOperatorHelp(name: string): OperatorHelp | null {
  const skeleton = OPERATOR_HELP[name];
  if (!skeleton) return null;
  const base = `pipelineEditor.help.operators.${name}`;
  const t = (key: string): string => i18n.t(`${base}.${key}`);

  const help: OperatorHelp = {
    name,
    displayName: t("displayName"),
    category: t("category"),
    description: t("description"),
    examples: skeleton.examples,
    seeAlso: skeleton.seeAlso,
    docUrl: skeleton.docUrl,
  };
  if (skeleton.hasLongDescription) help.longDescription = t("longDescription");
  if (skeleton.tipCount) {
    help.tips = Array.from({ length: skeleton.tipCount }, (_, i) => t(`tips.${i}`));
  }
  if (skeleton.parameters) {
    help.parameters = Object.fromEntries(
      Object.entries(skeleton.parameters).map(([paramName, param]) => {
        const { hasTip, ...rest } = param;
        return [
          paramName,
          {
            ...rest,
            description: t(`parameters.${paramName}.description`),
            ...(hasTip ? { tip: t(`parameters.${paramName}.tip`) } : {}),
          },
        ];
      })
    );
  }
  return help;
}
