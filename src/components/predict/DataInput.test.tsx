/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/useDatasetQueries", () => ({ useDatasetsQuery: () => ({ data: { datasets: [
  { id: "flat", name: "Flat", path: "/flat" },
  { id: "typed", name: "Typed", path: "/typed", config: { dataset_document: {
    schema: "nirs4all.studio-multimodal-dataset.v1", cohort: {
      schema: "nirs4all.multimodal-dataset", schema_version: 1, sample_ids: ["s1"],
      sources: [{ name: "nir", sample_ids: ["s1"], representation_id: "signal_1d", array: { shape: [1, 2] } }],
      partitions: { values: ["predict"] },
    },
  } } },
] } }) }));

import { DataInput } from "./DataInput";
import type { AvailableModel } from "@/types/predict";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); cleanup = undefined; });

it("shows only compatible linked cohorts and the dataset tab for a multimodal archive", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  cleanup = async () => { await act(async () => root.unmount()); container.remove(); };
  const model = { id: "exports/model.n4a", name: "Multimodal", source: "bundle", model_class: "Ridge",
    dataset_name: null, metric: null, best_score: null, created_at: null, file_size: 12,
    preprocessing: null, bundle_path: "exports/model.n4a", input_kind: "multimodal" } as AvailableModel;
  await act(async () => root.render(<DataInput model={model} isLoading={false} onRunPrediction={vi.fn()} />));
  expect(container.querySelectorAll('[role="tab"]')).toHaveLength(1);
  expect(container.textContent).toContain("predict.input.linkedMultimodalDatasets");
  expect(container.textContent).not.toContain("predict.data.tabs.upload");
  expect(container.textContent).not.toContain("predict.data.tabs.paste");
  expect([...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("predict.data.runPrediction"))?.disabled).toBe(true);
});
