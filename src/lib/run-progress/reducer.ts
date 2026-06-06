// Pure reducer that folds a WebSocket message into the RunProgress granular +
// refit state. This replaces the stacked if-blocks that previously lived in the
// page's handleWsUpdate. Side effects (toast, query invalidation) stay in the
// page; this reducer only computes the next state.

import {
  initialGranularProgress,
  initialRefitState,
  type GranularProgress,
  type RefitState,
  type WsMessage,
} from "./types";

export interface RunProgressState {
  granular: GranularProgress;
  refit: RefitState;
}

export const initialRunProgressState: RunProgressState = {
  granular: initialGranularProgress,
  refit: initialRefitState,
};

// Reset action used when the page switches to a different run. Distinguished
// from a WsMessage by the absence of a `channel` field.
export interface RunProgressReset {
  type: "reset";
}

export type RunProgressAction = WsMessage | RunProgressReset;

function isReset(action: RunProgressAction): action is RunProgressReset {
  return action.type === "reset" && !("channel" in action);
}

/**
 * Fold a single WebSocket message into the run-progress state.
 *
 * Mirrors the original handleWsUpdate exactly: the fold/branch/variant blocks,
 * the log_context block, and the refit blocks each apply independently and in
 * this order, so a message carrying both a typed event and a log_context still
 * updates both. Field fallbacks (`?? prev`, `|| prev`) are preserved verbatim.
 *
 * The `{ type: "reset" }` action restores the initial state (used when the page
 * switches to a different run).
 */
export function runProgressReducer(state: RunProgressState, action: RunProgressAction): RunProgressState {
  if (isReset(action)) {
    return initialRunProgressState;
  }

  const message = action;
  let granular = state.granular;
  let refit = state.refit;
  const { type, data } = message;

  // Handle granular progress messages
  if (type === "fold_started" || type === "fold_completed") {
    granular = {
      ...granular,
      currentFold: data.current_fold ?? granular.currentFold,
      totalFolds: data.total_folds ?? granular.totalFolds,
    };
  }

  if (type === "branch_entered" || type === "branch_exited") {
    granular = {
      ...granular,
      currentBranch: type === "branch_entered" ? data.branch_name ?? null : null,
    };
  }

  if (type === "variant_started" || type === "variant_completed") {
    granular = {
      ...granular,
      currentVariant: data.current_variant ?? granular.currentVariant,
      totalVariants: data.total_variants ?? granular.totalVariants,
      variantDescription: data.variant_description ?? granular.variantDescription,
    };
  }

  // Also extract from log_context if present
  if (data?.log_context) {
    const ctx = data.log_context;
    granular = {
      ...granular,
      currentFold: ctx.fold_id ?? granular.currentFold,
      totalFolds: ctx.total_folds ?? granular.totalFolds,
      currentBranch: ctx.branch_name ?? granular.currentBranch,
      currentVariant: ctx.variant_index ?? granular.currentVariant,
      totalVariants: ctx.total_variants ?? granular.totalVariants,
    };
  }

  // Handle refit phase messages
  if (type === "refit_started") {
    refit = {
      status: "running",
      progress: 0,
      message: data.description || "Refitting best model on all training data...",
      currentStep: 0,
      totalSteps: data.total_steps ?? 0,
      stepName: "",
      stepType: "",
      score: null,
      metrics: {},
      error: null,
    };
  }

  if (type === "refit_progress") {
    refit = {
      ...refit,
      progress: data.progress ?? refit.progress,
      message: data.message || refit.message,
    };
  }

  if (type === "refit_step") {
    refit = {
      ...refit,
      currentStep: data.current_step ?? refit.currentStep,
      totalSteps: data.total_steps ?? refit.totalSteps,
      stepName: data.step_name || refit.stepName,
      stepType: data.step_type || refit.stepType,
    };
  }

  if (type === "refit_completed") {
    refit = {
      ...refit,
      status: "completed",
      progress: 100,
      message: "Refit complete",
      score: data.score ?? null,
      metrics: (data.metrics as Record<string, number>) ?? refit.metrics,
    };
  }

  if (type === "refit_failed") {
    refit = {
      ...refit,
      status: "failed",
      error: data.error || "Refit failed",
    };
  }

  if (granular === state.granular && refit === state.refit) {
    return state;
  }

  return { granular, refit };
}
