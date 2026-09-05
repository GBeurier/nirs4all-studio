/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ catalogue: vi.fn(), predict: vi.fn(), file: vi.fn() }));
vi.mock("@/api/linkedWorkspaces", () => ({ getLinkedWorkspaces: async () => ({ active_workspace_id: "workspace-a", workspaces: [] }) }));
vi.mock("@/api/predict", () => ({ getAvailableModels: mocks.catalogue, runPrediction: mocks.predict, runPredictionWithFile: mocks.file }));
vi.mock("@/components/layout/MlLoadingOverlay", () => ({ MlLoadingOverlay: ({ children }: { children: ReactNode }) => children }));
vi.mock("./DataInput", () => ({ DataInput: ({ model, onRunPrediction }: { model: unknown; onRunPrediction: (input: unknown) => void }) => <>
  <button disabled={!model} onClick={() => onRunPrediction({ type: "array", spectra: [[1, 2]] })}>Run pasted spectra</button>
  <button disabled={!model} onClick={() => onRunPrediction({ type: "dataset", datasetId: "held-out", partition: "test" })}>Run linked dataset</button>
  <button disabled={!model} onClick={() => onRunPrediction({ type: "file", file: new File(["a,b\n1,2"], "spectra.csv") })}>Run uploaded file</button>
</> }));
vi.mock("./PredictResults", () => ({ PredictResults: ({ result }: { result: { predictions: number[] } }) => <p>Predicted values: {result.predictions.join(", ")}</p> }));

import { GeneralPredictionPanel } from "./GeneralPredictionPanel";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let cleanup: (() => Promise<void>) | undefined;
const model = { id: "exports/Ridge.n4a", name: "Ridge", source: "bundle", model_class: "Ridge", dataset_name: "training",
  metric: null, best_score: null, created_at: null, file_size: 1024, preprocessing: "StandardScaler", bundle_path: "exports/Ridge.n4a",
  archive_fingerprint: `sha256:${"a".repeat(64)}`, target_names: ["protein", "moisture"] };

beforeEach(() => {
  mocks.catalogue.mockReset().mockResolvedValue({ models: [model], total: 1 });
  const output = { predictions: [3], prediction_matrix: [[3, 7]], target_names: ["protein", "moisture"], output_index: 0,
    num_samples: 1, sample_ids: ["sample-stable"], model_name: "Ridge", preprocessing_steps: [], metrics: null, actual_values: null };
  mocks.predict.mockReset().mockResolvedValue(output);
  mocks.file.mockReset().mockResolvedValue(output);
});
afterEach(async () => { await cleanup?.(); cleanup = undefined; });

async function waitFor(assertion: () => void) {
  await act(async () => { await vi.waitFor(assertion); });
}

async function renderPanel() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  cleanup = async () => { await act(async () => root.unmount()); client.clear(); container.remove(); };
  await act(async () => root.render(<QueryClientProvider client={client}><GeneralPredictionPanel /></QueryClientProvider>));
  return { container, client };
}

async function selectModel(container: HTMLElement) {
  await waitFor(() => expect(container.querySelectorAll("#general-model option")).toHaveLength(2));
  const select = container.querySelector<HTMLSelectElement>("#general-model")!;
  await act(async () => { select.selectedIndex = 1; select.dispatchEvent(new Event("change", { bubbles: true })); });
}

it.each(["pasted spectra", "linked dataset", "uploaded file"])("runs %s from the selected captured model and displays exact targets", async (source) => {
  const { container } = await renderPanel();
  await selectModel(container);
  const run = [...container.querySelectorAll("button")].find((button) => button.textContent === `Run ${source}`)!;
  await act(async () => run.click());
  await waitFor(() => expect(container.textContent).toContain("Predicted values: 3"));
  expect(container.textContent).toContain("captured REFIT, no training");
  expect(container.querySelector("table")?.textContent).toContain("sample-stable37");
  if (source === "uploaded file") {
    expect(mocks.file).toHaveBeenCalledWith(model.id, "bundle", expect.any(File), { archive_fingerprint: model.archive_fingerprint, output_index: 0, has_header: true });
    expect(mocks.predict).not.toHaveBeenCalled();
  } else {
    expect(mocks.predict).toHaveBeenCalledWith(expect.objectContaining({ model_id: model.id, model_source: "bundle", archive_fingerprint: model.archive_fingerprint,
      ...(source === "pasted spectra" ? { data_source: "array", spectra: [[1, 2]] } : { data_source: "dataset", dataset_id: "held-out", partition: "test" }) }));
    expect(mocks.file).not.toHaveBeenCalled();
  }
});

it("shows service errors and does not retry another prediction route", async () => {
  mocks.predict.mockRejectedValue({ detail: "Captured archive fingerprint changed" });
  const { container } = await renderPanel();
  await selectModel(container);
  await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent === "Run pasted spectra")!.click());
  await waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toContain("fingerprint changed"));
  expect(mocks.predict).toHaveBeenCalledTimes(1);
  expect(mocks.file).not.toHaveBeenCalled();
});

it("drops the selected model when the active workspace changes", async () => {
  const { container, client } = await renderPanel();
  await selectModel(container);
  await act(async () => client.setQueryData(["linked-workspaces", "general-prediction"], { active_workspace_id: "workspace-b", workspaces: [] }));
  await waitFor(() => expect(container.querySelector<HTMLSelectElement>("#general-model")?.value).toBe(""));
  expect([...container.querySelectorAll("button")].find((button) => button.textContent === "Run pasted spectra")?.disabled).toBe(true);
});

it("keeps uploaded labels distinct from execution IDs in the accessible results table", async () => {
  mocks.file.mockResolvedValue({ predictions: [3], prediction_matrix: [[3]], target_names: ["protein"], output_index: 0,
    num_samples: 1, sample_ids: ["execution-stable-id"], sample_labels: ["sample A"], model_name: "Ridge",
    preprocessing_steps: [], metrics: null, actual_values: null });
  const { container } = await renderPanel();
  await selectModel(container);
  await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent === "Run uploaded file")!.click());
  await waitFor(() => expect(container.querySelector("tbody")?.textContent).toContain("execution-stable-idsample A3"));
  expect(container.querySelector("thead")?.textContent).toContain("Execution sample IDUploaded sample labelprotein");
});
