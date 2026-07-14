/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import type { KeywordRegistryDocument } from "@/ui/keywordRegistry";
import {
  buildRobustnessScenarioDraftViewModel,
  RobustnessScenarioDraftCard,
} from "../RobustnessScenarioDraftCard";

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

function registry(): KeywordRegistryDocument {
  return {
    entries: [
      {
        aliases: [],
        canonical_term: "robustness_mode",
        changes: ["robustness_report"],
        docs_anchor: "robustness-mode",
        engine_support: { "dag-ml": "partial", legacy: "unsupported" },
        id: "robustness.mode",
        invalidates_calibration: "mode_dependent",
        lifecycle_stage: "robustness",
        path: "robustness.mode",
        reads: ["predictions"],
        scope: "pipeline_execution",
        status: "partial",
        summary: "Selects the robustness execution mode.",
        surface: "robustness_argument",
        token: "mode",
        ui: { control: "select", group: "robustness", label: "Robustness mode", order: 299 },
        value_schema: {
          enum: ["clean_frozen", "matched_recalibration", "future_mode"],
          "x-executable-values": ["clean_frozen"],
          type: "string",
        },
      },
      {
        aliases: [],
        canonical_term: "robustness_scenarios",
        changes: ["robustness_report"],
        docs_anchor: "robustness-scenarios",
        engine_support: { "dag-ml": "partial", legacy: "unsupported" },
        id: "robustness.scenarios",
        invalidates_calibration: "mode_dependent",
        lifecycle_stage: "robustness",
        path: "robustness.scenarios",
        reads: ["predictions"],
        scope: "pipeline_execution",
        status: "partial",
        summary: "Defines audit-only robustness scenario cells.",
        surface: "robustness_argument",
        token: "scenarios",
        ui: { control: "object", group: "robustness", label: "Robustness scenarios", order: 300 },
        value_schema: {
          items: {
            properties: {
              distribution: { enum: ["normal", "uniform", "ignored_by_ui"] },
              kind: { enum: ["observed", "prediction_noise", "spectral_shift", "future_kind"] },
            },
            type: "object",
          },
          type: "array",
        },
      },
    ],
    registry_version: "1.0.0",
    schema_id: "https://nirs4all.org/schemas/keyword-effects/v1",
    schema_version: 1,
    scope: "lifecycle-v1",
  };
}

