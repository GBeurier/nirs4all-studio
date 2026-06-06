import { describe, expect, it } from "vitest";

import {
  initialRunProgressState,
  runProgressReducer,
  type RunProgressState,
} from "./reducer";
import type { WsMessage } from "./types";

function msg(type: string, data: WsMessage["data"] = {}): WsMessage {
  return { type, channel: "job:run-1", data, timestamp: "2026-06-06T00:00:00Z" };
}

describe("runProgressReducer", () => {
  it("returns the same state reference for an unhandled message type", () => {
    const next = runProgressReducer(initialRunProgressState, msg("job_progress", { progress: 50 }));
    expect(next).toBe(initialRunProgressState);
  });

  it("ignores typed events with no relevant payload but still keeps identity when nothing changed", () => {
    const next = runProgressReducer(initialRunProgressState, msg("job_completed"));
    expect(next).toBe(initialRunProgressState);
  });

  describe("reset action", () => {
    it("restores the initial state", () => {
      const dirty: RunProgressState = {
        granular: { ...initialRunProgressState.granular, currentFold: 3, totalFolds: 5 },
        refit: { ...initialRunProgressState.refit, status: "running", progress: 42 },
      };
      const next = runProgressReducer(dirty, { type: "reset" });
      expect(next).toBe(initialRunProgressState);
    });
  });

  describe("fold messages", () => {
    it("sets currentFold/totalFolds on fold_started", () => {
      const next = runProgressReducer(
        initialRunProgressState,
        msg("fold_started", { current_fold: 2, total_folds: 5 })
      );
      expect(next.granular.currentFold).toBe(2);
      expect(next.granular.totalFolds).toBe(5);
    });

    it("updates folds on fold_completed", () => {
      const next = runProgressReducer(
        initialRunProgressState,
        msg("fold_completed", { current_fold: 4, total_folds: 5 })
      );
      expect(next.granular.currentFold).toBe(4);
      expect(next.granular.totalFolds).toBe(5);
    });

    it("falls back to previous fold values when fields are missing (?? prev)", () => {
      const seeded = runProgressReducer(
        initialRunProgressState,
        msg("fold_started", { current_fold: 1, total_folds: 5 })
      );
      const next = runProgressReducer(seeded, msg("fold_started", {}));
      expect(next.granular.currentFold).toBe(1);
      expect(next.granular.totalFolds).toBe(5);
    });

    it("treats current_fold 0 as a real value, not a fallback", () => {
      const seeded = runProgressReducer(
        initialRunProgressState,
        msg("fold_started", { current_fold: 3, total_folds: 5 })
      );
      const next = runProgressReducer(seeded, msg("fold_started", { current_fold: 0 }));
      expect(next.granular.currentFold).toBe(0);
    });
  });

  describe("branch messages", () => {
    it("sets currentBranch on branch_entered", () => {
      const next = runProgressReducer(
        initialRunProgressState,
        msg("branch_entered", { branch_name: "SNV -> PLS" })
      );
      expect(next.granular.currentBranch).toBe("SNV -> PLS");
    });

    it("uses null when branch_entered carries no branch_name", () => {
      const next = runProgressReducer(initialRunProgressState, msg("branch_entered", {}));
      expect(next.granular.currentBranch).toBeNull();
    });

    it("clears currentBranch on branch_exited", () => {
      const entered = runProgressReducer(
        initialRunProgressState,
        msg("branch_entered", { branch_name: "branch-A" })
      );
      const exited = runProgressReducer(entered, msg("branch_exited", { branch_name: "branch-A" }));
      expect(exited.granular.currentBranch).toBeNull();
    });
  });

  describe("variant messages", () => {
    it("sets variant fields on variant_started", () => {
      const next = runProgressReducer(
        initialRunProgressState,
        msg("variant_started", {
          current_variant: 2,
          total_variants: 6,
          variant_description: "alpha=0.1",
        })
      );
      expect(next.granular.currentVariant).toBe(2);
      expect(next.granular.totalVariants).toBe(6);
      expect(next.granular.variantDescription).toBe("alpha=0.1");
    });

    it("updates variant fields on variant_completed with fallbacks", () => {
      const seeded = runProgressReducer(
        initialRunProgressState,
        msg("variant_started", { current_variant: 1, total_variants: 6, variant_description: "v1" })
      );
      const next = runProgressReducer(seeded, msg("variant_completed", { current_variant: 2 }));
      expect(next.granular.currentVariant).toBe(2);
      expect(next.granular.totalVariants).toBe(6);
      expect(next.granular.variantDescription).toBe("v1");
    });
  });

  describe("log_context extraction", () => {
    it("extracts granular fields from log_context on any message type", () => {
      const next = runProgressReducer(
        initialRunProgressState,
        msg("job_progress", {
          log_context: {
            fold_id: 3,
            total_folds: 7,
            branch_name: "ctx-branch",
            variant_index: 4,
            total_variants: 9,
          },
        })
      );
      expect(next.granular.currentFold).toBe(3);
      expect(next.granular.totalFolds).toBe(7);
      expect(next.granular.currentBranch).toBe("ctx-branch");
      expect(next.granular.currentVariant).toBe(4);
      expect(next.granular.totalVariants).toBe(9);
    });

    it("falls back to previous granular values for missing log_context fields", () => {
      const seeded = runProgressReducer(
        initialRunProgressState,
        msg("fold_started", { current_fold: 1, total_folds: 5 })
      );
      const next = runProgressReducer(seeded, msg("job_progress", { log_context: { branch_name: "b" } }));
      expect(next.granular.currentFold).toBe(1);
      expect(next.granular.totalFolds).toBe(5);
      expect(next.granular.currentBranch).toBe("b");
    });

    it("applies the typed event AND the log_context in the same message (log_context wins, applied last)", () => {
      // fold_completed sets fold 2/5; log_context then overrides fold to 3/7.
      const next = runProgressReducer(
        initialRunProgressState,
        msg("fold_completed", {
          current_fold: 2,
          total_folds: 5,
          log_context: { fold_id: 3, total_folds: 7 },
        })
      );
      expect(next.granular.currentFold).toBe(3);
      expect(next.granular.totalFolds).toBe(7);
    });
  });

  describe("refit messages", () => {
    it("starts the refit phase with description and total_steps", () => {
      const next = runProgressReducer(
        initialRunProgressState,
        msg("refit_started", { description: "Refitting...", total_steps: 4 })
      );
      expect(next.refit.status).toBe("running");
      expect(next.refit.progress).toBe(0);
      expect(next.refit.message).toBe("Refitting...");
      expect(next.refit.totalSteps).toBe(4);
    });

    it("defaults the refit_started message and total_steps when absent", () => {
      const next = runProgressReducer(initialRunProgressState, msg("refit_started", {}));
      expect(next.refit.message).toBe("Refitting best model on all training data...");
      expect(next.refit.totalSteps).toBe(0);
    });

    it("updates progress and message on refit_progress with fallbacks", () => {
      const started = runProgressReducer(
        initialRunProgressState,
        msg("refit_started", { description: "start", total_steps: 4 })
      );
      const next = runProgressReducer(started, msg("refit_progress", { progress: 60 }));
      expect(next.refit.progress).toBe(60);
      expect(next.refit.message).toBe("start");
    });

    it("updates step fields on refit_step with fallbacks", () => {
      const started = runProgressReducer(
        initialRunProgressState,
        msg("refit_started", { total_steps: 4 })
      );
      const next = runProgressReducer(
        started,
        msg("refit_step", { current_step: 2, step_name: "scale", step_type: "transform" })
      );
      expect(next.refit.currentStep).toBe(2);
      expect(next.refit.totalSteps).toBe(4);
      expect(next.refit.stepName).toBe("scale");
      expect(next.refit.stepType).toBe("transform");
    });

    it("completes the refit phase with score and metrics", () => {
      const started = runProgressReducer(
        initialRunProgressState,
        msg("refit_started", { total_steps: 4 })
      );
      const next = runProgressReducer(
        started,
        msg("refit_completed", { score: 0.93, metrics: { rmse: 0.12 } })
      );
      expect(next.refit.status).toBe("completed");
      expect(next.refit.progress).toBe(100);
      expect(next.refit.message).toBe("Refit complete");
      expect(next.refit.score).toBe(0.93);
      expect(next.refit.metrics).toEqual({ rmse: 0.12 });
    });

    it("keeps prior metrics when refit_completed omits them", () => {
      const started = runProgressReducer(initialRunProgressState, msg("refit_started", {}));
      const next = runProgressReducer(started, msg("refit_completed", { score: 0.5 }));
      expect(next.refit.metrics).toEqual({});
      expect(next.refit.score).toBe(0.5);
    });

    it("sets score to null when refit_completed omits score", () => {
      const started = runProgressReducer(initialRunProgressState, msg("refit_started", {}));
      const next = runProgressReducer(started, msg("refit_completed", {}));
      expect(next.refit.score).toBeNull();
    });

    it("marks the refit phase failed with an error message", () => {
      const started = runProgressReducer(initialRunProgressState, msg("refit_started", {}));
      const next = runProgressReducer(started, msg("refit_failed", { error: "boom" }));
      expect(next.refit.status).toBe("failed");
      expect(next.refit.error).toBe("boom");
    });

    it("defaults the refit_failed error message", () => {
      const started = runProgressReducer(initialRunProgressState, msg("refit_started", {}));
      const next = runProgressReducer(started, msg("refit_failed", {}));
      expect(next.refit.error).toBe("Refit failed");
    });
  });

  it("does not mutate the previous state object", () => {
    const before = JSON.stringify(initialRunProgressState);
    runProgressReducer(initialRunProgressState, msg("fold_started", { current_fold: 1, total_folds: 5 }));
    expect(JSON.stringify(initialRunProgressState)).toBe(before);
  });
});
