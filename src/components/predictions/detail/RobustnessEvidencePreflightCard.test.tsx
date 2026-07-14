/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { PredictionRobustnessEvidenceResponse } from "@/types/aggregated-predictions";
import { RobustnessEvidencePreflightCard } from "./RobustnessEvidencePreflightCard";

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

function evidence(): PredictionRobustnessEvidenceResponse {
  return {
    prediction_id: "pred-1",
    run_id: "run",
    pipeline_id: "pipe",
    chain_id: "chain",
    stored_prediction_scenarios: ["observed", "prediction_noise"],
    spectral_scenarios: ["spectral_shift"],
    can_compute_stored_prediction_report: true,
    can_compute_spectral_report: false,
    status: "ready_for_prediction_space_only",
    requirements: [
      {
        id: "y_true",
        label: "Stored truth labels",
        present: true,
        source: "prediction_arrays.y_true",
        detail: "Required for observed robustness metrics.",
      },
      {
        id: "spectra",
        label: "Row-aligned spectra / X matrix",
        present: false,
        source: null,
        detail: "Required before Studio can replay spectral/OOD perturbations.",
      },
    ],
    blockers: ["Spectral/OOD scenarios require a row-aligned X/spectra matrix."],
  };
}

describe("RobustnessEvidencePreflightCard", () => {
  it("renders loading state", async () => {
    const { container, root } = await render(
      <RobustnessEvidencePreflightCard evidence={null} loading />,
    );

    expect(container.textContent).toContain("Checking spectral/OOD replay evidence...");

    await act(async () => {
      root.unmount();
    });
  });

  it("renders fail-closed spectral/OOD evidence without computing locally", async () => {
    const { container, root } = await render(
      <RobustnessEvidencePreflightCard evidence={evidence()} loading={false} />,
    );

    expect(container.textContent).toContain("Spectral/OOD replay preflight: blocked");
    expect(container.textContent).toContain("Prediction-space ready");
    expect(container.textContent).toContain("Spectral/OOD blocked");
    expect(container.textContent).toContain("Evidence present 1/2");
    expect(container.textContent).toContain("ready for prediction space only");
    expect(container.textContent).toContain("Stored-prediction scenarios");
    expect(container.textContent).toContain("observed, prediction_noise");
    expect(container.textContent).toContain("Spectral/OOD scenarios");
    expect(container.textContent).toContain("spectral_shift");
    expect(container.textContent).toContain("Native replay handoff plan");
    expect(container.textContent).toContain("Stored prediction audit");
    expect(container.textContent).toContain("available");
    expect(container.textContent).toContain("Spectral/OOD replay evidence");
    expect(container.textContent).toContain("Native robustness handoff");
    expect(container.textContent).toContain("disabled");
    expect(container.textContent).toContain("Native spectral/OOD execution stays disabled");
    expect(container.textContent).toContain("explicit relation materialization identifiers");
    expect(container.textContent).toContain("Stored truth labels");
    expect(container.textContent).toContain("present");
    expect(container.textContent).toContain("Row-aligned spectra / X matrix");
    expect(container.textContent).toContain("missing");
    expect(container.textContent).toContain("Spectral/OOD scenarios require a row-aligned X/spectra matrix.");

    await act(async () => {
      root.unmount();
    });
  });
});
