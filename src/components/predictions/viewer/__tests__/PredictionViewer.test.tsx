/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PredictionViewer } from "../PredictionViewer";
import type {
  PartitionDataset,
  PredictionViewerProps,
  ViewerPartitionTarget,
} from "../types";

const mocks = vi.hoisted(() => ({
  getPredictionArrays: vi.fn(),
}));

vi.mock("@/api/aggregatedPredictions", () => ({
  getPredictionArrays: mocks.getPredictionArrays,
}));

vi.mock("../PredictionViewerChartArea", () => ({
  PredictionViewerChartArea: ({ datasets }: { datasets: PartitionDataset[] }) => (
    <div data-testid="mock-chart">
      {datasets.map(dataset => (
        <span key={dataset.predictionId}>
          {dataset.label}:{dataset.conformalCoverageLabel ?? "no-conformal"}
        </span>
      ))}
    </div>
  ),
}));

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

afterEach(async () => {
  for (const container of mountedContainers) {
    container.remove();
  }
  mountedContainers = [];
  document.body.innerHTML = "";
  mocks.getPredictionArrays.mockReset();
});

function predictionViewerProps(partitions: ViewerPartitionTarget[]): PredictionViewerProps {
  return {
    open: true,
    onOpenChange: vi.fn(),
    header: {
      datasetName: "corn",
      modelName: "PLS",
      taskType: "regression",
    },
    partitions,
    initialKind: "scatter",
  };
}

function conformalRows() {
  return [
    {
      index: 0,
      intervals: [
        {
          coverage: 0.8,
          coverageLabel: "80%",
          lower: 0,
          lowerLabel: "0.0000",
          upper: 1,
          upperLabel: "1.0000",
          width: 1,
          widthLabel: "1.0000",
        },
        {
          coverage: 0.95,
          coverageLabel: "95%",
          lower: -0.5,
          lowerLabel: "-0.5000",
          upper: 1.5,
          upperLabel: "1.5000",
          width: 2,
          widthLabel: "2.0000",
        },
      ],
      sampleId: "sample-a",
      yPred: 0.5,
      yPredLabel: "0.5000",
    },
  ];
}

function conformalTarget(overrides: Partial<ViewerPartitionTarget> = {}): ViewerPartitionTarget {
  return {
    predictionId: "p-test",
    partition: "test",
    label: "test",
    source: "aggregated",
    conformalRows: conformalRows(),
    conformalCoverage: 0.8,
    ...overrides,
  };
}

describe("PredictionViewer conformal integration", () => {
  it("renders attached conformal coverage and updates the decorated dataset when coverage changes", async () => {
    mocks.getPredictionArrays.mockResolvedValue({
      y_true: [0.4],
      y_pred: [0.5],
      n_samples: 1,
      sample_indices: ["sample-a"],
      sample_metadata: null,
    });

    const { root } = await render(<PredictionViewer {...predictionViewerProps([conformalTarget()])} />);

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("80% conformal intervals are displayed");
      expect(document.body.textContent).toContain("test:80%");
    });

    const coverage95Button = [...document.body.querySelectorAll("button")]
      .find(button => button.textContent === "95%");
    expect(coverage95Button).toBeTruthy();

    await act(async () => {
      coverage95Button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("95% conformal intervals are displayed");
      expect(document.body.textContent).toContain("test:95%");
    });
    expect(mocks.getPredictionArrays).toHaveBeenCalledTimes(2);

    await act(async () => {
      root.unmount();
    });
  });

  it("shows an explicit warning when multiple conformal partitions are opened", async () => {
    mocks.getPredictionArrays.mockResolvedValue({
      y_true: [0.4],
      y_pred: [0.5],
      n_samples: 1,
      sample_indices: ["sample-a"],
      sample_metadata: null,
    });

    const { root } = await render(<PredictionViewer {...predictionViewerProps([
      conformalTarget({ predictionId: "p-test", partition: "test", label: "test" }),
      conformalTarget({ predictionId: "p-val", partition: "val", label: "val" }),
    ])} />);

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain(
        "Conformal intervals are displayed only when a single calibrated partition is open.",
      );
    });

    await act(async () => {
      root.unmount();
    });
  });
});
