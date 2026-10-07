/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ link: vi.fn(), list: vi.fn(), workspaces: vi.fn(), scores: vi.fn() }));
vi.mock("@/api/datasets", () => ({ linkDataset: mocks.link, listDatasets: mocks.list, getDatasetScores: mocks.scores }));
vi.mock("@/api/linkedWorkspaces", () => ({ getLinkedWorkspaces: mocks.workspaces }));
vi.mock("@/api/workspace", () => ({}));
vi.mock("@/context/useMlReadiness", () => ({ useMlReadiness: () => ({ workspaceReady: true }) }));
import { useDatasetCatalogActions } from "./useDatasetCatalogActions";
import { useDatasetsQuery, useLinkedWorkspacesQuery, useDatasetScoresQuery } from "./useDatasetQueries";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
async function flush() { await act(async () => { await new Promise(r => setTimeout(r, 15)); }); }
const persisted = { id: "persisted", name: "Server name", path: "/owned/data", created_at: "2026-10-07", num_samples: 1000, num_features: 256 };
const existing = { id: "existing", name: "Existing", path: "/owned/previous", linked_at: "2026-10-06" };
const group = { id: "retained", name: "Retained group", dataset_ids: ["existing"], created_at: "2026-10-06" };
const baseline = { datasets: [existing], groups: [group], total: 1 };
const clients: QueryClient[] = [];
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  await act(async () => { for (const root of roots.splice(0)) root.unmount(); });
  for (const client of clients.splice(0)) client.clear();
  document.body.innerHTML = ""; localStorage.clear(); vi.restoreAllMocks();
  Object.values(mocks).forEach(mock => mock.mockReset());
});
async function mount() {
  mocks.list.mockResolvedValue(baseline); mocks.workspaces.mockResolvedValue({ workspaces: [] }); mocks.scores.mockResolvedValue({ datasets: [] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  const result = {} as { actions: ReturnType<typeof useDatasetCatalogActions>; list: ReturnType<typeof useDatasetsQuery> };
  function Harness() {
    result.list = useDatasetsQuery(); useLinkedWorkspacesQuery(); useDatasetScoresQuery("owned-workspace");
    result.actions = useDatasetCatalogActions([group]); return null;
  }
  const container = document.createElement("div"); document.body.appendChild(container); const root = createRoot(container); roots.push(root);
  await act(async () => { root.render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>); });
  await flush();
  return { result, client, root };
}
it("waits for the real mutation, then shows its server record without waiting for slow refetches", async () => {
  const { result } = await mount();
  const commit = deferred<{success: boolean; dataset: typeof persisted}>();
  const list = deferred<typeof baseline>(); const workspaces = deferred<{workspaces: never[]}>(); const scores = deferred<{datasets: never[]}>();
  mocks.link.mockReturnValue(commit.promise); mocks.list.mockReturnValue(list.promise); mocks.workspaces.mockReturnValue(workspaces.promise); mocks.scores.mockReturnValue(scores.promise);
  let settled = false; const mutation = result.actions.addDataset("/owned/data").then(() => { settled = true; });
  await flush(); expect(settled).toBe(false); expect(result.list.data?.datasets).toEqual([existing]);
  commit.resolve({success: true, dataset: persisted}); await mutation; await flush();
  expect(settled).toBe(true);
  expect(result.list.data?.datasets.find(entry => entry.id === persisted.id)).toMatchObject(persisted);
  expect(result.list.data?.datasets.map(entry => entry.id)).toEqual(["existing", "persisted"]);
  expect(result.list.data?.groups).toEqual([group]); expect(result.list.data?.total).toBe(2);
  expect(localStorage.getItem("n4a:cache:datasets:list")).toBe(null);
  list.resolve({ datasets: [existing, { ...persisted, linked_at: persisted.created_at }], groups: [group], total: 2 });
  workspaces.resolve({workspaces: []}); scores.resolve({datasets: []}); await flush();
  expect(result.list.data?.datasets).toHaveLength(2);
});
it.each(["transport", "semantic"])("keeps rejected %s mutations from publishing a record or clearing caches", async kind => {
  const { result } = await mount(); const before = localStorage.getItem("n4a:cache:datasets:list"); expect(before).not.toBe(null);
  if (kind === "transport") mocks.link.mockRejectedValue(new Error("Persist refused")); else mocks.link.mockResolvedValue({success: false, dataset: persisted});
  await expect(result.actions.addDataset("/owned/data")).rejects.toThrow(kind === "transport" ? "Persist refused" : "Failed to link dataset");
  expect(result.list.data?.datasets).toEqual([existing]); expect(localStorage.getItem("n4a:cache:datasets:list")).toBe(before);
  expect(mocks.list).toHaveBeenCalledTimes(1);
});
it("observes failed background refresh while retaining the committed row and query error", async () => {
  const { result } = await mount(); const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const error = new Error("Catalogue offline after commit");
  mocks.link.mockResolvedValue({success: true, dataset: persisted}); mocks.list.mockRejectedValue(error); mocks.workspaces.mockRejectedValue(error); mocks.scores.mockRejectedValue(error);
  await result.actions.addDataset("/owned/data"); await flush();
  expect(result.list.isError).toBe(true); expect(result.list.error).toBe(error);
  expect(result.list.data?.datasets.find(entry => entry.id === persisted.id)).toMatchObject(persisted);
  expect(result.list.data?.groups).toEqual([group]);
  expect(localStorage.getItem("n4a:cache:datasets:list")).toBe(null);
  expect(warning).toHaveBeenCalledWith("Linked dataset saved; catalogue refresh failed", error);
});
it("rejects a success response without a persisted identity before altering the catalogue", async () => {
  const { result } = await mount(); mocks.link.mockResolvedValue({success: true, dataset: {name: "Unidentified"}});
  await expect(result.actions.addDataset("/owned/data")).rejects.toThrow("persisted identity");
  expect(result.list.data?.datasets).toEqual([existing]); expect(mocks.list).toHaveBeenCalledTimes(1);
});
it("discards a stale pre-commit list response and keeps one authoritative row", async () => {
  const { result, client } = await mount(); const stale = deferred<typeof baseline>(); const fresh = deferred<typeof baseline>();
  mocks.list.mockReturnValueOnce(stale.promise).mockReturnValue(fresh.promise);
  const oldFetch = client.invalidateQueries({queryKey: ["datasets", "list"]}); await flush();
  mocks.link.mockResolvedValue({success: true, dataset: persisted}); await result.actions.addDataset("/owned/data"); await flush();
  stale.resolve(baseline); await flush();
  expect(result.list.data?.datasets.find(entry => entry.id === persisted.id)).toMatchObject(persisted);
  fresh.resolve({datasets: [existing, {...persisted, linked_at: persisted.created_at}], groups: [group], total: 2}); await oldFetch; await flush();
  expect(result.list.data?.datasets.map(entry => entry.id)).toEqual(["existing", "persisted"]);
});
it("settles a committed link before unmount and safely observes cancelled refreshes", async () => {
  const { result, client, root } = await mount();
  const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  mocks.link.mockResolvedValue({success: true, dataset: persisted});
  mocks.list.mockReturnValue(deferred<typeof baseline>().promise);
  mocks.workspaces.mockReturnValue(deferred<{workspaces: never[]}>().promise);
  mocks.scores.mockReturnValue(deferred<{datasets: never[]}>().promise);
  await result.actions.addDataset("/owned/data");
  await act(async () => root.unmount()); roots.splice(roots.indexOf(root), 1);
  client.clear(); await flush();
  expect(warning).not.toHaveBeenCalled();
});

it.each(["id", "path", "name"])("rejects blank %s identities and permits a later authoritative link", async field => {
  const { result } = await mount();
  const before = localStorage.getItem("n4a:cache:datasets:list");
  mocks.link.mockResolvedValue({success: true, dataset: {...persisted, [field]: " \t\n "}});
  await expect(result.actions.addDataset("/owned/data")).rejects.toThrow("persisted identity");
  expect(result.list.data?.datasets).toEqual([existing]);
  expect(result.list.data?.groups).toEqual([group]);
  expect(localStorage.getItem("n4a:cache:datasets:list")).toBe(before);
  expect(mocks.list).toHaveBeenCalledTimes(1);
  mocks.link.mockResolvedValue({success: true, dataset: persisted});
  mocks.list.mockReturnValue(deferred<typeof baseline>().promise);
  await result.actions.addDataset("/owned/data"); await flush();
  expect(result.list.data?.datasets.map(entry => entry.id)).toEqual(["existing", "persisted"]);
  expect(result.list.data?.groups).toEqual([group]);
  expect(localStorage.getItem("n4a:cache:datasets:list")).toBe(null);
});
