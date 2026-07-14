/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import type { KeywordRegistryDocument } from "@/ui/keywordRegistry";
import type { FinetuneConfig } from "../../types";
import {
  buildNativeTuningEditorSummary,
  buildNativeTuningKeywordRows,
  FinetuneNativeContractCard,
} from "../FinetuneNativeContractCard";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let mountedContainers: HTMLDivElement[] = [];

async function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  mountedContainers.push(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(node);
  });

  return { container, root };
}

afterEach(() => {
  for (const container of mountedContainers) {
    container.remove();
  }
  mountedContainers = [];
});

function finetuneConfig(overrides: Partial<FinetuneConfig> = {}): FinetuneConfig {
  return {
    approach: "grouped",
    enabled: true,
    eval_mode: "best",
    model_params: [{
      high: 30,
      low: 1,
      name: "n_components",
      step: 1,
      type: "int",
    }],
    n_trials: 50,
    ...overrides,
  };
}

function registry(): KeywordRegistryDocument {
  return {
    entries: [
      {
        aliases: [],
        canonical_term: "native_tuning",
        changes: ["tuning_result"],
        docs_anchor: "native-tuning",
        engine_support: { "dag-ml": "partial", legacy: "unsupported" },
        id: "run.tuning",
        invalidates_calibration: "if_predictor_changes",
        lifecycle_stage: "tuning",
        path: "run.tuning",
        reads: ["pipeline", "score_data"],
        scope: "pipeline_execution",
        status: "partial",
        summary: "Runs native optimizer selection before final calibration.",
        surface: "run_argument",
        token: "tuning",
        ui: { control: "object", group: "tuning", label: "Native tuning", order: 100 },
        value_schema: { type: "object" },
      },
      {
        aliases: [],
        canonical_term: "native_tuning_space",
        changes: ["trial_candidates"],
        docs_anchor: "native-tuning-space",
        engine_support: { "dag-ml": "partial", legacy: "unsupported" },
        id: "run.tuning.space",
        invalidates_calibration: "if_predictor_changes",
        lifecycle_stage: "tuning",
        path: "run.tuning.space",
        reads: ["development"],
        scope: "pipeline_execution",
        status: "partial",
        summary: "Mapping/object search space consumed by the native optimizer.",
        surface: "nested_key",
        token: "space",
        ui: { control: "object", group: "tuning", label: "Search space", order: 110 },
        value_schema: { type: "object" },
      },
      {
        aliases: [],
        canonical_term: "native_tuning_force_params",
        changes: ["trial_sequence", "candidate_fit", "selection"],
        docs_anchor: "native-tuning-force-params",
        engine_support: { "dag-ml": "partial", legacy: "unsupported" },
        id: "run.tuning.force_params",
        invalidates_calibration: "if_predictor_changes",
        lifecycle_stage: "tuning",
        path: "run.tuning.force_params",
        reads: ["development", "run.tuning.space"],
        scope: "pipeline_execution",
        status: "partial",
        summary: "Warm-starts the first optimizer trial with public decoded parameter values.",
        surface: "nested_key",
        token: "force_params",
        ui: { control: "object", group: "tuning", label: "Forced first trial", order: 115 },
        value_schema: { type: "object" },
      },
      {
        aliases: [],
        canonical_term: "tuning_score_data",
        changes: ["objective_scores"],
        docs_anchor: "score-data",
        engine_support: { "dag-ml": "partial", legacy: "unsupported" },
        id: "run.tuning.score_data",
        invalidates_calibration: "not_applicable",
        lifecycle_stage: "tuning",
        path: "run.tuning.score_data",
        reads: ["score_data"],
        scope: "pipeline_execution",
        status: "partial",
        summary: "Explicit scoring cohort used by the optimizer objective.",
        surface: "run_argument",
        token: "score_data",
        ui: { control: "object", group: "tuning", label: "Score data", order: 130 },
        value_schema: { type: "object" },
      },
      {
        aliases: [],
        canonical_term: "optimizer_storage_uri",
        changes: ["optimizer_state"],
        docs_anchor: "planned-full-dag-tuning",
        engine_support: { "dag-ml": "partial", n4m: "unsupported", optuna: "supported" },
        id: "run.tuning.storage",
        invalidates_calibration: "not_applicable",
        lifecycle_stage: "storage",
        path: "run.tuning.storage",
        reads: ["optimizer_state"],
        scope: "optimizer_persistence",
        status: "partial",
        summary: "Optuna optimizer-state storage URI.",
        surface: "nested_key",
        token: "storage",
        ui: { control: "text", group: "tuning", label: "Optuna storage URI", order: 254 },
        value_schema: { minLength: 1, pattern: "^[A-Za-z][A-Za-z0-9+.-]*://", type: "string" },
      },
      {
        aliases: [],
        canonical_term: "optimizer_study_name",
        changes: ["optimizer_state"],
        docs_anchor: "planned-full-dag-tuning",
        engine_support: { "dag-ml": "partial", n4m: "unsupported", optuna: "supported" },
        id: "run.tuning.study_name",
        invalidates_calibration: "not_applicable",
        lifecycle_stage: "storage",
        path: "run.tuning.study_name",
        reads: ["optimizer_state"],
        scope: "optimizer_persistence",
        status: "partial",
        summary: "Optuna study name used with storage-backed studies.",
        surface: "nested_key",
        token: "study_name",
        ui: { control: "text", group: "tuning", label: "Optuna study name", order: 255 },
        value_schema: { minLength: 1, pattern: "^[^\\u0000]+$", type: "string" },
      },
    ],
    registry_version: "1.0.0",
    schema_id: "https://nirs4all.org/schemas/keyword-effects/v1",
    schema_version: 1,
    scope: "lifecycle-v1",
  };
}

