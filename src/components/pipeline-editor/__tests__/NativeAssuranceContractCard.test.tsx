/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import type { KeywordRegistryDocument } from "@/ui/keywordRegistry";
import {
  buildNativeAssuranceContractSummary,
  buildNativeAssuranceKeywordRows,
  NativeAssuranceContractCard,
  REQUIRED_NATIVE_REGISTRY_ENTRY_IDS,
} from "../NativeAssuranceContractCard";

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

function entry(
  id: string,
  path: string,
  label: string,
  summary: string,
  invalidatesCalibration: "not_applicable" | "mode_dependent" | "replaces_existing" = "not_applicable",
) {
  return {
    aliases: [],
    canonical_term: id.replace(/\./g, "_"),
    changes: [],
    docs_anchor: id,
    engine_support: { "dag-ml": "partial", legacy: "unsupported" },
    id,
    invalidates_calibration: invalidatesCalibration,
    lifecycle_stage: id.startsWith("robustness") ? "robustness" : "conformal",
    path,
    reads: [],
    scope: "pipeline_execution",
    status: "partial",
    summary,
    surface: id.startsWith("robustness") ? "robustness_argument" : "run_argument",
    token: id.split(".").at(-1) ?? id,
    ui: { control: "object", group: id.startsWith("robustness") ? "robustness" : "conformal", label, order: 100 },
    value_schema: { type: "object" },
  } as const;
}

function registry(): KeywordRegistryDocument {
  return {
    entries: [
      entry(
        "run.tuning.space",
        "run.tuning.space",
        "Search space",
        "Object/mapping search space for native tuning.",
      ),
      entry(
        "run.tuning.force_params",
        "run.tuning.force_params",
        "Forced first trial",
        "Warm-starts the first optimizer trial with public decoded values.",
      ),
      entry(
        "run.tuning.calibration",
        "run.tuning.calibration",
        "Post-tuning calibration",
        "Runs conformal calibration immediately after the explicit winner projection.",
        "replaces_existing",
      ),
      entry(
        "calibrate.calibration_data",
        "calibrate.calibration_data",
        "Calibration dataset",
        "Explicit row-aligned calibration evidence.",
      ),
      entry(
        "predict.coverage",
        "predict.coverage",
        "Prediction coverage",
        "Selects a pre-materialized conformal coverage.",
      ),
      entry(
        "robustness.mode",
        "robustness.mode",
        "Robustness mode",
        "Controls clean_frozen, matched_recalibration, or structural_refit reporting.",
        "mode_dependent",
      ),
      entry(
        "robustness.scenarios",
        "robustness.scenarios",
        "Robustness scenarios",
        "Defines audit-only robustness scenario cells.",
        "mode_dependent",
      ),
      entry(
        "robustness.scenarios.distribution",
        "robustness.scenarios.distribution",
        "Scenario distribution",
        "Distribution vocabulary for stochastic robustness scenarios.",
        "mode_dependent",
      ),
      entry(
        "robustness.X",
        "robustness.X",
        "Robustness X",
        "Explicit input matrix for spectral robustness scenarios.",
        "mode_dependent",
      ),
      entry(
        "robustness.predictor",
        "robustness.predictor",
        "Robustness predictor",
        "In-memory frozen predictor hook for spectral robustness scenarios.",
        "mode_dependent",
      ),
      entry(
        "robustness.predictor_bundle",
        "robustness.predictor_bundle",
        "Robustness predictor bundle",
        "Saved predictor path replay hook for explicit-X spectral robustness scenarios.",
        "mode_dependent",
      ),
      entry(
        "robustness.slice_by",
        "robustness.slice_by",
        "Diagnostic slices",
        "Adds subgroup diagnostics without changing guarantee scope.",
      ),
    ],
    registry_version: "1.0.0",
    schema_id: "https://nirs4all.org/schemas/keyword-effects/v1",
    schema_version: 1,
    scope: "lifecycle-v1",
  };
}

