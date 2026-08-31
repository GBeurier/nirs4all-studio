import { describe, expect, it } from "vitest";

import {
  getRobustnessModeOptions,
  getRobustnessModeOptionsFromRegistry,
  isRobustnessExecutableMode,
  isRobustnessMode,
  ROBUSTNESS_EXECUTABLE_MODES,
  ROBUSTNESS_MODES,
} from "./modes.js";

describe("robustness mode form contract helpers", () => {
  it("exposes public Python robustness modes and executable subset", () => {
    expect(ROBUSTNESS_MODES).toEqual([
      "clean_frozen",
      "matched_recalibration",
      "structural_refit",
    ]);
    expect(ROBUSTNESS_EXECUTABLE_MODES).toEqual(["clean_frozen"]);
    expect(isRobustnessMode("matched_recalibration")).toBe(true);
    expect(isRobustnessMode("future_mode")).toBe(false);
    expect(isRobustnessExecutableMode("clean_frozen")).toBe(true);
    expect(isRobustnessExecutableMode("structural_refit")).toBe(false);
  });

  it("projects fallback mode options with reserved modes disabled", () => {
    expect(getRobustnessModeOptions()).toEqual([
      {
        disabled: false,
        executable: true,
        label: "clean frozen",
        value: "clean_frozen",
      },
      {
        disabled: true,
        executable: false,
        label: "matched recalibration",
        value: "matched_recalibration",
      },
      {
        disabled: true,
        executable: false,
        label: "structural refit",
        value: "structural_refit",
      },
    ]);
  });

  it("derives executable mode options from the keyword registry when available", () => {
    const registry = {
      entries: [
        {
          aliases: [],
          canonical_term: "robustness_mode",
          changes: ["robustness_results"],
          docs_anchor: "planned-robustness-campaigns",
          engine_support: { "dag-ml": "partial", legacy: "unsupported" },
          id: "robustness.mode",
          invalidates_calibration: "mode_dependent",
          lifecycle_stage: "robustness",
          path: "robustness.mode",
          reads: ["external_test_or_production"],
          scope: "robustness_campaign",
          status: "partial",
          summary: "Selects the robustness execution mode.",
          surface: "robustness_argument",
          token: "mode",
          ui: { control: "select", group: "robustness", label: "Robustness mode", order: 210 },
          value_schema: {
            enum: ["clean_frozen", "matched_recalibration", "future_mode"],
            type: "string",
            "x-executable-values": ["clean_frozen"],
          },
        },
      ],
      registry_version: "1.0.0",
      schema_id: "https://nirs4all.org/schemas/keyword-effects/v1",
      schema_version: 1,
      scope: "lifecycle-v1",
    };

    expect(getRobustnessModeOptionsFromRegistry(registry)).toEqual([
      {
        disabled: false,
        executable: true,
        label: "clean frozen",
        value: "clean_frozen",
      },
      {
        disabled: true,
        executable: false,
        label: "matched recalibration",
        value: "matched_recalibration",
      },
    ]);
    expect(getRobustnessModeOptionsFromRegistry({})).toEqual(getRobustnessModeOptions());
  });
});
