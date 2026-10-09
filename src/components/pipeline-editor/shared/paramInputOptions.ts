import i18n from "i18next";

/** Parameter keys that have a localized help text (`pipelineEditor.shared.paramInfo.<key>`). */
const PARAMETER_INFO_KEYS = [
  "n_components",
  "n_estimators",
  "max_depth",
  "learning_rate",
  "test_size",
  "n_splits",
  "random_state",
  "window_length",
  "window",
  "window_size",
  "polyorder",
  "deriv",
  "sigma",
  "order",
  "lam",
  "p",
  "C",
  "epsilon",
  "kernel",
  "gamma",
  "alpha",
  "l1_ratio",
  "shuffle",
  "n_repeats",
] as const;

// Parameter info/tooltips for common parameters (resolved in the active language when read)
export const parameterInfo: Record<string, string> = {};
for (const key of PARAMETER_INFO_KEYS) {
  Object.defineProperty(parameterInfo, key, {
    enumerable: true,
    get: () => i18n.t(`pipelineEditor.shared.paramInfo.${key}`),
  });
}

type SelectOption = { value: string; label: string };

/** Build options whose label is resolved in the active language when read. */
function localizedOptions(group: string, values: string[]): SelectOption[] {
  return values.map((value) => ({
    value,
    get label() {
      return i18n.t(`pipelineEditor.shared.selectOptions.${group}.${value}`);
    },
  }));
}

// Select options for known parameter types
export const selectOptions: Record<string, SelectOption[]> = {
  kernel: localizedOptions("kernel", ["rbf", "linear", "poly", "sigmoid"]),
  norm: localizedOptions("norm", ["l1", "l2", "max"]),
  activation: localizedOptions("activation", ["relu", "tanh", "sigmoid", "leaky_relu"]),
  reference: localizedOptions("reference", ["mean", "first", "median"]),
};

// Keys that should render as select inputs
export const selectParamKeys = new Set(Object.keys(selectOptions));