describe("NativeAssuranceContractCard", () => {
  it("builds fallback conformal and robustness keyword rows", () => {
    const rows = buildNativeAssuranceKeywordRows();

    expect(rows.map((row) => row.path)).toEqual([
      "run.tuning.space",
      "run.tuning.force_params",
      "run.tuning.calibration",
      "predict.coverage",
      "calibrate.calibration_data",
      "run.tuning.score_data.conformal_calibration",
      "robustness.scenarios",
      "robustness.scenarios.distribution",
      "robustness.X",
      "robustness.predictor",
      "robustness.predictor_bundle",
      "robustness.mode",
      "robustness.slice_by",
    ]);
    expect(rows.every((row) => row.source === "fallback")).toBe(true);
  });

  it("projects registry-backed assurance keyword rows", () => {
    const rows = buildNativeAssuranceKeywordRows(registry());

    expect(rows).toEqual([
      expect.objectContaining({
        domain: "conformal",
        label: "Search space",
        path: "run.tuning.space",
        source: "registry",
      }),
      expect.objectContaining({
        domain: "conformal",
        label: "Forced first trial",
        path: "run.tuning.force_params",
        source: "registry",
      }),
      expect.objectContaining({
        domain: "conformal",
        label: "Post-tuning calibration",
        path: "run.tuning.calibration",
        source: "registry",
      }),
      expect.objectContaining({
        domain: "conformal",
        label: "Prediction coverage",
        path: "predict.coverage",
        source: "registry",
      }),
      expect.objectContaining({
        domain: "conformal",
        label: "Calibration dataset",
        path: "calibrate.calibration_data",
        source: "registry",
      }),
      expect.objectContaining({
        domain: "robustness",
        label: "Robustness mode",
        path: "robustness.mode",
        source: "registry",
      }),
      expect.objectContaining({
        domain: "robustness",
        label: "Robustness scenarios",
        path: "robustness.scenarios",
        source: "registry",
      }),
      expect.objectContaining({
        domain: "robustness",
        label: "Scenario distribution",
        path: "robustness.scenarios.distribution",
        source: "registry",
      }),
      expect.objectContaining({
        domain: "robustness",
        label: "Robustness X",
        path: "robustness.X",
        source: "registry",
      }),
      expect.objectContaining({
        domain: "robustness",
        label: "Robustness predictor",
        path: "robustness.predictor",
        source: "registry",
      }),
      expect.objectContaining({
        domain: "robustness",
        label: "Robustness predictor bundle",
        path: "robustness.predictor_bundle",
        source: "registry",
      }),
      expect.objectContaining({
        domain: "robustness",
        label: "Diagnostic slices",
        path: "robustness.slice_by",
        source: "registry",
      }),
    ]);
  });

  it("summarizes registry source and execution engine", () => {
    expect(buildNativeAssuranceContractSummary(buildNativeAssuranceKeywordRows(registry()), "dag-ml")).toEqual({
      conformalCount: 5,
      requiredRegistryEntryCount: 7,
      requiredRegistryEntryLabel: "run.tuning.space, run.tuning.force_params, predict.coverage, robustness.scenarios.distribution, robustness.X, robustness.predictor, robustness.predictor_bundle",
      registrySource: "registry",
      robustnessCount: 7,
      runtimeEngineLabel: "engine dag-ml",
    });
  });

  it("renders conformal and robustness guardrails", async () => {
    const { container, root } = await render(
      <NativeAssuranceContractCard registry={registry()} runtimeEngine="dag-ml" />,
    );

    expect(container.textContent).toContain("Native assurance contract");
    expect(container.textContent).toContain("Conformal and robustness keywords for engine dag-ml");
    expect(container.textContent).toContain("registry registry");
    expect(container.textContent).toContain(`Required registry floor (7/${REQUIRED_NATIVE_REGISTRY_ENTRY_IDS.length})`);
    expect(container.textContent).toContain("run.tuning.space");
    expect(container.textContent).toContain("run.tuning.force_params");
    expect(container.textContent).toContain("predict.coverage");
    expect(container.textContent).toContain("Conformal");
    expect(container.textContent).toContain("run.tuning.calibration");
    expect(container.textContent).toContain("Robustness");
    expect(container.textContent).toContain("robustness.scenarios");
    expect(container.textContent).toContain("robustness.X");
    expect(container.textContent).toContain("robustness.predictor");
    expect(container.textContent).toContain("robustness.predictor_bundle");
    expect(container.textContent).toContain("Studio does not recalibrate, refit, perturb spectra, or derive guarantees");

    await act(async () => {
      root.unmount();
    });
  });
});
