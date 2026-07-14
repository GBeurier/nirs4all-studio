/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createPredictionViewerConformalCoverageOptions,
  getPredictionViewerConformalDisplayState,
  PredictionViewerConformalToolbar,
  resolvePredictionViewerDefaultConformalCoverage,
  withPredictionViewerConformalCoverage,
} from "../PredictionViewerConformalToolbar";
import type {
  PartitionDataset,
  ViewerPartitionTarget,
} from "../types";

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
});

function conformalRows() {
  return [
    {
      index: 0,
      intervals: [
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
      ],
      sampleId: "sample-a",
      yPred: 0.5,
      yPredLabel: "0.5000",
    },
  ];
}

function target(overrides: Partial<ViewerPartitionTarget> = {}): ViewerPartitionTarget {
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

function dataset(overrides: Partial<PartitionDataset> = {}): PartitionDataset {
  return {
    predictionId: "p-test",
    partition: "test",
    label: "test",
    yTrue: [0.4],
    yPred: [0.5],
    nSamples: 1,
    conformalCoverage: 0.8,
    conformalCoverageLabel: "80%",
    conformalIntervals: [{ coverage: 0.8, coverageLabel: "80%", lower: 0, upper: 1 }],
    ...overrides,
  };
}

describe("PredictionViewerConformalToolbar helpers", () => {
  it("derives sorted coverages and default coverage from viewer targets", () => {
    const partitions = [target()];

    expect(createPredictionViewerConformalCoverageOptions(partitions)).toEqual([
      { coverage: 0.8, label: "80%" },
      { coverage: 0.95, label: "95%" },
    ]);
    expect(resolvePredictionViewerDefaultConformalCoverage(partitions)).toBe(0.8);
    expect(withPredictionViewerConformalCoverage(partitions, 0.95)[0]).toMatchObject({
      conformalCoverage: 0.95,
    });
  });

  it("reports active and mismatch display states explicitly", () => {
    expect(getPredictionViewerConformalDisplayState([target()], [dataset()], 0.8)).toMatchObject({
      coverageLabel: "80%",
      tone: "active",
      visible: true,
    });

    expect(getPredictionViewerConformalDisplayState([target()], [dataset({
      conformalCoverage: undefined,
      conformalCoverageLabel: undefined,
      conformalIntervals: undefined,
    })], 0.8)).toMatchObject({
      message: "Conformal intervals could not be aligned with the current prediction sample order.",
      tone: "warning",
      visible: true,
    });
  });
});

describe("PredictionViewerConformalToolbar", () => {
  it("renders coverage controls and emits selected coverage changes", async () => {
    const onSelectedCoverageChange = vi.fn();
    const { container, root } = await render(
      <PredictionViewerConformalToolbar
        datasets={[dataset()]}
        onSelectedCoverageChange={onSelectedCoverageChange}
        partitions={[target()]}
        selectedCoverage={0.8}
      />,
    );

    expect(container.textContent).toContain("Conformal");
    expect(container.textContent).toContain("80% conformal intervals are displayed");
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons.map(button => button.textContent)).toEqual(["80%", "95%"]);

    await act(async () => {
      buttons[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSelectedCoverageChange).toHaveBeenCalledWith(0.95);

    await act(async () => {
      root.unmount();
    });
  });
});
