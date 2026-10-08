/** @vitest-environment jsdom */
import { StrictMode, act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Routes, Route, useNavigate, useSearchParams } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useNewExperimentSelectionFlow } from "@/hooks/useNewExperimentSelectionFlow";
import { mergeExperimentPipelineSources, type NewExperimentInputData } from "@/hooks/useNewExperimentInputData";
import type { PipelineInfo } from "@/api/pipelines";
import { toExperimentPipelineOption, CURRENT_EDITED_PIPELINE_ID } from "@/lib/experimentPipelineSelection";
import { storeCurrentEditedPipelineHandoffInClientStorage } from "@/lib/pipelineExperimentHandoff";
import { clientStorageKeys, removeClientStorageItem } from "@/lib/clientStorage";
import { NewExperimentPipelineStepPanel } from "./NewExperimentStepContentPanels";

vi.mock("sonner", () => ({ toast: { info: vi.fn() } }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => removeClientStorageItem(clientStorageKeys.currentEditedPipeline));

const pipeline: PipelineInfo = {
  id: "preset", name: "PLS preset", category: "preset",
  steps: [{ id: "pls", type: "model", name: "PLSRegression", params: {} }],
  created_at: "2026-10-08", updated_at: "2026-10-08",
};

describe("Run pipeline route selection", () => {
  it.each([
    ["loading", true, null],
    ["empty", false, null],
    ["unavailable", false, new Error("Saved catalog unavailable")],
  ])("shows the selected editor draft while the saved catalog is %s", async (_label, loading, error) => {
    storeCurrentEditedPipelineHandoffInClientStorage({ name: "My draft", steps: pipeline.steps, isDirty: true, timestamp: 1 });
    await verifySelectedPipeline("/editor?source=editor", [], Boolean(loading), error, CURRENT_EDITED_PIPELINE_ID);
  });

  it("selects a preset from its URL", async () => {
    await verifySelectedPipeline("/editor?pipeline=preset", [pipeline], false, null, pipeline.id);
  });

  it("selects a history identity even when its steps match a saved preset", async () => {
    const history = { ...pipeline, id: "history:pls", name: "Historical PLS", source: "history" as const };
    await verifySelectedPipeline("/editor?pipeline=history%3Apls", mergeExperimentPipelineSources([pipeline], [history]), false, null, history.id);
  });
});

async function verifySelectedPipeline(route: string, rawPipelines: PipelineInfo[], loading: boolean, error: unknown, selectedId: string) {
  const inputData: NewExperimentInputData = {
    datasets: [], rawDatasets: [], datasetsError: null, isLoadingDatasets: false,
    pipelines: rawPipelines.map(toExperimentPipelineOption), rawPipelines,
    isLoadingPipelines: loading, pipelineError: error,
  };
  function Probe() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const selectionFlow = useNewExperimentSelectionFlow({
      savedPipelineOptions: inputData.pipelines, rawPipelines, searchParams,
      onEditorRedirect: () => navigate("/editor", { replace: true }),
    });
    return <NewExperimentPipelineStepPanel
      inputData={inputData}
      selectionFlow={selectionFlow}
      filteredInputs={{ filteredDatasets: [], filteredPipelines: selectionFlow.allPipelineOptions }}
    />;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(<StrictMode><MemoryRouter initialEntries={[route]}><Routes>
        <Route path="/editor" element={<Probe />} />
      </Routes></MemoryRouter></StrictMode>);
    });
    const selected = container.querySelector(`[data-experiment-pipeline-id="${selectedId}"] [role="checkbox"]`);
    expect(selected).not.toBeNull();
    expect(selected!.getAttribute("aria-checked")).toBe("true");
    expect(container.textContent).not.toContain("No pipelines");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
}
