import { describe, expect, it } from "vitest";

import {
  getRobustnessScenarioDistributionOptions,
  getRobustnessScenarioDistributionOptionsFromRegistry,
  getRobustnessScenarioKindOptions,
  getRobustnessScenarioKindOptionsFromRegistry,
  isRobustnessScenarioKind,
  isRobustnessStochasticScenarioKind,
  isValidRobustnessScenarioDraft,
  ROBUSTNESS_SCENARIO_DISTRIBUTIONS,
  ROBUSTNESS_SCENARIO_KINDS,
  validateRobustnessScenarioDraft,
} from "./scenarios.js";

describe("robustness scenario form contract helpers", () => {
  it("exposes the Python keyword registry scenario vocabulary", () => {
    expect(ROBUSTNESS_SCENARIO_KINDS).toEqual([
      "observed",
      "prediction_bias",
      "prediction_noise",
      "spectral_noise",
      "spectral_offset",
      "spectral_scale",
      "spectral_slope",
      "spectral_shift",
    ]);
    expect(ROBUSTNESS_SCENARIO_DISTRIBUTIONS).toEqual(["normal", "uniform"]);
    expect(isRobustnessScenarioKind("spectral_shift")).toBe(true);
    expect(isRobustnessScenarioKind("spectral_dropout")).toBe(false);
    expect(isRobustnessStochasticScenarioKind("prediction_noise")).toBe(true);
    expect(isRobustnessStochasticScenarioKind("spectral_shift")).toBe(false);
  });

  it("projects kind options with form-useful effects", () => {
    expect(getRobustnessScenarioKindOptions()).toContainEqual({
      label: "spectral shift",
      requiresExplicitPredictor: true,
      stochastic: false,
      value: "spectral_shift",
    });
    expect(getRobustnessScenarioKindOptions()).toContainEqual({
      label: "prediction noise",
      requiresExplicitPredictor: false,
      stochastic: true,
      value: "prediction_noise",
    });
  });

  it("derives kind options from the keyword registry when available", () => {
    const registry = {
      entries: [
        {
          aliases: [],
          canonical_term: "robustness_scenarios",
          changes: ["robustness_results"],
          docs_anchor: "planned-robustness-campaigns",
          engine_support: { "dag-ml": "partial", legacy: "unsupported" },
          id: "robustness.scenarios",
          invalidates_calibration: "mode_dependent",
          lifecycle_stage: "robustness",
          path: "robustness.scenarios",
          reads: ["external_test_or_production"],
          scope: "robustness_campaign",
          status: "partial",
          summary: "Defines report cells for robustness diagnostics.",
          surface: "robustness_argument",
          token: "scenarios",
          ui: { control: "array", group: "robustness", label: "Robustness scenarios", order: 220 },
          value_schema: {
            items: {
              properties: {
                kind: {
                  enum: ["observed", "spectral_shift", "future_unknown_kind"],
                  type: "string",
                },
                distribution: {
                  enum: ["normal", "uniform"],
                  type: "string",
                },
              },
              required: ["kind"],
              type: "object",
            },
            minItems: 1,
            type: "array",
          },
        },
      ],
      registry_version: "1.0.0",
      schema_id: "https://nirs4all.org/schemas/keyword-effects/v1",
      schema_version: 1,
      scope: "lifecycle-v1",
    };

    expect(getRobustnessScenarioKindOptionsFromRegistry(registry)).toEqual([
      {
        label: "observed",
        requiresExplicitPredictor: false,
        stochastic: false,
        value: "observed",
      },
      {
        label: "spectral shift",
        requiresExplicitPredictor: true,
        stochastic: false,
        value: "spectral_shift",
      },
    ]);
    expect(getRobustnessScenarioKindOptionsFromRegistry({}).map((option) => option.value)).toEqual(
      [...ROBUSTNESS_SCENARIO_KINDS],
    );
    expect(getRobustnessScenarioDistributionOptionsFromRegistry(registry, "prediction_noise")).toEqual([
      { disabled: false, label: "normal", value: "normal" },
      { disabled: false, label: "uniform", value: "uniform" },
    ]);
    expect(getRobustnessScenarioDistributionOptionsFromRegistry(registry, "spectral_shift")).toEqual([
      { disabled: true, label: "normal", value: "normal" },
      { disabled: true, label: "uniform", value: "uniform" },
    ]);
    expect(getRobustnessScenarioDistributionOptionsFromRegistry({}, "prediction_noise")).toEqual([
      { disabled: false, label: "normal", value: "normal" },
      { disabled: false, label: "uniform", value: "uniform" },
    ]);
  });

  it("enables distribution choices only for stochastic scenarios", () => {
    expect(getRobustnessScenarioDistributionOptions("prediction_noise")).toEqual([
      { disabled: false, label: "normal", value: "normal" },
      { disabled: false, label: "uniform", value: "uniform" },
    ]);
    expect(getRobustnessScenarioDistributionOptions("spectral_shift")).toEqual([
      { disabled: true, label: "normal", value: "normal" },
      { disabled: true, label: "uniform", value: "uniform" },
    ]);
  });

  it("validates stochastic and deterministic scenario drafts before execution", () => {
    expect(validateRobustnessScenarioDraft({ kind: "prediction_noise", severity: 0.1, distribution: "normal" })).toEqual([]);
    expect(validateRobustnessScenarioDraft({ kind: "spectral_noise", severity: 0.1, distribution: "uniform" })).toEqual([]);
    expect(validateRobustnessScenarioDraft({ kind: "spectral_shift", severity: 0.25 })).toEqual([]);
    expect(isValidRobustnessScenarioDraft({ kind: "observed" })).toBe(true);

    expect(validateRobustnessScenarioDraft({ kind: "spectral_shift", severity: 0.25, distribution: "normal" })).toEqual([
      {
        code: "distribution_not_allowed",
        message: "Scenario distribution is accepted only for prediction_noise and spectral_noise.",
        path: "distribution",
      },
    ]);
    expect(validateRobustnessScenarioDraft({ kind: "prediction_noise", distribution: "laplace" }).map((issue) => issue.code)).toEqual([
      "distribution_unsupported",
    ]);
    expect(validateRobustnessScenarioDraft({ kind: "prediction_bias", severity: Number.NaN }).map((issue) => issue.code)).toEqual([
      "severity_not_number",
    ]);
  });
});
