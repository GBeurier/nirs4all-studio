import type { FinetuneConfig } from "../types";

/**
 * Default finetuning configuration.
 */
export const defaultFinetuneConfig: FinetuneConfig = {
  enabled: false,
  n_trials: 50,
  timeout: undefined,
  approach: "grouped",
  eval_mode: "best",
  model_params: [],
};
