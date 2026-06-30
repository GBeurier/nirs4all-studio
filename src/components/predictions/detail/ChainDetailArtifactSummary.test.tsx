/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { ChainDetailArtifactSummary } from "./ChainDetailArtifactSummary";
import type { ChainDetailArtifactSummary as ChainDetailArtifactSummaryData } from "./useChainDetailPanelState";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

async function renderNode(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(node);
  });

  return {
    container,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function summary(overrides: Partial<ChainDetailArtifactSummaryData> = {}): ChainDetailArtifactSummaryData {
  return {
    refs: [],
    totalCount: 3,
    totalCountLabel: "3 artifacts",
    kindItems: [
      { id: "kind:model", label: "Model", artifactCount: 2, artifactCountLabel: "2 artifacts" },
      { id: "kind:prediction_arrays", label: "Prediction arrays", artifactCount: 1, artifactCountLabel: "1 artifact" },
    ],
    statusItems: [
      { id: "status:available", label: "Available", artifactCount: 3, artifactCountLabel: "3 artifacts" },
    ],
    provenanceGroups: [
      {
        id: "source-scope:legacy-fold-artifacts:fold",
        label: "Legacy fold artifacts / Fold",
        sourceLabel: "Legacy fold artifacts",
        scopeLabel: "Fold",
        artifactCount: 2,
        artifactCountLabel: "2 artifacts",
        artifactLabels: ["Final (refit) model", "Fold 1 model"],
      },
      {
        id: "source-scope:prediction-arrays:prediction",
        label: "Prediction arrays / Prediction",
        sourceLabel: "Prediction arrays",
        scopeLabel: "Prediction",
        artifactCount: 1,
        artifactCountLabel: "1 artifact",
        artifactLabels: ["Prediction arrays"],
      },
    ],
    ...overrides,
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ChainDetailArtifactSummary", () => {
  it("renders nothing when no artifacts are available", async () => {
    const mounted = await renderNode(<ChainDetailArtifactSummary summary={summary({
      totalCount: 0,
      totalCountLabel: "0 artifacts",
      kindItems: [],
      statusItems: [],
      provenanceGroups: [],
    })} />);

    expect(mounted.container.textContent).toBe("");

    await mounted.unmount();
  });

  it("renders artifact counters and provenance groups from the read model", async () => {
    const mounted = await renderNode(<ChainDetailArtifactSummary summary={summary()} />);

    expect(mounted.container.textContent).toContain("Artifacts and provenance");
    expect(mounted.container.textContent).toContain("3 artifacts");
    expect(mounted.container.textContent).toContain("Model: 2 artifacts");
    expect(mounted.container.textContent).toContain("Available: 3 artifacts");
    expect(mounted.container.textContent).toContain("Legacy fold artifacts / Fold");
    expect(mounted.container.textContent).toContain("Final (refit) model, Fold 1 model");

    await mounted.unmount();
  });
});
