/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataUpload } from "../DataUpload";

const query = vi.hoisted(() => ({
  data: { datasets: [] as unknown[] },
  error: { detail: "Dataset catalogue is unavailable", status: 503 },
  isLoading: false,
  refetch: vi.fn(),
}));
vi.mock("@/hooks/useDatasetQueries", () => ({ useDatasetsQuery: () => query }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  query.data = { datasets: [] };
  query.refetch.mockReset();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(onLoadFromWorkspace = vi.fn()) {
  await act(async () => root.render(<DataUpload data={null} isLoading={false} error={null}
    dataSource={null} currentDatasetInfo={null} onLoadDemo={vi.fn()}
    onLoadFromWorkspace={onLoadFromWorkspace} onClear={vi.fn()} />));
}

describe("Playground dataset errors", () => {
  it("shows the actual catalogue error and allows a retry", async () => {
    await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(query.error.detail);
    expect(container.textContent).not.toContain("No workspace connected");
    await act(async () => [...container.querySelectorAll("button")]
      .find(button => button.textContent?.includes("Retry loading datasets"))!.click());
    expect(query.refetch).toHaveBeenCalledOnce();
  });

  it("keeps cached datasets selectable after a background fetch fails", async () => {
    query.data = { datasets: [{ id: "cached", name: "Cached spectra", path: "/data",
      num_samples: 10, num_features: 5, train_samples: 10, test_samples: 0 }] };
    const onLoad = vi.fn();
    await render(onLoad);
    const cached = [...container.querySelectorAll("button")]
      .find(button => button.textContent?.includes("Cached spectra"));
    expect(cached).toBeDefined();
    await act(async () => cached!.click());
    expect(onLoad).toHaveBeenCalledWith("cached", "Cached spectra", "all", expect.any(Object));
  });
});