describe("FinetuneNativeContractCard", () => {
  it("builds fallback keyword rows when no registry is attached", () => {
    expect(buildNativeTuningKeywordRows().map((row) => row.path)).toEqual([
      "run.tuning",
      "run.tuning.space",
      "run.tuning.force_params",
      "run.tuning.n_trials",
      "run.tuning.score_data",
      "run.tuning.calibration",
      "run.tuning.storage",
      "run.tuning.study_name",
    ]);
    expect(buildNativeTuningKeywordRows()[0]).toMatchObject({
      source: "fallback",
      status: "partial",
    });
  });

  it("projects registry-backed keyword rows without inventing unsupported fields", () => {
    expect(buildNativeTuningKeywordRows(registry())).toEqual([
      expect.objectContaining({
        label: "Native tuning",
        path: "run.tuning",
        source: "registry",
        summary: "Runs native optimizer selection before final calibration.",
      }),
      expect.objectContaining({
        label: "Search space",
        path: "run.tuning.space",
        source: "registry",
        summary: "Mapping/object search space consumed by the native optimizer.",
      }),
      expect.objectContaining({
        label: "Forced first trial",
        path: "run.tuning.force_params",
        source: "registry",
        summary: "Warm-starts the first optimizer trial with public decoded parameter values.",
      }),
      expect.objectContaining({
        label: "Score data",
        path: "run.tuning.score_data",
        source: "registry",
      }),
      expect.objectContaining({
        label: "Optuna storage URI",
        path: "run.tuning.storage",
        source: "registry",
        summary: "Optuna optimizer-state storage URI.",
      }),
      expect.objectContaining({
        label: "Optuna study name",
        path: "run.tuning.study_name",
        source: "registry",
      }),
    ]);
  });

  it("summarizes editor readiness from current finetuning config", () => {
    expect(buildNativeTuningEditorSummary(finetuneConfig(), "PLSRegression")).toEqual({
      enabled: true,
      modelName: "PLSRegression",
      nativePayloadLabel: "run(tuning=...) candidate",
      parameterCount: 1,
      readinessLabel: "Ready for native tuning projection",
      trialCountLabel: "50 trials",
    });
    expect(buildNativeTuningEditorSummary(finetuneConfig({ enabled: false }), "PLSRegression")).toMatchObject({
      nativePayloadLabel: "No native tuning payload emitted",
      readinessLabel: "Enable finetuning to prepare a native tuning payload",
      trialCountLabel: "disabled",
    });
  });

  it("renders native tuning syntax, effects, and guardrails", async () => {
    const { container, root } = await render(
        <FinetuneNativeContractCard
          availableParamCount={3}
          config={finetuneConfig({
            train_params: [{
              choices: [16, 32],
              name: "batch_size",
              type: "categorical",
            }],
          })}
          modelName="PLSRegression"
          registry={registry()}
        />,
    );

    expect(container.textContent).toContain("Native nirs4all tuning contract");
    expect(container.textContent).toContain("run(tuning=...) candidate for PLSRegression; 50 trials.");
    expect(container.textContent).toContain("Ready for native tuning projection");
    expect(container.textContent).toContain("run.tuning");
    expect(container.textContent).toContain("run.tuning.space");
    expect(container.textContent).toContain("run.tuning.force_params");
    expect(container.textContent).toContain("run.tuning.score_data");
    expect(container.textContent).toContain("run.tuning.storage");
    expect(container.textContent).toContain("run.tuning.study_name");
    expect(container.textContent).toContain("Ordered search-space preview");
    expect(container.textContent).toContain("nirs4all.tuning.ordered_search_space");
    expect(container.textContent).toContain("studio_preview_non_tcv1");
    expect(container.textContent).toContain("model.n_components");
    expect(container.textContent).toContain("train.batch_size");
    expect(container.textContent).toContain("Studio preview fingerprints are display-only");
    expect(container.textContent).toContain("optuna: supported");
    expect(container.textContent).toContain("dag-ml: partial");
    expect(container.textContent).toContain("Studio prepares the configuration only");
    expect(container.textContent).toContain("final conformal calibration is attached after the winner is selected");

    await act(async () => {
      root.unmount();
    });
  });
});
