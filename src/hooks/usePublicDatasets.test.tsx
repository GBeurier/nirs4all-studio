/**
 * @vitest-environment jsdom
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PublicDataset, PublicDatasetImportSnapshot } from "@/api/public-datasets";

const mocks = vi.hoisted(() => ({
  startPublicDatasetImport: vi.fn(),
  getPublicDatasetImport: vi.fn(),
  cancelPublicDatasetImport: vi.fn(),
  publishLinkedDataset: vi.fn(),
  invalidateDatasets: vi.fn(),
}));

vi.mock("@/api/public-datasets", () => ({
  listPublicDatasets: vi.fn(),
  startPublicDatasetImport: mocks.startPublicDatasetImport,
  getPublicDatasetImport: mocks.getPublicDatasetImport,
  cancelPublicDatasetImport: mocks.cancelPublicDatasetImport,
}));

vi.mock("./useDatasetQueries", () => ({
  useInvalidateDatasets: () => mocks.invalidateDatasets,
  usePublishLinkedDataset: () => mocks.publishLinkedDataset,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

import {
  filterPublicDatasets,
  resolvePublicDatasetSource,
  usePublicDatasetImport,
} from "./usePublicDatasets";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

type Hook = ReturnType<typeof usePublicDatasetImport>;
type Props = { workspaceId: string | null; workspacePath: string | null };

let cleanup: (() => Promise<void>) | undefined;

async function renderImportHook(initial: Props) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const result: { current: Hook | undefined } = { current: undefined };
  function TestComponent(props: Props) {
    result.current = usePublicDatasetImport(props);
    return null;
  }
  await act(async () => root.render(<TestComponent {...initial} />));
  cleanup = async () => {
    await act(async () => root.unmount());
    container.remove();
  };
  return {
    result: result as { current: Hook },
    rerender: async (props: Props) => act(async () => root.render(<TestComponent {...props} />)),
    unmount: cleanup,
  };
}

async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

function snapshot(overrides: Partial<PublicDatasetImportSnapshot>): PublicDatasetImportSnapshot {
  return {
    id: "job-1",
    status: "running",
    progress: null,
    progress_message: "",
    error: null,
    result: null,
    ...overrides,
  };
}

const importedDataset = {
  id: "ds-imported",
  name: "Corn",
  path: "/ws/datasets/corn",
  linked_at: "2026-11-19T00:00:00",
};

function catalogEntry(overrides: Partial<PublicDataset>): PublicDataset {
  return {
    id: "corn",
    name: "Corn",
    domain: "agriculture",
    spectro_family: "NIR",
    n_samples: 80,
    n_features_total: 700,
    n_targets: 4,
    n_sources: 1,
    source_ids: ["m5"],
    license: "CC-BY-4.0",
    targets: ["moisture"],
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.startPublicDatasetImport.mockResolvedValue({ job_id: "job-1", status: "pending" });
});

afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("public dataset helpers", () => {
  it("searches by name, id and domain", () => {
    const entries = [
      catalogEntry({ id: "corn", name: "Corn", domain: "agriculture" }),
      catalogEntry({ id: "tablets", name: "Pharma tablets", domain: "pharmaceutical" }),
    ];
    expect(filterPublicDatasets(entries, "TABLET").map((d) => d.id)).toEqual(["tablets"]);
    expect(filterPublicDatasets(entries, "agri").map((d) => d.id)).toEqual(["corn"]);
    expect(filterPublicDatasets(entries, "  ")).toHaveLength(2);
  });

  it("requires an explicit source when there are several and defaults a single one", () => {
    const multi = catalogEntry({ n_sources: 3, source_ids: ["m5", "mp5", "mp6"] });
    expect(resolvePublicDatasetSource(multi, null)).toEqual({ required: true, sourceId: undefined, ready: false });
    expect(resolvePublicDatasetSource(multi, "other")).toMatchObject({ ready: false });
    expect(resolvePublicDatasetSource(multi, "mp5")).toEqual({ required: true, sourceId: "mp5", ready: true });
    expect(resolvePublicDatasetSource(catalogEntry({}), null))
      .toEqual({ required: false, sourceId: "m5", ready: true });
  });
});

describe("usePublicDatasetImport", () => {
  it("polls serially and publishes the completed dataset once", async () => {
    let resolveFirst: (value: PublicDatasetImportSnapshot) => void = () => {};
    mocks.getPublicDatasetImport
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(snapshot({ status: "running", progress: 40, progress_message: "Downloading" }))
      .mockResolvedValue(snapshot({ status: "completed", result: { success: true, dataset: importedDataset } }));
    const { result } = await renderImportHook({ workspaceId: "ws-1", workspacePath: "/ws" });

    await act(async () => { await result.current.start("corn", "m5"); });
    expect(mocks.startPublicDatasetImport).toHaveBeenCalledWith({ dataset_id: "corn", source_id: "m5" });
    expect(mocks.getPublicDatasetImport).toHaveBeenCalledTimes(1);

    // No overlapping request while the first poll is outstanding.
    await advance(5000);
    expect(mocks.getPublicDatasetImport).toHaveBeenCalledTimes(1);

    await act(async () => resolveFirst(snapshot({ status: "pending" })));
    await advance(1000);
    expect(result.current.state).toMatchObject({ phase: "running", progress: 40, progressMessage: "Downloading" });

    await advance(1000);
    expect(result.current.state.phase).toBe("completed");
    expect(result.current.state.dataset).toEqual(importedDataset);
    await advance(5000);
    expect(mocks.publishLinkedDataset).toHaveBeenCalledTimes(1);
    expect(mocks.publishLinkedDataset).toHaveBeenCalledWith(importedDataset);
    expect(mocks.getPublicDatasetImport).toHaveBeenCalledTimes(3);
  });

  it("refuses to submit without a workspace and ignores duplicate submits", async () => {
    mocks.getPublicDatasetImport.mockReturnValue(new Promise(() => {}));
    const { result, rerender } = await renderImportHook({ workspaceId: null, workspacePath: null });
    await act(async () => { await result.current.start("corn"); });
    expect(mocks.startPublicDatasetImport).not.toHaveBeenCalled();
    expect(result.current.state.error).toMatch(/workspace/i);

    await rerender({ workspaceId: "ws-1", workspacePath: "/ws" });
    await act(async () => {
      void result.current.start("corn");
      void result.current.start("corn");
    });
    expect(mocks.startPublicDatasetImport).toHaveBeenCalledTimes(1);
    expect(mocks.startPublicDatasetImport).toHaveBeenCalledWith({ dataset_id: "corn" });
  });

  it("requests cancellation and keeps polling until the job is cancelled", async () => {
    mocks.cancelPublicDatasetImport.mockResolvedValue({ cancellation_requested: true });
    mocks.getPublicDatasetImport
      .mockResolvedValueOnce(snapshot({ status: "running" }))
      .mockResolvedValueOnce(snapshot({ status: "running", cancellation_requested: true }))
      .mockResolvedValue(snapshot({ status: "cancelled" }));
    const { result } = await renderImportHook({ workspaceId: "ws-1", workspacePath: "/ws" });
    await act(async () => { await result.current.start("corn"); });

    await act(async () => { await result.current.cancel(); });
    expect(mocks.cancelPublicDatasetImport).toHaveBeenCalledWith("job-1");
    expect(result.current.state).toMatchObject({ phase: "running", cancelRequested: true });

    await advance(2000);
    expect(result.current.state.phase).toBe("cancelled");
    expect(mocks.publishLinkedDataset).not.toHaveBeenCalled();
  });

  it("reports a failed job and a lost status connection honestly", async () => {
    mocks.getPublicDatasetImport.mockResolvedValueOnce(snapshot({ status: "failed", error: "Download refused" }));
    const { result } = await renderImportHook({ workspaceId: "ws-1", workspacePath: "/ws" });
    await act(async () => { await result.current.start("corn"); });
    expect(result.current.state).toMatchObject({ phase: "failed", error: "Download refused" });

    mocks.startPublicDatasetImport.mockResolvedValueOnce({ job_id: "job-2", status: "running" });
    mocks.getPublicDatasetImport.mockRejectedValue(new Error("socket closed"));
    await act(async () => { await result.current.start("corn"); });
    await advance(1000);
    await advance(2000);
    expect(mocks.getPublicDatasetImport).toHaveBeenCalledTimes(4);
    expect(result.current.state.phase).toBe("disconnected");
    expect(result.current.state.error).toContain("socket closed");
  });

  it("does not publish into a workspace selected after submission", async () => {
    let finish: (value: PublicDatasetImportSnapshot) => void = () => {};
    mocks.getPublicDatasetImport.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { result, rerender } = await renderImportHook({ workspaceId: "ws-1", workspacePath: "/ws1" });
    await act(async () => { await result.current.start("corn"); });

    await rerender({ workspaceId: "ws-2", workspacePath: "/ws2" });
    expect(result.current.state).toMatchObject({ phase: "pending", workspaceId: "ws-1", workspacePath: "/ws1" });

    await act(async () => finish(snapshot({ status: "completed", result: { success: true, dataset: importedDataset } })));
    expect(result.current.state.phase).toBe("completed");
    expect(mocks.publishLinkedDataset).not.toHaveBeenCalled();
    expect(mocks.invalidateDatasets).toHaveBeenCalledTimes(1);

    // The terminal outcome belongs to ws-1 and is cleared on the next switch.
    await rerender({ workspaceId: "ws-3", workspacePath: "/ws3" });
    expect(result.current.state.phase).toBe("idle");
  });

  it("stops polling on unmount", async () => {
    mocks.getPublicDatasetImport.mockResolvedValue(snapshot({ status: "running" }));
    const { result, unmount } = await renderImportHook({ workspaceId: "ws-1", workspacePath: "/ws" });
    await act(async () => { await result.current.start("corn"); });
    expect(mocks.getPublicDatasetImport).toHaveBeenCalledTimes(1);
    await unmount();
    cleanup = undefined;
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(mocks.getPublicDatasetImport).toHaveBeenCalledTimes(1);
  });
});
