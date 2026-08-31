import { describe, expect, it } from "vitest";

import {
  createTuningSummaryCard,
  createTuningSummaryTrialRows,
  createTuningStudySummary,
  createTuningTrialRows,
  getTuningTrialTone,
  isTuningSummaryArtifact,
  isTuningResultArtifact,
  normalizeTuningTrialStatus,
  parseTuningSummaryArtifact,
  parseTuningResultArtifact,
  TUNING_SUMMARY_FORMAT,
} from "./result.js";

const tuningResult = {
  best_params: { "model.n_components": 2 },
  best_value: 0.12,
  fingerprint: "abc123",
  optimizer: "optuna",
  trials: [
    {
      diagnostics: { metric: "rmse", score_family: "conformal" },
      number: 1,
      params: { "model.n_components": 2 },
      state: "COMPLETE",
      value: 0.12,
    },
    {
      diagnostics: { metric: "rmse" },
      number: 0,
      params: { "model.n_components": 3 },
      state: "PRUNED",
      value: null,
    },
  ],
  tuning: {
    direction: "minimize",
    engine: "optuna",
    metric: "rmse",
    n_trials: 2,
    pruner: "median",
    resume: false,
    sampler: "tpe",
    seed: 42,
    space: { "model.n_components": [2, 3] },
    storage: null,
    study_name: "pls-native",
  },
};

const tuningSummary = {
  best_params: { "model.n_components": 2 },
  best_value: 0.12,
  direction: "minimize",
  engine: "optuna",
  fingerprint: "abc123",
  format: "nirs4all.tuning.summary",
  metric: "rmse",
  n_trials: 3,
  optimizer: "optuna",
  persistence: {
    optimizer_state_resume_supported: true,
    resume: true,
    storage_configured: true,
    study_name: "pls-native",
  },
  pruner: "median",
  sampler: "grid",
  schema_version: 1,
  seed: 42,
  trial_states: { COMPLETE: 1, PRUNED: 1, "vendor-custom": 1 },
  trials: [
    { number: 1, state: "COMPLETE", value: 0.12, diagnostics: { score_family: "objective" } },
    { number: 0, state: "PRUNED", value: null, diagnostics: { error_type: "TrialPruned" } },
    { number: 2, state: "vendor-custom", value: 0.14 },
  ],
  version: 1,
};

describe("tuning result view-model helpers", () => {
  it("validates the public Python TuningResult.to_dict payload shape", () => {
    expect(isTuningResultArtifact(tuningResult)).toBe(true);
    expect(parseTuningResultArtifact(tuningResult).fingerprint).toBe("abc123");
    expect(() => parseTuningResultArtifact({ ...tuningResult, trials: [{ number: 0 }] })).toThrow(
      "Expected a nirs4all TuningResult.to_dict() payload.",
    );
  });

  it("validates lightweight TuningResult.summary_artifact payloads", () => {
    expect(TUNING_SUMMARY_FORMAT).toBe("nirs4all.tuning.summary");
    expect(isTuningSummaryArtifact(tuningSummary)).toBe(true);
    expect(parseTuningSummaryArtifact(tuningSummary).fingerprint).toBe("abc123");
    expect(() => parseTuningSummaryArtifact({ ...tuningSummary, format: "nirs4all.tuning.full" })).toThrow(
      "Expected a nirs4all.tuning.summary payload.",
    );
  });

  it("summarizes study-level tuning evidence without selecting a new winner", () => {
    const summary = createTuningStudySummary(parseTuningResultArtifact(tuningResult));

    expect(summary).toMatchObject({
      bestParams: { "model.n_components": 2 },
      bestValue: 0.12,
      completeTrials: 1,
      direction: "minimize",
      failedTrials: 0,
      fingerprint: "abc123",
      metric: "rmse",
      nTrials: 2,
      optimizer: "optuna",
      pruner: "median",
      prunedTrials: 1,
      runningTrials: 0,
      sampler: "tpe",
      searchSpaceSize: 1,
      seed: 42,
      studyName: "pls-native",
    });
    expect(summary.bestValueLabel).toContain("0.12");
  });

  it("projects trial rows with stable status, tone, labels and best flag", () => {
    const rows = createTuningTrialRows(parseTuningResultArtifact(tuningResult));

    expect(rows.map((row) => row.number)).toEqual([0, 1]);
    expect(rows[0]).toMatchObject({
      isBest: false,
      paramsLabel: "model.n_components=3",
      status: "pruned",
      statusLabel: "Pruned",
      tone: "warning",
      valueLabel: "—",
    });
    expect(rows[1]).toMatchObject({
      diagnostics: { metric: "rmse", score_family: "conformal" },
      isBest: true,
      paramsLabel: "model.n_components=2",
      status: "complete",
      statusLabel: "Complete",
      tone: "success",
    });
    expect(rows[1]?.valueLabel).toContain("0.12");
  });

  it("projects lightweight tuning summary cards without full optimizer tapes", () => {
    const artifact = parseTuningSummaryArtifact(tuningSummary);
    const card = createTuningSummaryCard(artifact);
    const rows = createTuningSummaryTrialRows(artifact);

    expect(card).toMatchObject({
      bestParams: { "model.n_components": 2 },
      bestValue: 0.12,
      completeTrials: 1,
      direction: "minimize",
      engine: "optuna",
      failedTrials: 0,
      fingerprint: "abc123",
      metric: "rmse",
      nTrials: 3,
      optimizerStateResumeSupported: true,
      optimizer: "optuna",
      persistence: {
        optimizer_state_resume_supported: true,
        resume: true,
        storage_configured: true,
        study_name: "pls-native",
      },
      pruner: "median",
      prunedTrials: 1,
      resume: true,
      runningTrials: 0,
      sampler: "grid",
      seed: 42,
      storageConfigured: true,
      studyName: "pls-native",
      unknownTrials: 1,
    });
    expect(card.bestValueLabel).toContain("0.12");
    expect(rows.map((row) => row.number)).toEqual([0, 1, 2]);
    expect(rows[0]).toMatchObject({ diagnostics: { error_type: "TrialPruned" }, status: "pruned", tone: "warning", valueLabel: "—" });
    expect(rows[1]).toMatchObject({ diagnostics: { score_family: "objective" }, status: "complete", tone: "success" });
    expect(rows[2]).toMatchObject({ diagnostics: {}, status: "unknown", tone: "muted" });
  });

  it("keeps lightweight tuning summaries backward-compatible when optimizer controls are absent", () => {
    const legacySummary: Record<string, unknown> = { ...tuningSummary };
    delete legacySummary.pruner;
    delete legacySummary.sampler;
    delete legacySummary.seed;
    delete legacySummary.persistence;

    const artifact = parseTuningSummaryArtifact(legacySummary);
    const card = createTuningSummaryCard(artifact);

    expect(card).toMatchObject({
      optimizerStateResumeSupported: null,
      persistence: null,
      pruner: null,
      resume: null,
      sampler: null,
      seed: null,
      storageConfigured: null,
      studyName: null,
    });
  });

  it("normalizes optimizer state names for UI consumers", () => {
    expect(normalizeTuningTrialStatus("COMPLETE")).toBe("complete");
    expect(normalizeTuningTrialStatus("FAILED")).toBe("failed");
    expect(normalizeTuningTrialStatus("RUNNING")).toBe("running");
    expect(normalizeTuningTrialStatus("WAITING")).toBe("waiting");
    expect(normalizeTuningTrialStatus("unknown-custom")).toBe("unknown");
    expect(getTuningTrialTone("failed")).toBe("error");
  });
});
