/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ModelSelector } from "./ModelSelector";
import { readPersistedArchiveV2Selection } from "@/lib/archiveV2Selection";

vi.mock("@/api/linkedWorkspaces", () => ({
  getLinkedWorkspaces: vi.fn(async () => ({ workspaces: [], active_workspace_id: "workspace-a", total: 1 })),
}));
vi.mock("@/api/archiveV2Prediction", () => ({
  getPersistedArchiveV2Catalogue: vi.fn(async () => ({
    schema_version: 1, operation: "archive_v2_catalogue", workspace_id: "workspace-a",
    archives: [{ archive_id: "archive-a", archive_ref: "artifacts/model.n4a", archive_sha256: "a".repeat(64), n_features: 2, target_names: ["protein", "moisture"], descriptor_fingerprint: "b".repeat(64), identity_status: "verified" }],
  })),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let cleanup: (() => Promise<void>) | null = null;

async function renderSelector(onSelect: ReturnType<typeof vi.fn>) {
  const container = document.createElement("div"); document.body.appendChild(container);
  const root = createRoot(container); const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cleanup = async () => { await act(async () => root.unmount()); client.clear(); container.remove(); };
  await act(async () => { root.render(<QueryClientProvider client={client}><ModelSelector selectedModel={null} onSelect={onSelect} /></QueryClientProvider>); });
  // Workspace and catalogue queries render in separate notifications. Await
  // the observable result, not a fixed delay that races under the full suite.
  await vi.waitFor(async () => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(Array.from(container.querySelectorAll("button")).some((button) => button.textContent?.includes("archive-a"))).toBe(true);
  });
  return container;
}

beforeEach(() => localStorage.clear());
afterEach(async () => { await cleanup?.(); cleanup = null; vi.clearAllMocks(); });

describe("Archive V2 ModelSelector catalogue", () => {
  it("selects and persists only a Core-verified catalogue entry", async () => {
    const onSelect = vi.fn(); const container = await renderSelector(onSelect);
    const entry = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("archive-a"))!;
    expect(entry).toBeTruthy();
    await act(async () => entry.click());
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ archive_ref: "artifacts/model.n4a", n_features: 2, target_names: ["protein", "moisture"] }));
    expect(readPersistedArchiveV2Selection()?.archive_sha256).toBe("a".repeat(64));
    expect(container.querySelector("input")).toBeNull();
  });

  it("clears a stale persisted identity absent from the current catalogue", async () => {
    localStorage.setItem("nirs4all:predict:archive-v2-selection", JSON.stringify({ schema_version: 1, kind: "persisted_archive_v2", workspace_id: "workspace-a", archive_ref: "artifacts/moved.n4a", archive_sha256: "c".repeat(64), n_features: 2, target_names: ["protein"] }));
    await renderSelector(vi.fn());
    expect(readPersistedArchiveV2Selection()).toBeNull();
  });
});
