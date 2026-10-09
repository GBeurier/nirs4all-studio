/** @vitest-environment jsdom */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { autoDetectFile, detectFormat, previewDataset, validateFiles } from "@/api/datasets";
import { getDataLoadingDefaults } from "@/api/workspace";
import { WizardProvider } from "./WizardContext";
import { Dialog } from "@/components/ui/dialog";
import { DEFAULT_PARSING, useWizard, type WizardContextType, type WizardInitialState } from "./useWizard";
import { PreviewStep } from "./PreviewStep";
import { ParsingStep } from "./ParsingStep";
import { DataStats, WizardContent } from "./WizardContent";
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
  it("validates only the file whose effective parsing changed and retains other shapes", async () => {
    vi.useFakeTimers();
    vi.mocked(validateFiles).mockImplementation(async (_path, files) => ({
      success: true, shapes: Object.fromEntries(files.map(file => [file.path, {
        path: file.path, num_rows: 3, num_columns: file.type === "metadata" ? 1 : 2,
        column_names: file.type === "metadata" ? ["batch"] : ["a", "b"],
      }])),
    }));
    await mount(<DataStats />, { files: [xFile, metadataFile] });
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(validateFiles).toHaveBeenCalledTimes(1);
    await act(async () => wizard.dispatch({ type: "SET_FILE_OVERRIDE", payload: {
      path: xFile.path, options: { delimiter: "," },
    } }));
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(validateFiles).toHaveBeenCalledTimes(2);
    expect(vi.mocked(validateFiles).mock.calls[1][1].map(file => file.path)).toEqual([xFile.path]);
    expect(wizard.state.validatedShapes[metadataFile.path]?.num_rows).toBe(3);
    expect(wizard.state.metadataColumns).toEqual(["batch"]);
    await act(async () => wizard.dispatch({ type: "UPDATE_FILE", payload: { index: 0, updates: { split: "test" } } }));
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(validateFiles, "changing split does not reparse the table").toHaveBeenCalledTimes(2);
    await act(async () => wizard.dispatch({ type: "SET_PARSING", payload: { delimiter: "," } }));
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(validateFiles).toHaveBeenCalledTimes(3);
    expect(vi.mocked(validateFiles).mock.calls[2][1].map(file => file.path)).toEqual([metadataFile.path]);
    expect(wizard.state.validatedShapes[xFile.path]?.num_rows).toBe(3);
    await act(async () => wizard.dispatch({ type: "SET_PARSING", payload: { delimiter: "," } }));
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(validateFiles, "replacing identical parsing objects does not revalidate").toHaveBeenCalledTimes(3);
  });

  it("removes stale shapes without rereading remaining files", async () => {
    vi.useFakeTimers();
    vi.mocked(validateFiles).mockImplementation(async (_path, files) => ({
      success: true, shapes: Object.fromEntries(files.map(file => [file.path, {
        path: file.path, num_rows: 3, num_columns: 2, column_names: ["batch"],
      }])),
    }));
    await mount(<DataStats />, { files: [xFile, metadataFile], perFileOverrides: { [metadataFile.path]: { has_header: true } } });
    await act(async () => vi.advanceTimersByTimeAsync(200));
    await act(async () => wizard.dispatch({ type: "REMOVE_FILE", payload: 1 }));
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(validateFiles).toHaveBeenCalledTimes(1);
    expect(Object.keys(wizard.state.validatedShapes)).toEqual([xFile.path]);
    expect(wizard.state.metadataColumns).toEqual([]);
    expect(wizard.state.perFileOverrides).not.toHaveProperty(metadataFile.path);
  });

  it("accepts ignore NA and forwards the policy to validation and preview", async () => {
    vi.useFakeTimers();
    vi.mocked(detectFormat).mockResolvedValue({ format: "csv", column_info: [] });
    vi.mocked(validateFiles).mockResolvedValue({ success: true, shapes: {} });
    await mount(<Dialog open><WizardContent onAdd={async () => {}} onClose={() => {}} /></Dialog>, {
      files: [xFile, { ...xFile, path: "Ycal.csv", filename: "Ycal.csv", type: "Y" }],
      skipToStep: "targets", parsing: { ...DEFAULT_PARSING, na_policy: "ignore" },
    });
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(validateFiles).toHaveBeenCalledWith(
      "/data", expect.any(Array), expect.objectContaining({ na_policy: "ignore" }), expect.any(Object),
    );
    expect(wizard.state.validationError).toBeNull();
    const next = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find(button => button.textContent?.trim() === "Next")!;
    expect(next.disabled).toBe(false);
    await act(async () => next.click());
    expect(previewDataset).toHaveBeenCalledWith(expect.objectContaining({
      parsing: expect.objectContaining({ na_policy: "ignore" }),
    }));
    expect(wizard.state.preview?.success).toBe(true);
    expect(wizard.canProceed()).toBe(true);
  });

  it("keeps Next unavailable while target detection and file validation are unresolved", async () => {
    vi.mocked(detectFormat).mockReturnValue(new Promise(() => {}));
    vi.mocked(validateFiles).mockReturnValue(new Promise(() => {}));
    await mount(<Dialog open><WizardContent onAdd={async () => {}} onClose={() => {}} /></Dialog>, {
      files: [xFile, { ...xFile, path: "Ycal.csv", filename: "Ycal.csv", type: "Y" }],
      skipToStep: "targets",
    });
    expect(detectFormat).toHaveBeenCalled();
    const next = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === "Next")!;
    expect(next.disabled).toBe(true);
    expect(previewDataset).not.toHaveBeenCalled();
  });

  it("waits for both inspections and synchronizes target columns before preview", async () => {
    vi.useFakeTimers();
    let resolveColumns!: (value: Awaited<ReturnType<typeof detectFormat>>) => void;
    let resolveValidation!: (value: Awaited<ReturnType<typeof validateFiles>>) => void;
    vi.mocked(detectFormat).mockReturnValue(new Promise(resolve => { resolveColumns = resolve; }));
    vi.mocked(validateFiles).mockReturnValue(new Promise(resolve => { resolveValidation = resolve; }));
    await mount(<Dialog open><WizardContent onAdd={async () => {}} onClose={() => {}} /></Dialog>, {
      files: [xFile, { ...xFile, path: "Ycal.csv", filename: "Ycal.csv", type: "Y" }], skipToStep: "targets",
    });
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(validateFiles).toHaveBeenCalledTimes(1);
    const next = () => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === "Next")!;
    await act(async () => resolveColumns({ format: "csv", column_info: [{ name: "concentration", data_type: "numeric", task_type: "regression" }] }));
    expect(wizard.state.targets[0].column).toBe("concentration");
    expect(next().disabled).toBe(true);
    expect(previewDataset).not.toHaveBeenCalled();
    await act(async () => resolveValidation({ success: true, shapes: {} }));
    expect(next().disabled).toBe(false);
    await act(async () => next().click());
    expect(previewDataset).toHaveBeenCalledTimes(1);
    expect(wizard.state.targets[0].column).toBe("concentration");
  });

  it("keeps late target detections from overwriting the changed configuration", async () => {
    vi.useFakeTimers();
    let resolveOld!: (value: Awaited<ReturnType<typeof detectFormat>>) => void;
    vi.mocked(detectFormat)
      .mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }))
      .mockResolvedValue({ format: "csv", column_info: [{ name: "current", data_type: "numeric", task_type: "regression" }] });
    vi.mocked(validateFiles).mockResolvedValue({ success: true, shapes: {} });
    await mount(<Dialog open><WizardContent onAdd={async () => {}} onClose={() => {}} /></Dialog>, {
      files: [xFile, { ...xFile, path: "Ycal.csv", filename: "Ycal.csv", type: "Y" }], skipToStep: "targets",
    });
    await act(async () => wizard.dispatch({ type: "SET_PARSING", payload: { delimiter: "," } }));
    expect(detectFormat).toHaveBeenCalledTimes(2);
    expect(wizard.state.targets[0].column).toBe("current");
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(wizard.canProceed()).toBe(false);
    await act(async () => resolveOld({ format: "csv", column_info: [{ name: "stale", data_type: "numeric", task_type: "regression" }] }));
    expect(wizard.state.targets[0].column).toBe("current");
    expect(wizard.canProceed()).toBe(true);
  });

  it("releases inspection state after a rejection without retrying", async () => {
    vi.useFakeTimers();
    vi.mocked(detectFormat).mockRejectedValue(new Error("Cannot detect target columns"));
    vi.mocked(validateFiles).mockRejectedValue(new Error("Invalid file parameters"));
    await mount(<Dialog open><WizardContent onAdd={async () => {}} onClose={() => {}} /></Dialog>, {
      files: [xFile, { ...xFile, path: "Ycal.csv", filename: "Ycal.csv", type: "Y" }], skipToStep: "targets",
    });
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(container.textContent).toContain("Cannot detect target columns");
    expect(wizard.state.validationError).toBe("Invalid file parameters");
    expect(wizard.canProceed()).toBe(true);
    expect(detectFormat).toHaveBeenCalledTimes(1);
    expect(validateFiles).toHaveBeenCalledTimes(1);
  });

  it("keeps Back and Cancel usable during pending inspections and tolerates unmount", async () => {
    let resolveColumns!: (value: Awaited<ReturnType<typeof detectFormat>>) => void;
    vi.mocked(detectFormat).mockReturnValue(new Promise(resolve => { resolveColumns = resolve; }));
    const onClose = vi.fn();
    await mount(<Dialog open><WizardContent onAdd={async () => {}} onClose={onClose} /></Dialog>, {
      files: [xFile, { ...xFile, path: "Ycal.csv", filename: "Ycal.csv", type: "Y" }], skipToStep: "targets",
    });
    const button = (name: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find(candidate => candidate.textContent?.trim() === name)!;
    expect(button("Back").disabled).toBe(false);
    await act(async () => button("Back").click());
    expect(wizard.state.step).toBe("parsing");
    expect(button("Cancel").disabled).toBe(false);
    await act(async () => button("Cancel").click());
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
    await act(async () => resolveColumns({ format: "csv", column_info: [{ name: "late", data_type: "numeric", task_type: "regression" }] }));
    expect(wizard.state.targets).toEqual([]);
  });

  it("counts overlapping inspections and releases each token only once", async () => {
    await mount(null, { skipToStep: "targets" });
    let finishFirst!: () => void;
    let finishSecond!: () => void;
    await act(async () => { finishFirst = wizard.beginInspection(); finishSecond = wizard.beginInspection(); });
    expect(wizard.canProceed()).toBe(false);
    await act(async () => { finishFirst(); finishFirst(); });
    expect(wizard.canProceed()).toBe(false);
    await act(async () => finishSecond());
    expect(wizard.canProceed()).toBe(true);
  });

  it("retains pending old validation without applying its late result after edits", async () => {
    vi.useFakeTimers();
    let resolveOld!: (value: Awaited<ReturnType<typeof validateFiles>>) => void;
    vi.mocked(validateFiles)
      .mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }))
      .mockResolvedValue({ success: true, shapes: { "Mcal.csv": { path: "Mcal.csv", num_rows: 3, num_columns: 1, column_names: ["current"] } } });
    await mount(<DataStats />, { files: [xFile, metadataFile], skipToStep: "parsing" });
    await act(async () => vi.advanceTimersByTimeAsync(200));
    await act(async () => wizard.dispatch({ type: "SET_PARSING", payload: { delimiter: "," } }));
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(wizard.state.metadataColumns).toEqual(["current"]);
    expect(wizard.canProceed()).toBe(false);
    await act(async () => resolveOld({ success: false, shapes: {}, error: "Stale validation error" }));
    expect(wizard.state.validationError).toBeNull();
    expect(wizard.state.metadataColumns).toEqual(["current"]);
    expect(wizard.canProceed()).toBe(true);
  });

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
