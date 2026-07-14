/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  exportWorkspaceRobustnessReport: vi.fn(),
}));

vi.mock("@/api/aggregatedPredictions", () => ({
  exportWorkspaceRobustnessReport: apiMocks.exportWorkspaceRobustnessReport,
}));

import { ChainDetailArtifactSummary } from "./ChainDetailArtifactSummary";
import type { ChainDetailArtifactSummary as ChainDetailArtifactSummaryData } from "./useChainDetailPanelState";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const createObjectURLMock = vi.fn(() => "blob:artifact-robustness-report");
const revokeObjectURLMock = vi.fn();
Object.defineProperty(URL, "createObjectURL", {
  configurable: true,
  value: createObjectURLMock,
});
Object.defineProperty(URL, "revokeObjectURL", {
  configurable: true,
  value: revokeObjectURLMock,
});
const anchorClickMock = vi
  .spyOn(HTMLAnchorElement.prototype, "click")
  .mockImplementation(() => undefined);

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
    auditItems: [],
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
  vi.clearAllMocks();
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

  it("renders compact robustness audit metadata items", async () => {
    const mounted = await renderNode(<ChainDetailArtifactSummary summary={summary({
      auditItems: [{
        id: "artifact-audit:robustness-summary",
        refId: "robustness-summary",
        label: "Robustness summary audit",
        detailLabels: [
          "Mode clean_frozen",
          "Scenarios observed, prediction_noise",
          "Seed 123",
          "Prediction pred-1",
        ],
      }],
    })} />);

    expect(mounted.container.textContent).toContain("Audit metadata");
    expect(mounted.container.textContent).toContain("Robustness summary audit");
    expect(mounted.container.textContent).toContain("Scenarios observed, prediction_noise");
    expect(mounted.container.textContent).toContain("Prediction pred-1");

    await mounted.unmount();
  });

  it("exports robustness reports attached as workspace artifact refs", async () => {
    const mounted = await renderNode(<ChainDetailArtifactSummary summary={summary({
      refs: [{
        id: "robustness-summary:chain:rob-1",
        kind: "repository_entry",
        role: "robustness-summary",
        label: "Prediction noise report",
        source: "result-repository",
        scope: "chain",
        status: "available",
        artifactId: "rob report/1",
        metadata: {
          robustness_id: "rob report/1",
        },
      }],
    })} />);
    const blob = new Blob(["<h1>Robustness</h1>\n"], { type: "text/html" });
    apiMocks.exportWorkspaceRobustnessReport.mockResolvedValue(blob);

    expect(mounted.container.textContent).toContain("Robustness report exports");
    expect(mounted.container.textContent).toContain("Prediction noise report");
    expect(mounted.container.textContent).toContain("Report id rob report/1");

    const htmlButton = Array.from(mounted.container.querySelectorAll("button"))
      .find((button) => button.textContent === "HTML") as HTMLButtonElement;
    await act(async () => {
      htmlButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(apiMocks.exportWorkspaceRobustnessReport).toHaveBeenCalledWith("rob report/1", "html");
    expect(createObjectURLMock).toHaveBeenCalledWith(blob);
    expect(anchorClickMock).toHaveBeenCalled();
    expect(revokeObjectURLMock).toHaveBeenCalledWith("blob:artifact-robustness-report");

    await mounted.unmount();
  });
});
