import "@/lib/__tests__/support/experimentI18n";
/**
 * @vitest-environment jsdom
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ALL_TARGET_COLUMNS, type ExperimentTargetOption } from "@/lib/experimentTargets";
import { NewExperimentReviewMissingTargetsField } from "./NewExperimentReviewMissingTargetsField";
import { NewExperimentReviewTargetsField } from "./NewExperimentReviewTargetsField";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

async function render(element: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(element);
  });
  return container;
}

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
  container = null;
  root = null;
});

const option: ExperimentTargetOption = {
  datasetId: "several",
  datasetName: "Traits",
  sampleCount: 150,
  targets: [
    { column: "trait_01", type: "regression", missing_count: 0 },
    { column: "trait_03", type: "regression", missing_count: 30 },
  ],
  selected: "trait_03",
};

describe("NewExperimentReviewTargetsField", () => {
  it("asks nothing when every dataset has a single target column", async () => {
    const host = await render(<NewExperimentReviewTargetsField targetOptions={[]} onTargetChange={vi.fn()} />);
    expect(host.textContent).toBe("");
  });

  it("shows the column each dataset with several targets is trained on, with its missing values", async () => {
    const host = await render(<NewExperimentReviewTargetsField targetOptions={[option]} onTargetChange={vi.fn()} />);
    expect(host.textContent).toContain("Target to model");
    expect(host.textContent).toContain("Traits");
    const trigger = host.querySelector<HTMLButtonElement>("#experiment-target-several")!;
    expect(trigger.getAttribute("role")).toBe("combobox");
    expect(trigger.textContent).toContain("trait_03 — 30 without a value");
  });

  it("shows the explicit choice of all columns together", async () => {
    const host = await render(
      <NewExperimentReviewTargetsField
        targetOptions={[{ ...option, selected: ALL_TARGET_COLUMNS }]}
        onTargetChange={vi.fn()}
      />,
    );
    expect(host.querySelector("#experiment-target-several")!.textContent)
      .toContain("All 2 target columns together (one multi-output model)");
  });
});

describe("NewExperimentReviewMissingTargetsField missing counts", () => {
  it("states how many samples have no value for the trained target", async () => {
    const host = await render(
      <NewExperimentReviewMissingTargetsField
        missingTargetPolicy="predict"
        missingTargetCounts={[
          { datasetId: "several", datasetName: "Traits", target: "trait_03", missing: 30, samples: 150 },
          { datasetId: "old", datasetName: "Old record", target: "protein", missing: 4, samples: null },
        ]}
        removalAvailable
        onMissingTargetPolicyChange={vi.fn()}
      />,
    );
    expect(host.textContent).toContain("Traits — trait_03: 30 of 150 samples without a value");
    expect(host.textContent).toContain("Old record — protein: 4 samples without a value");
  });
});
