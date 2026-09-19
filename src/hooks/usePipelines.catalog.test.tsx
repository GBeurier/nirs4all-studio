/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { usePipelines } from "./usePipelines";
import { useNewExperimentInputData } from "./useNewExperimentInputData";

const transport = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
vi.mock("@/api/transport", () => ({ api: transport }));
vi.mock("./useDatasetQueries", () => ({ useDatasetsQuery: () => ({ data: { datasets: [] }, isLoading: false, error: null }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("pipeline catalog shared with Run", () => {
  it("shows an imported pipeline immediately even when Run cached an empty catalog for five minutes", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: 300_000, retry: false } } });
    client.setQueryData(["pipelines"], { pipelines: [] });
    const pipeline = { id: "imported", name: "Imported PLS", steps: [], category: "user", created_at: "2026-09-19", updated_at: "2026-09-19" };
    transport.post.mockResolvedValue({ success: true, pipeline });
    transport.get.mockResolvedValue({ pipelines: [pipeline] });
    let library: ReturnType<typeof usePipelines>;
    let run: ReturnType<typeof useNewExperimentInputData>;
    function Probe() {
      library = usePipelines({ autoFetch: false });
      run = useNewExperimentInputData();
      return <div>{run.pipelines.map(item => <span key={item.id}>{item.name}</span>)}</div>;
    }
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () => { root.render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>); });
      expect(transport.get).not.toHaveBeenCalled();
      expect(container.textContent).toBe("");
      await act(async () => {
        await library!.importPipeline(JSON.stringify({ name: "Imported PLS", steps: [] }));
        await new Promise(resolve => setTimeout(resolve, 0));
      });
      expect(container.textContent).toBe("Imported PLS");
      expect(run!.rawPipelines.map(item => item.id)).toEqual(["imported"]);
    } finally {
      await act(async () => { root.unmount(); });
      client.clear();
    }
  });
});
