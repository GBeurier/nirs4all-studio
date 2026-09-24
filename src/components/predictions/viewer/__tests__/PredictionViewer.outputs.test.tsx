/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { PredictionViewer } from "../PredictionViewer";
import { predictionOutputCount, coercePredictionVector } from "../predictionOutputs";
import type { PartitionDataset } from "../types";

const mocks = vi.hoisted(() => ({ arrays: vi.fn(), scatter: vi.fn(), csv: vi.fn() }));
vi.mock("@/api/aggregatedPredictions", () => ({ getPredictionArrays: mocks.arrays }));
vi.mock("@/api/linkedWorkspaces", () => ({ getN4AWorkspacePredictionScatter: mocks.scatter }));
vi.mock("../export", async importOriginal => ({ ...await importOriginal<typeof import("../export")>(), exportRowsCsv: mocks.csv, exportChartPng: vi.fn() }));
vi.mock("../PredictionViewerChartArea", () => ({ PredictionViewerChartArea: ({ datasets, error }: { datasets: PartitionDataset[]; error: string | null }) =>
  <pre data-testid="chart-data">{error ?? JSON.stringify(datasets.map(({ yTrue, yPred }) => ({ yTrue, yPred })))}</pre> }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; document.body.innerHTML = ""; vi.clearAllMocks(); });

async function render(source: "workspace" | "aggregated", payload: object) {
  mocks.arrays.mockResolvedValue(payload); mocks.scatter.mockResolvedValue(payload);
  const container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  await act(async () => root!.render(<PredictionViewer open onOpenChange={() => undefined}
    header={{ datasetName: "two outputs", modelName: "Ridge", taskType: "regression" }} workspaceId="workspace"
    partitions={[{ predictionId: "pred", partition: "test", source }]} />));
  await vi.waitFor(() => expect(document.body.querySelector('[data-testid="chart-data"]')?.textContent).toContain("yPred"));
}

it.each(["workspace", "aggregated"] as const)("selects each %s output locally, recomputes metrics and exports labelled values", async source => {
  await render(source, { y_true: [[1, 10], [2, 20]], y_pred: [[1, 12], [2, 24]], n_samples: 2, sample_ids: ["a", "b"] });
  expect(document.body.textContent).toContain("Metrics below are calculated for Output 1");
  expect(document.body.textContent).toContain("0.0000");
  const select = document.body.querySelector<HTMLSelectElement>("select")!;
  expect(select.labels?.[0].textContent).toBe("Output");
  await act(async () => { select.value = "1"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(document.body.querySelector('[data-testid="chart-data"]')?.textContent).toBe('[{"yTrue":[10,20],"yPred":[12,24]}]');
  expect(document.body.textContent).toContain("3.1623");
  expect(document.body.textContent).toContain("Output 2: actual and predicted values");
  expect(document.body.textContent).toContain("stored model summary scores may combine outputs");
  const exportButton = [...document.body.querySelectorAll("button")].find(button => button.textContent === "Download output values (CSV)")!;
  await act(async () => exportButton.click());
  expect(mocks.csv).toHaveBeenCalledWith([
    { output: "Output 2", partition: "test", sample: "a", actual: 10, predicted: 12 },
    { output: "Output 2", partition: "test", sample: "b", actual: 20, predicted: 24 },
  ], ["output", "partition", "sample", "actual", "predicted"], "predictions_output-2.csv");
  expect(source === "workspace" ? mocks.scatter : mocks.arrays).toHaveBeenCalledTimes(1);
});

it("keeps scalar predictions and exact data available without an output selector", async () => {
  await render("workspace", { y_true: [1, 2], y_pred: [1.1, 2.1], n_samples: 2 });
  expect(document.body.querySelector("select")).toBeNull();
  expect(document.body.textContent).toContain("View prediction values (first 2)");
  expect(document.body.textContent).toContain("0.1000");
});

it("rejects ragged arrays and out-of-range outputs rather than displaying another column", () => {
  expect(() => predictionOutputCount([[1, 2], [3]])).toThrow("rectangular");
  expect(() => coercePredictionVector([[1, 2]], 2)).toThrow("unavailable");
  expect(coercePredictionVector([[1], [2]], 0)).toEqual([1, 2]);
});
