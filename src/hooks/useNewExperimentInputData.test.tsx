/**
 * @vitest-environment jsdom
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PipelineInfo } from "@/api/pipelines";
import { toExperimentDatasetOption } from "@/lib/experimentDatasetOptions";
import type { ExperimentPipelineOption } from "@/lib/experimentPipelineSelection";
import type { Dataset } from "@/types/datasets";

const queryMocks = vi.hoisted(() => ({
  datasetsQuery: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("@/hooks/useDatasetQueries", () => ({
  useDatasetsQuery: queryMocks.datasetsQuery,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: queryMocks.useQuery,
}));

import { useNewExperimentFilteredInputs, useNewExperimentInputData } from "./useNewExperimentInputData";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

async function renderHook<T>(hook: () => T) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const result: { current: T | undefined } = { current: undefined };

  function TestComponent() {
    result.current = hook();
    return null;
  }

  await act(async () => {
    root.render(<TestComponent />);
  });

  return {
    result,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function dataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    id: "d1",
    name: "Corn",
    path: "/data/corn",
    linked_at: "2026-01-01T00:00:00",
    num_samples: 42,
    num_features: 128,
    default_target: "protein",
    metadata_columns: ["batch"],
    config: {
      delimiter: ",",
      decimal_separator: ".",
      has_header: true,
      repetition: "sample_id",
    },
    ...overrides,
  };
}

function pipeline(overrides: Partial<PipelineInfo> = {}): PipelineInfo {
  return {
    id: "p1",
    name: "PLS Pipeline",
    category: "custom",
    is_favorite: false,
    steps: [{ id: "model", name: "PLS", type: "model", params: {} }],
    created_at: "2026-01-01T00:00:00",
    updated_at: "2026-01-01T00:00:00",
    ...overrides,
  };
}

function pipelineOption(
  overrides: Partial<ExperimentPipelineOption> & Pick<ExperimentPipelineOption, "id" | "name">,
): ExperimentPipelineOption {
  return {
    preset: false,
    favorite: false,
    steps: "",
    nodeCount: 0,
    activeNodeCount: 0,
    disabledNodeCount: 0,
    branchCount: 0,
    generatorCount: 0,
    stepGeneratorCount: 0,
    parameterSweepCount: 0,
    finetuneNodeCount: 0,
    refitNodeCount: 0,
    maxDepth: 0,
    ...overrides,
  };
}

afterEach(() => {
  queryMocks.datasetsQuery.mockReset();
  queryMocks.useQuery.mockReset();
});

describe("useNewExperimentInputData", () => {
  it("loads and normalizes dataset and pipeline options for the wizard", async () => {
    queryMocks.datasetsQuery.mockReturnValue({
      data: { datasets: [dataset()] },
      isLoading: false,
      error: null,
    });
    queryMocks.useQuery.mockReturnValue({
      data: { pipelines: [pipeline({ category: "preset", is_favorite: true })] },
      isLoading: false,
      error: null,
    });

    const mounted = await renderHook(() => useNewExperimentInputData());

    expect(queryMocks.useQuery).toHaveBeenCalledWith(expect.objectContaining({
      queryKey: ["pipelines"],
    }));
    expect(mounted.result.current!.rawDatasets).toHaveLength(1);
    expect(mounted.result.current!.datasets[0]).toMatchObject({
      id: "d1",
      name: "Corn",
      samples: 42,
      target: "protein",
      repetitionColumn: "sample_id",
    });
    expect(mounted.result.current!.rawPipelines).toHaveLength(1);
    expect(mounted.result.current!.pipelines[0]).toMatchObject({
      id: "p1",
      name: "PLS Pipeline",
      preset: true,
      favorite: true,
      steps: "PLS",
    });

    await mounted.unmount();
  });

  it("keeps loading and error state attached to the input read model", async () => {
    const datasetError = new Error("datasets unavailable");
    const pipelineError = new Error("pipelines unavailable");
    queryMocks.datasetsQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: datasetError,
    });
    queryMocks.useQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: pipelineError,
    });

    const mounted = await renderHook(() => useNewExperimentInputData());

    expect(mounted.result.current).toMatchObject({
      datasets: [],
      datasetsError: datasetError,
      isLoadingDatasets: true,
      isLoadingPipelines: true,
      pipelineError,
      pipelines: [],
      rawDatasets: [],
      rawPipelines: [],
    });

    await mounted.unmount();
  });
});

describe("useNewExperimentFilteredInputs", () => {
  it("filters dataset and pipeline options for the selection steps", async () => {
    const datasets = [
      toExperimentDatasetOption(dataset()),
      toExperimentDatasetOption(dataset({
        id: "d2",
        name: "Wheat",
        num_samples: 30,
        num_features: 64,
        default_target: "moisture",
      })),
    ];
    const mounted = await renderHook(() => useNewExperimentFilteredInputs({
      allPipelineOptions: [
        pipelineOption({
          id: "p1",
          name: "PLS Pipeline",
          favorite: true,
          steps: "SNV PLS",
          nodeCount: 2,
          activeNodeCount: 2,
        }),
        pipelineOption({
          id: "p2",
          name: "Random Forest",
          preset: true,
          steps: "RF",
          nodeCount: 1,
          activeNodeCount: 1,
        }),
      ],
      datasetSearch: "whe",
      datasets,
      pipelineFilter: "favorites",
      pipelineSearch: "pls",
    }));

    expect(mounted.result.current!.filteredDatasets.map((entry) => entry.id)).toEqual(["d2"]);
    expect(mounted.result.current!.filteredPipelines.map((entry) => entry.id)).toEqual(["p1"]);

    await mounted.unmount();
  });
});
