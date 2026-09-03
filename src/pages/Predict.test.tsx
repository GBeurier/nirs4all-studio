/**
 * @vitest-environment jsdom
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  predict: vi.fn(),
  catalogue: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

vi.mock("@/api/archiveV2Prediction", () => ({
  predictPersistedArchiveV2Array: mocks.predict,
  getPersistedArchiveV2Catalogue: mocks.catalogue,
}));

vi.mock("@/api/linkedWorkspaces", () => ({
  getLinkedWorkspaces: vi.fn(async () => ({ workspaces: [], active_workspace_id: "workspace-a", total: 1 })),
}));

vi.mock("@/components/layout/MlLoadingOverlay", () => ({
  MlLoadingOverlay: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/motion", () => ({
  motion: {
    div: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  },
}));

import Predict from "./Predict";
import {
  createPersistedArchiveV2Selection,
  persistArchiveV2Selection,
} from "@/lib/archiveV2Selection";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function selection() {
  return createPersistedArchiveV2Selection({
    workspace_id: "workspace-a",
    archive_ref: "artifacts/calibration.n4a",
    archive_sha256: "a".repeat(64),
    n_features: 2,
    target_names: ["protein", "moisture"],
  });
}

let cleanup: (() => Promise<void>) | null = null;

async function renderPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Predict />
      </QueryClientProvider>,
    );
  });
  await waitFor(() => expect(container.querySelector("textarea")?.hasAttribute("disabled")).toBe(false));
  cleanup = async () => {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
  };
  return container;
}

async function enterSpectraAndRun(container: HTMLElement, value: string) {
  const textarea = container.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Raw spectra matrix"]',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!
      .set!.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const run = Array.from(container.querySelectorAll("button"))
    .find((button) => button.textContent?.includes("Run Archive V2 prediction"))!;
  await act(async () => run.click());
}

async function waitFor(assertion: () => void, timeoutMs = 1000) {
  const started = Date.now();
  while (true) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() - started >= timeoutMs) throw error;
      await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    }
  }
}

beforeEach(() => {
  localStorage.clear();
  persistArchiveV2Selection(selection());
  mocks.predict.mockReset();
  mocks.catalogue.mockReset();
  mocks.catalogue.mockResolvedValue({ schema_version: 1, operation: "archive_v2_catalogue", workspace_id: "workspace-a", archives: [{ archive_id: "archive:calibration", archive_ref: "artifacts/calibration.n4a", archive_sha256: "a".repeat(64), n_features: 2, target_names: ["protein", "moisture"], descriptor_fingerprint: "b".repeat(64), identity_status: "verified" }] });
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
});

afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

describe("Predict Archive V2 page", () => {
  it("calls only the native persisted-archive transport and renders ordered targets", async () => {
    mocks.predict.mockResolvedValue({
      schema_version: 1,
      operation: "archive_v2_predict",
      archive_id: "archive:calibration",
      archive_sha256: "a".repeat(64),
      engine: "core_rust_methods",
      fallback_used: false,
      sample_ids: ["predict.0", "predict.1"],
      target_names: ["protein", "moisture"],
      values: [[1.1, 12.2], [1.3, 12.4]],
      provenance: {
        executor: `nirs4all-core@0.3.25+libn4m-abi-2.5:${"b".repeat(64)}`,
        archive_ref: "artifacts/calibration.n4a",
        workspace_id: "workspace-a",
      },
    });
    const container = await renderPage();

    await enterSpectraAndRun(container, "[[1, 2], [3, 4]]");
    await waitFor(() => expect(mocks.predict).toHaveBeenCalledOnce());

    expect(mocks.predict).toHaveBeenCalledWith(expect.objectContaining({
      archive: { ref: "artifacts/calibration.n4a", sha256: "a".repeat(64) },
      input: expect.objectContaining({
        x: [[1, 2], [3, 4]],
        expected_target_names: ["protein", "moisture"],
      }),
      execution: { engine: "core_rust_methods", allow_fallback: false },
    }));
    await waitFor(() => expect(container.textContent).toContain("Archive V2 predictions"));
    expect(container.textContent).toContain("protein");
    expect(container.textContent).toContain("moisture");
  });

  it("refuses feature-width and persisted-identity drift before transport", async () => {
    const container = await renderPage();

    await enterSpectraAndRun(container, "[[1, 2, 3]]");
    await waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent)
      .toContain("exactly 2 finite features"));
    expect(mocks.predict).not.toHaveBeenCalled();

    persistArchiveV2Selection({ ...selection(), target_names: ["moisture", "protein"] });
    await enterSpectraAndRun(container, "[[1, 2]]");
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(expect.stringContaining("Archive identity changed")));
    expect(mocks.predict).not.toHaveBeenCalled();
  });
});
