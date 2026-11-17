/** @vitest-environment jsdom */
import { act, createContext, useContext, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import { invalidateLoadedWorkspaceDatasetResults } from "@/api/playground";
import type { Dataset } from "@/types/datasets";
import type { PlaygroundContentProps } from "./PlaygroundSections";
import Playground from "./Playground";

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  pipeline: vi.fn(),
  toastError: vi.fn(),
  catalogue: { data: { datasets: [] as unknown[] }, error: null, isLoading: false, refetch: () => undefined },
}));

vi.mock("@/api/transport", () => ({ api: { post: mocks.post }, formatApiErrorDetail: String }));
vi.mock("@/hooks/useDatasetQueries", () => ({ useDatasetsQuery: () => mocks.catalogue }));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError, success: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/components/layout/MlLoadingOverlay", () => ({ MlLoadingOverlay: ({ children }: { children: ReactNode }) => children }));
vi.mock("./PlaygroundProviders", () => ({ PlaygroundProviders: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/hooks/usePlaygroundPipeline", () => ({
  usePlaygroundPipeline: (_data: unknown, options: unknown) => {
    mocks.pipeline(options);
    return { operators: [], result: null, chartLoadingStates: {} };
  },
}));
// The Playground's own sidebar data panel, plus a probe of the target values
// every target-dependent view (colours, histograms, legends) is drawn from.
vi.mock("./PlaygroundSections", async () => {
  const { DataUpload } = await import("@/components/playground/DataUpload");
  return {
    PlaygroundContent: (props: PlaygroundContentProps) => (
      <>
        <DataUpload data={props.rawData} isLoading={props.dataLoading} error={props.dataError}
          dataSource={props.dataSource} currentDatasetInfo={props.currentDatasetInfo}
          onLoadDemo={props.loadDemoData} onLoadFromWorkspace={props.loadFromWorkspace} onClear={props.clearData} />
        <output data-testid="target-values">{JSON.stringify(props.rawData?.y ?? null)}</output>
      </>
    ),
  };
});
// Radix Select needs pointer capture that jsdom lacks; expose its items as buttons.
vi.mock("@/components/ui/select", () => {
  const Choice = createContext<{ value: string; disabled?: boolean; onValueChange: (value: string) => void } | null>(null);
  return {
    Select: ({ value, disabled, onValueChange, children }: { value: string; disabled?: boolean; onValueChange: (value: string) => void; children: ReactNode }) => (
      <Choice.Provider value={{ value, disabled, onValueChange }}>
        <div role="listbox" data-value={value} aria-disabled={disabled}>{children}</div>
      </Choice.Provider>
    ),
    SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
    SelectValue: () => null,
    SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
    SelectItem: ({ value, children }: { value: string; children: ReactNode }) => {
      const choice = useContext(Choice)!;
      return (
        <button type="button" role="option" aria-selected={choice.value === value} disabled={choice.disabled}
          onClick={() => choice.onValueChange(value)}>{children}</button>
      );
    },
  };
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mais = {
  id: "mais", name: "Mais 2026", path: "/data/mais", linked_at: "", num_samples: 3, num_features: 2,
  train_samples: 3, test_samples: 0, default_target: "cwr_pct_ms",
  targets: [
    { column: "taux_ms_recolte", type: "regression", missing_count: 1 },
    { column: "cwr_pct_ms", type: "regression", missing_count: 2 },
    { column: "ivdmd_pct_ms", type: "regression", missing_count: 0 },
  ],
} as Dataset;
const single = { ...mais, id: "single", name: "Single", default_target: "protein",
  targets: [{ column: "protein", type: "regression", missing_count: 0 }] } as Dataset;
const targetValues: Record<number, Array<number | null>> = { 0: [1, null, 3], 1: [null, null, 6], 2: [7, 8, 9] };

function execution(targetIndex: number) {
  const section = { spectra: [[1, 2], [3, 4], [5, 6]], wavelengths: [1000, 1002], y: targetValues[targetIndex], shape: [3, 2] };
  return { success: true, original: section, processed: section, execution_time_ms: 1, execution_trace: [], step_errors: [] };
}

let root: Root;
let container: HTMLDivElement;
beforeAll(async () => { await i18n.changeLanguage("en"); });
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  invalidateLoadedWorkspaceDatasetResults();
  mocks.catalogue.data = { datasets: [mais, single] };
  mocks.post.mockImplementation(async (_path: string, request: { target_index?: number }) => execution(request.target_index ?? 0));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

async function open(route: string) {
  await act(async () => {
    root.render(<MemoryRouter initialEntries={[route]}><Playground /></MemoryRouter>);
  });
  await act(async () => { await Promise.resolve(); });
}
const options = () => [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')];
const shownTargetValues = () => JSON.parse(container.querySelector('[data-testid="target-values"]')!.textContent!);
const lastRequest = () => mocks.post.mock.calls.at(-1)![1] as { dataset_id: string; target_index?: number };

describe("Playground target selector", () => {
  it("opens a dataset from its detail page on the saved default target, with every target listed", async () => {
    await open("/playground?datasetId=mais&datasetName=Mais%202026");
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(lastRequest()).toMatchObject({ dataset_id: "mais", target_index: 1 });
    expect(options().map(option => option.textContent)).toEqual([
      "taux_ms_recolte — 1 without a value",
      "cwr_pct_ms — 2 without a value",
      "ivdmd_pct_ms",
    ]);
    expect(container.querySelector('[role="listbox"]')?.getAttribute("data-value")).toBe("1");
    expect(shownTargetValues()).toEqual([null, null, 6]);
    expect(mocks.pipeline).toHaveBeenLastCalledWith(expect.objectContaining({ datasetId: "mais", datasetTargetIndex: 1 }));
  });

  it("offers the same selector when the dataset is picked inside the Playground", async () => {
    await open("/playground");
    expect(mocks.post).not.toHaveBeenCalled();
    const pick = [...container.querySelectorAll("button")].find(button => button.textContent?.includes("Mais 2026"))!;
    await act(async () => pick.click());
    await act(async () => { await Promise.resolve(); });
    expect(lastRequest()).toMatchObject({ dataset_id: "mais", target_index: 1 });
    expect(options()).toHaveLength(3);
  });

  it("offers the same selector when a stored session reopens the dataset", async () => {
    sessionStorage.setItem("playground-session-state", JSON.stringify({
      datasetId: "mais", datasetName: "Mais 2026", dataSource: "workspace", savedAt: Date.now(),
    }));
    await open("/playground");
    expect(lastRequest()).toMatchObject({ dataset_id: "mais", target_index: 1 });
    expect(options()).toHaveLength(3);
  });

  it("switches the target without clearing the current view, then shows the new target's values", async () => {
    await open("/playground?datasetId=mais&datasetName=Mais%202026");
    let release!: () => void;
    mocks.post.mockImplementationOnce(async (_path: string, request: { target_index?: number }) => {
      await new Promise<void>(resolve => { release = resolve; });
      return execution(request.target_index ?? 0);
    });
    await act(async () => options()[2].click());
    expect(lastRequest()).toMatchObject({ dataset_id: "mais", target_index: 2 });
    // While loading, the spectra and the previous target stay on screen.
    expect(container.textContent).toContain("Samples3");
    expect(shownTargetValues()).toEqual([null, null, 6]);
    expect(options().every(option => option.disabled)).toBe(true);
    await act(async () => { release(); await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    expect(shownTargetValues()).toEqual([7, 8, 9]);
    expect(container.querySelector('[role="listbox"]')?.getAttribute("data-value")).toBe("2");
    expect(mocks.pipeline).toHaveBeenLastCalledWith(expect.objectContaining({ datasetTargetIndex: 2 }));
    expect(mocks.post).toHaveBeenCalledTimes(2);
  });

  it("keeps the current target when a switch fails and says so", async () => {
    await open("/playground?datasetId=mais&datasetName=Mais%202026");
    mocks.post.mockRejectedValueOnce(new Error("The scientific host stopped"));
    await act(async () => options()[0].click());
    await act(async () => { await Promise.resolve(); });
    expect(mocks.toastError).toHaveBeenCalledWith("Could not show taux_ms_recolte", { description: "The scientific host stopped" });
    expect(shownTargetValues()).toEqual([null, null, 6]);
    expect(container.querySelector('[role="listbox"]')?.getAttribute("data-value")).toBe("1");
  });

  it("names the only target of a single-target dataset without a control", async () => {
    await open("/playground?datasetId=single&datasetName=Single");
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(container.textContent).toContain("Targetprotein");
  });
});