describe("RobustnessScenarioDraftCard", () => {
  it("builds a fallback draft view model from nirs4all-ui robustness helpers", () => {
    const viewModel = buildRobustnessScenarioDraftViewModel(undefined, {
      kind: "observed",
      severity: 0,
    });

    expect(viewModel.registrySource).toBe("fallback");
    expect(viewModel.valid).toBe(true);
    expect(viewModel.modeOptions.map((option) => option.value)).toEqual([
      "clean_frozen",
      "matched_recalibration",
      "structural_refit",
    ]);
    expect(viewModel.normalizedMode).toBe("clean_frozen");
    expect(viewModel.kindOptions.map((option) => option.value)).toContain("spectral_shift");
    expect(viewModel.distributionOptions).toEqual([
      expect.objectContaining({ disabled: true, value: "normal" }),
      expect.objectContaining({ disabled: true, value: "uniform" }),
    ]);
    expect(viewModel.normalizedDraft).toEqual({
      kind: "observed",
      severity: 0,
    });
  });

  it("derives scenario kind and distribution options from the live keyword registry", () => {
    const viewModel = buildRobustnessScenarioDraftViewModel(registry(), {
      distribution: "normal",
      kind: "prediction_noise",
      severity: 0.15,
    });

    expect(viewModel.registrySource).toBe("registry");
    expect(viewModel.valid).toBe(true);
    expect(viewModel.modeOptions).toEqual([
      expect.objectContaining({ disabled: false, executable: true, value: "clean_frozen" }),
      expect.objectContaining({ disabled: true, executable: false, value: "matched_recalibration" }),
    ]);
    expect(viewModel.normalizedMode).toBe("clean_frozen");
    expect(viewModel.kindOptions.map((option) => option.value)).toEqual([
      "observed",
      "prediction_noise",
      "spectral_shift",
    ]);
    expect(viewModel.distributionOptions).toEqual([
      expect.objectContaining({ disabled: false, value: "normal" }),
      expect.objectContaining({ disabled: false, value: "uniform" }),
    ]);
    expect(viewModel.normalizedDraft).toEqual({
      distribution: "normal",
      kind: "prediction_noise",
      severity: 0.15,
    });
  });

  it("keeps deterministic scenarios fail-closed when a stochastic distribution is present", () => {
    const viewModel = buildRobustnessScenarioDraftViewModel(registry(), {
      distribution: "normal",
      kind: "spectral_shift",
      severity: 0.1,
    });

    expect(viewModel.valid).toBe(false);
    expect(viewModel.issues).toEqual([
      expect.objectContaining({
        code: "distribution_not_allowed",
        path: "distribution",
      }),
    ]);
  });

  it("marks reserved robustness modes as non-attachable", () => {
    const viewModel = buildRobustnessScenarioDraftViewModel(
      registry(),
      {
        kind: "observed",
        severity: 0,
      },
      "matched_recalibration",
    );

    expect(viewModel.modeExecutable).toBe(false);
    expect(viewModel.normalizedMode).toBeNull();
    expect(viewModel.valid).toBe(false);
  });

  it("renders a draft-only form and clears distributions when the kind becomes deterministic", async () => {
    const { container, root } = await render(
      <RobustnessScenarioDraftCard
        attachToLaunch
        publishSpectralEvidence
        registry={registry()}
      />,
    );

    expect(container.textContent).toContain("Robustness scenario draft");
    expect(container.textContent).toContain("registry registry");
    expect(container.textContent).toContain("Attach this draft to launch metadata");
    expect(container.textContent).toContain("Publish spectral/OOD replay evidence when the execution driver can provide it");
    expect(container.textContent).toContain("\"mode\": \"clean_frozen\"");
    expect(container.textContent).toContain("\"kind\": \"observed\"");
    expect(container.textContent).toContain("\"publish_evidence\"");
    expect(container.textContent).toContain("\"destination\": \"result_metadata.robustness_evidence\"");

    const modeSelect = container.querySelector<HTMLSelectElement>("select[name='mode']");
    const kindSelect = container.querySelector<HTMLSelectElement>("select[name='kind']");
    const distributionSelect = container.querySelector<HTMLSelectElement>("select[name='distribution']");
    const publishCheckbox = container.querySelector<HTMLInputElement>(
      "input[aria-label='Publish spectral/OOD replay evidence when available']",
    );
    expect(modeSelect).toBeTruthy();
    expect(kindSelect).toBeTruthy();
    expect(distributionSelect).toBeTruthy();
    expect(publishCheckbox).toBeTruthy();
    expect(publishCheckbox?.checked).toBe(true);
    expect(publishCheckbox?.disabled).toBe(false);
    expect(modeSelect?.value).toBe("clean_frozen");
    expect(modeSelect?.querySelector("option[value='matched_recalibration']")?.disabled).toBe(true);
    expect(distributionSelect?.disabled).toBe(true);

    await act(async () => {
      kindSelect!.value = "prediction_noise";
      kindSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(distributionSelect?.disabled).toBe(false);

    await act(async () => {
      distributionSelect!.value = "normal";
      distributionSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(container.textContent).toContain("\"distribution\": \"normal\"");

    await act(async () => {
      distributionSelect!.value = "uniform";
      distributionSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(container.textContent).toContain("\"distribution\": \"uniform\"");

    await act(async () => {
      kindSelect!.value = "spectral_shift";
      kindSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(distributionSelect?.disabled).toBe(true);
    expect(distributionSelect?.value).toBe("");
    expect(container.textContent).not.toContain("\"distribution\": \"normal\"");
    expect(container.textContent).not.toContain("\"distribution\": \"uniform\"");

    await act(async () => {
      root.unmount();
    });
  });
});
