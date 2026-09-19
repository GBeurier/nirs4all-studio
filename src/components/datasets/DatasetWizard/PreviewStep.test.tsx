// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WizardState } from "@/types/datasets";
import { PreviewStep } from "./PreviewStep";
import { useWizard } from "./useWizard";
import { previewDataset } from "@/api/datasets";

vi.mock("./useWizard", () => ({ useWizard: vi.fn() }));
vi.mock("@/api/datasets", () => ({ previewDataset: vi.fn(), previewDatasetWithUploads: vi.fn() }));
vi.mock("../charts", () => ({ SpectraChart: () => null, TargetHistogram: () => null }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("dataset preview failure", () => {
  beforeEach(() => vi.resetAllMocks());
  it("keeps the error visible and retries only when the user asks", async () => {
    const state = { files: [{ path: "Xtrain.csv", type: "X", split: "train" }], basePath: "/spectra",
      parsing: { delimiter: ";", has_header: true }, perFileOverrides: {}, fileBlobs: new Map(), preview: null } as unknown as WizardState;
    vi.mocked(useWizard).mockReturnValue({ state, dispatch: vi.fn() } as unknown as ReturnType<typeof useWizard>);
    vi.mocked(previewDataset).mockRejectedValueOnce(new Error("CSV parsing failed"))
      .mockImplementation(() => new Promise(() => {}));
    const element = document.createElement("div");
    const root = createRoot(element);
    try {
      await act(async () => root.render(createElement(PreviewStep)));
      expect(previewDataset).toHaveBeenCalledTimes(1);
      expect(element.textContent).toContain("CSV parsing failed");
      const retry = [...element.querySelectorAll("button")].find(button => button.textContent?.includes("Retry"));
      expect(retry).toBeDefined();
      await act(async () => retry?.click());
      expect(previewDataset).toHaveBeenCalledTimes(2);
    } finally { await act(async () => root.unmount()); }
  });

  it("does not launch duplicate work when defaults replace equivalent request objects", async () => {
    let state = { files: [{ path: "Xtrain.csv", type: "X", split: "train" }], basePath: "/spectra",
      parsing: { delimiter: ";", has_header: true }, perFileOverrides: {}, fileBlobs: new Map(), preview: null } as unknown as WizardState;
    const dispatch = vi.fn();
    vi.mocked(useWizard).mockImplementation(() => ({ state, dispatch }) as unknown as ReturnType<typeof useWizard>);
    vi.mocked(previewDataset).mockImplementation(() => new Promise(() => {}));
    const root = createRoot(document.createElement("div"));
    try {
      await act(async () => root.render(createElement(PreviewStep)));
      state = { ...state, files: state.files.map(file => ({ ...file })), parsing: { ...state.parsing }, perFileOverrides: {}, fileBlobs: new Map() };
      await act(async () => root.render(createElement(PreviewStep)));
      expect(previewDataset).toHaveBeenCalledTimes(1);
      state = { ...state, parsing: { ...state.parsing, delimiter: "," } };
      await act(async () => root.render(createElement(PreviewStep)));
      expect(previewDataset).toHaveBeenCalledTimes(2);
    } finally { await act(async () => root.unmount()); }
  });
});
