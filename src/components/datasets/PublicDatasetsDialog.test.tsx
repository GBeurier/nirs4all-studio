/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import type { PublicDataset } from "@/api/public-datasets";
import type { PublicDatasetImportController, PublicDatasetImportState } from "@/hooks/usePublicDatasets";

const catalog = vi.hoisted(() => ({ datasets: [] as PublicDataset[] }));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/utils/fileDialogs", () => ({ openExternal: vi.fn() }));
vi.mock("@/hooks/usePublicDatasets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/usePublicDatasets")>()),
  usePublicDatasetCatalog: () => ({
    data: { datasets: catalog.datasets, version: "2026.11" },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

import { PublicDatasetsDialog } from "./PublicDatasetsDialog";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); cleanup = undefined; });

function entry(overrides: Partial<PublicDataset>): PublicDataset {
  return {
    id: "corn",
    name: "Corn",
    domain: "agriculture",
    spectro_family: "NIR",
    n_samples: 80,
    n_features_total: 700,
    n_targets: 4,
    n_sources: 3,
    source_ids: ["m5", "mp5", "mp6"],
    license: "CC-BY-4.0",
    targets: ["moisture", "oil", "protein", "starch"],
    ...overrides,
  };
}

const idleState: PublicDatasetImportState = {
  phase: "idle",
  jobId: null,
  publicDatasetId: null,
  sourceId: null,
  workspaceId: null,
  workspacePath: null,
  progress: null,
  progressMessage: "",
  cancelRequested: false,
  error: null,
  dataset: null,
};

function controller(state: Partial<PublicDatasetImportState> = {}): PublicDatasetImportController {
  return {
    state: { ...idleState, ...state },
    start: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn(),
    reset: vi.fn(),
  };
}

async function render(importer: PublicDatasetImportController, workspaceId: string | null) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  cleanup = async () => { await act(async () => root.unmount()); container.remove(); };
  await act(async () => root.render(
    <PublicDatasetsDialog open onOpenChange={vi.fn()} workspaceId={workspaceId} importer={importer} />,
  ));
}

function button(label: string): HTMLButtonElement {
  const match = [...document.querySelectorAll("button")].find((el) => el.textContent?.includes(label));
  if (!match) throw new Error(`No button labelled ${label}`);
  return match;
}

async function typeSearch(value: string) {
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Search public datasets"]')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("searches the public list and links each dataset page", async () => {
  catalog.datasets = [entry({}), entry({ id: "tablets", name: "Pharma tablets", domain: "pharmaceutical", n_sources: 1, source_ids: ["nir"] })];
  await render(controller(), "ws-1");
  expect(document.body.textContent).toContain("Pharma tablets");
  const link = document.querySelector<HTMLAnchorElement>('a[href="https://datasets.nirs4all.org/dataset/corn.html"]');
  expect(link).not.toBeNull();

  await typeSearch("pharma");
  expect(document.body.textContent).toContain("Pharma tablets");
  expect(document.querySelectorAll("ul[aria-label='Public datasets'] > li")).toHaveLength(1);
});

it("requires a source choice for multi-source datasets before importing", async () => {
  catalog.datasets = [entry({})];
  const importer = controller();
  await render(importer, "ws-1");
  await act(async () => button("Corn").click());
  expect(button("Download and add").disabled).toBe(true);

  const radio = document.querySelector<HTMLButtonElement>("#public-dataset-source-mp5")!;
  await act(async () => radio.click());
  expect(button("Download and add").disabled).toBe(false);
  await act(async () => button("Download and add").click());
  expect(importer.start).toHaveBeenCalledWith("corn", "mp5");
});

it("allows browsing but disables import without a workspace", async () => {
  catalog.datasets = [entry({ n_sources: 1, source_ids: ["m5"] })];
  const importer = controller();
  await render(importer, null);
  await act(async () => button("Corn").click());
  expect(button("Download and add").disabled).toBe(true);
  expect(document.body.textContent).toContain("Select a workspace to import public datasets.");
});

it("shows indeterminate activity and a cancel action while running", async () => {
  catalog.datasets = [entry({ n_sources: 1, source_ids: ["m5"] })];
  const importer = controller({ phase: "running", jobId: "job-1", workspaceId: "ws-1", workspacePath: "/ws" });
  await render(importer, "ws-1");
  expect(document.querySelector('[aria-valuetext="Progress not reported"]')).not.toBeNull();
  expect(document.body.textContent).toContain("Downloading and adding the dataset…");
  expect(button("Download and add").disabled).toBe(true);
  await act(async () => button("Cancel import").click());
  expect(importer.cancel).toHaveBeenCalledTimes(1);
});
