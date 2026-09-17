/** @vitest-environment jsdom */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { autoDetectFile, previewDataset, validateFiles } from "@/api/datasets";
import { getDataLoadingDefaults } from "@/api/workspace";
import { WizardProvider } from "./WizardContext";
import { DEFAULT_PARSING, useWizard, type WizardContextType, type WizardInitialState } from "./useWizard";
import { PreviewStep } from "./PreviewStep";
import { ParsingStep } from "./ParsingStep";
import { DataStats } from "./WizardContent";
import type { DetectedFile, PreviewDataResponse } from "@/types/datasets";

vi.mock("@/api/datasets", () => ({
  autoDetectFile: vi.fn(), detectFormat: vi.fn(), detectUnified: vi.fn(),
  previewDataset: vi.fn(), previewDatasetWithUploads: vi.fn(), validateFiles: vi.fn(),
}));
vi.mock("@/api/workspace", () => ({ getDataLoadingDefaults: vi.fn() }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../charts", () => ({ SpectraChart: () => null, TargetHistogram: () => null }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const xFile: DetectedFile = {
  path: "Xcal.csv", filename: "Xcal.csv", type: "X", split: "train", source: null,
  format: "csv", size_bytes: 30, confidence: 0.9, detected: true,
};
const metadataFile: DetectedFile = { ...xFile, path: "Mcal.csv", filename: "Mcal.csv", type: "metadata" };
const success: PreviewDataResponse = {
  success: true,
  summary: { num_samples: 3, num_features: 2, n_sources: 1, train_samples: 3, test_samples: 0, has_targets: false, has_metadata: false },
};
let wizard: WizardContextType;
let root: Root;
let container: HTMLDivElement;

function Capture({ children }: { children: ReactNode }) {
  wizard = useWizard();
  return children;
}

async function mount(children: ReactNode, initial: Partial<WizardInitialState> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <WizardProvider initialState={{ sourceType: "folder", basePath: "/data", files: [xFile], skipToStep: "preview", ...initial }}>
        <Capture>{children}</Capture>
      </WizardProvider>,
    );
  });
}

beforeEach(() => {
  vi.mocked(getDataLoadingDefaults).mockResolvedValue({ ...DEFAULT_PARSING, auto_detect: true });
  vi.mocked(previewDataset).mockResolvedValue(success);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.useRealTimers();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe("Dataset wizard regressions", () => {
  it("keeps a failed preview visible without retrying until the user asks", async () => {
    vi.mocked(previewDataset).mockRejectedValueOnce(new Error("Missing metadata"));
    await mount(<PreviewStep />);
    expect(previewDataset).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Missing metadata");
    expect(wizard.canProceed()).toBe(false);

    await act(async () => {
      [...container.querySelectorAll("button")].find(button => button.textContent?.includes("Retry"))!.click();
    });
    expect(previewDataset).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Dataset is ready to add");
    expect(wizard.canProceed()).toBe(true);
  });

  it("reloads edited parsing and discards a late response for the previous configuration", async () => {
    let resolveOld!: (response: PreviewDataResponse) => void;
    vi.mocked(previewDataset).mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }));
    await mount(<PreviewStep />, { files: [xFile, metadataFile] });
    await act(async () => wizard.dispatch({ type: "SET_FILE_OVERRIDE", payload: { path: "Mcal.csv", options: { delimiter: "," } } }));
    expect(previewDataset).toHaveBeenCalledTimes(2);
    expect(vi.mocked(previewDataset).mock.calls[1][0].files[1].overrides).toMatchObject({ delimiter: ",", na_policy: "ignore" });
    await act(async () => resolveOld({ ...success, success: false, error: "Old parsing error" }));
    expect(wizard.state.preview).toEqual(success);
    expect(container.textContent).not.toContain("Old parsing error");
  });

  it("requires a successful preview before permitting dataset registration", async () => {
    vi.mocked(previewDataset).mockResolvedValue({ ...success, success: false });
    await mount(<PreviewStep />);
    expect(wizard.canProceed()).toBe(false);
  });

  it("shows inherited parsing in local controls without automatically overwriting edits", async () => {
    await mount(<ParsingStep />, {
      files: [metadataFile], skipToStep: "parsing",
      parsing: { delimiter: ",", has_header: false, na_policy: "auto" },
    });
    expect(autoDetectFile).not.toHaveBeenCalled();
    const switches = container.querySelectorAll<HTMLButtonElement>('button[role="switch"]');
    await act(async () => switches[switches.length - 1].click());
    const forms = container.querySelectorAll('[data-state="open"]');
    expect(forms.length).toBeGreaterThan(0);
    expect(container.textContent?.match(/Comma \(,\)/g)?.length).toBe(2);
    expect(container.textContent).toContain("settings.dataDefaults.missing.policies.ignore");
    const headerSwitches = [...container.querySelectorAll<HTMLButtonElement>('button[role="switch"]')]
      .filter(button => button.getAttribute("aria-checked") === "false");
    expect(headerSwitches.length).toBeGreaterThanOrEqual(2);
    await act(async () => headerSwitches[headerSwitches.length - 1].click());
    expect(wizard.state.perFileOverrides[metadataFile.path].has_header).toBe(true);
    expect(wizard.state.parsing.has_header).toBe(false);
    expect(autoDetectFile).not.toHaveBeenCalled();
  });

  it("revalidates local changes and refreshes available metadata columns", async () => {
    vi.useFakeTimers();
    vi.mocked(validateFiles)
      .mockResolvedValueOnce({ success: true, shapes: { "Mcal.csv": { path: "Mcal.csv", error: "Wrong delimiter" } } })
      .mockResolvedValueOnce({ success: true, shapes: { "Mcal.csv": { path: "Mcal.csv", num_rows: 3, num_columns: 2, column_names: ["sample_id", "batch"] } } });
    await mount(<DataStats />, { files: [xFile, metadataFile] });
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(wizard.state.validatedShapes["Mcal.csv"].error).toBe("Wrong delimiter");
    await act(async () => wizard.dispatch({ type: "SET_FILE_OVERRIDE", payload: { path: "Mcal.csv", options: { delimiter: "," } } }));
    expect(wizard.state.isValidating).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(validateFiles).toHaveBeenCalledTimes(2);
    expect(vi.mocked(validateFiles).mock.calls[1][3]?.["Mcal.csv"]).toMatchObject({ delimiter: ",", na_policy: "ignore" });
    expect(wizard.state.metadataColumns).toEqual(["sample_id", "batch"]);
    expect(wizard.state.validatedShapes["Mcal.csv"].error).toBeUndefined();
    expect(wizard.state.isValidating).toBe(false);
  });
});
