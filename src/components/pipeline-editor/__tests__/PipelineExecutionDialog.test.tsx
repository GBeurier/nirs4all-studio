/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PipelineExecutionDialog } from "../PipelineExecutionDialog";
import type { PipelineStep } from "../types";

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  execute: vi.fn(),
  exportPipeline: vi.fn(),
  copyToClipboard: vi.fn(),
  downloadExport: vi.fn(),
  getPipeline: vi.fn(),
  invalidateQueries: vi.fn(),
  navigate: vi.fn(),
  quickRun: vi.fn(),
  reset: vi.fn(),
  runPreflight: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
  useDatasetSelection: vi.fn(),
  useKeywordRegistry: vi.fn(),
  usePipelineExecution: vi.fn(),
  usePipelineExport: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: mocks.useQuery,
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
    warning: mocks.toastWarning,
  },
}));

vi.mock("@/api/pipelines", () => ({
  getPipeline: mocks.getPipeline,
}));

vi.mock("@/api/runs", () => ({
  quickRun: mocks.quickRun,
  runPreflight: mocks.runPreflight,
}));

vi.mock("@/hooks/usePipelineExecution", () => ({
  useDatasetSelection: mocks.useDatasetSelection,
  usePipelineExecution: mocks.usePipelineExecution,
  usePipelineExport: mocks.usePipelineExport,
}));

vi.mock("@/hooks/useKeywordRegistry", () => ({
  useKeywordRegistry: mocks.useKeywordRegistry,
}));

vi.mock("../MissingNodesConfirmDialog", () => ({
  MissingNodesConfirmDialog: () => null,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/components/ui/select", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  const SelectContext = React.createContext<{
    disabled?: boolean;
    onValueChange?: (value: string) => void;
  }>({});

  function Select({
    children,
    disabled,
    onValueChange,
    value,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onValueChange?: (value: string) => void;
    value?: string;
  }) {
    return (
      <SelectContext.Provider value={{ disabled, onValueChange }}>
        <div data-select-value={value}>{children}</div>
      </SelectContext.Provider>
    );
  }

  function SelectItem({
    children,
    value,
  }: {
    children: ReactNode;
    value: string;
  }) {
    const context = React.useContext(SelectContext);

    return (
      <button
        disabled={context.disabled}
        onClick={() => context.onValueChange?.(value)}
        type="button"
      >
        {children}
      </button>
    );
  }

  const Passthrough = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  const SelectValue = ({ placeholder }: { placeholder?: string }) => (
    <span>{placeholder}</span>
  );

  return {
    Select,
    SelectContent: Passthrough,
    SelectItem,
    SelectTrigger: Passthrough,
    SelectValue,
  };
});

vi.mock("@/lib/motion", () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  motion: {
    div: ({
      animate: _animate,
      children,
      exit: _exit,
      initial: _initial,
      ...props
    }: {
      animate?: unknown;
      children: ReactNode;
      exit?: unknown;
      initial?: unknown;
      [key: string]: unknown;
    }) => <div {...props}>{children}</div>,
  },
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const groupedPipelineSteps: PipelineStep[] = [
  {
    id: "split-1",
    type: "splitting",
    name: "GroupKFold",
    classPath: "splitting.group_kfold",
    params: {},
  },
];

function getButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes(label),
  );

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`);
  }

  return button;
}

async function renderDialog() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <PipelineExecutionDialog
        open
        onOpenChange={() => undefined}
        pipelineId="pipeline-1"
        pipelineName="Grouped pipeline"
        pipelineSteps={groupedPipelineSteps}
      />,
    );
  });

  return {
    container,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

beforeEach(() => {
  mocks.useQuery.mockReturnValue({ data: undefined, isLoading: false });
  mocks.useDatasetSelection.mockReturnValue({
    datasets: [
      {
        id: "dataset-1",
        name: "Sample Dataset",
        path: "/data/sample.csv",
        numSamples: 32,
        metadataColumns: ["batch"],
        repetitionColumn: null,
      },
    ],
    isLoading: false,
  });
  mocks.usePipelineExecution.mockReturnValue({
    cancel: mocks.cancel,
    error: null,
    execute: mocks.execute,
    isConnected: false,
    jobId: null,
    progress: 0,
    progressMessage: "",
    reset: mocks.reset,
    result: null,
    status: "idle",
  });
  mocks.usePipelineExport.mockReturnValue({
    copyToClipboard: mocks.copyToClipboard,
    downloadExport: mocks.downloadExport,
    exportPipeline: mocks.exportPipeline,
    isExporting: false,
  });
  mocks.useKeywordRegistry.mockReturnValue({
    data: undefined,
    error: null,
    isError: false,
    isLoading: false,
  });
  mocks.runPreflight.mockResolvedValue({
    issues: [],
    ready: true,
  });
  mocks.execute.mockResolvedValue("job-1");
});

afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("PipelineExecutionDialog", () => {
  it("renders dataset runtime grouping and unlocks launch actions after group selection", async () => {
    const view = await renderDialog();

    expect(view.container.textContent).toContain("Run Name");
    expect(view.container.textContent).toContain("Dataset");
    expect(view.container.textContent).toContain("Native assurance contract");
    expect(view.container.textContent).toContain("Robustness scenario draft");
    expect(view.container.textContent).toContain("Attach this draft to launch metadata");
    expect(getButton(view.container, "Execute Here").disabled).toBe(true);

    await act(async () => {
      getButton(view.container, "Sample Dataset").click();
    });

    expect(view.container.textContent).toContain("Runtime Grouping");
    expect(view.container.textContent).toContain("Required");
    expect(view.container.textContent).toContain("At least one selected pipeline requires an effective group");
    expect(getButton(view.container, "Execute Here").disabled).toBe(true);

    await act(async () => {
      getButton(view.container, "batch").click();
    });

    expect(view.container.textContent).not.toContain("At least one selected pipeline requires an effective group");
    expect(getButton(view.container, "Execute Here").disabled).toBe(false);

    await view.unmount();
  });

  it("does not attach robustness draft fields to launch payloads unless explicitly enabled", async () => {
    const view = await renderDialog();

    await act(async () => {
      getButton(view.container, "Sample Dataset").click();
    });
    await act(async () => {
      getButton(view.container, "batch").click();
    });

    const kindSelect = view.container.querySelector<HTMLSelectElement>("select[name='kind']");
    expect(kindSelect).toBeTruthy();

    await act(async () => {
      kindSelect!.value = "prediction_noise";
      kindSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await act(async () => {
      getButton(view.container, "Execute Here").click();
    });

    expect(mocks.execute).toHaveBeenCalledTimes(1);
    const launchPayload = mocks.execute.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(launchPayload).toMatchObject({
      allowFallback: false,
      datasetId: "dataset-1",
      pipelineId: "pipeline-1",
      runtimeEngine: null,
    });
    expect(launchPayload).not.toHaveProperty("robustness");
    expect(launchPayload).not.toHaveProperty("robustnessScenarios");
    expect(launchPayload).not.toHaveProperty("robustness_scenarios");

    await view.unmount();
  });

  it("attaches a valid robustness draft to launch metadata when enabled", async () => {
    const view = await renderDialog();

    await act(async () => {
      getButton(view.container, "Sample Dataset").click();
    });
    await act(async () => {
      getButton(view.container, "batch").click();
    });

    const modeSelect = view.container.querySelector<HTMLSelectElement>("select[name='mode']");
    const kindSelect = view.container.querySelector<HTMLSelectElement>("select[name='kind']");
    const distributionSelect = view.container.querySelector<HTMLSelectElement>("select[name='distribution']");
    const attachCheckbox = view.container.querySelector<HTMLInputElement>(
      "input[aria-label='Attach robustness scenario draft to launch metadata']",
    );
    const publishEvidenceCheckbox = view.container.querySelector<HTMLInputElement>(
      "input[aria-label='Publish spectral/OOD replay evidence when available']",
    );
    expect(modeSelect).toBeTruthy();
    expect(kindSelect).toBeTruthy();
    expect(distributionSelect).toBeTruthy();
    expect(attachCheckbox).toBeTruthy();
    expect(publishEvidenceCheckbox).toBeTruthy();
    expect(publishEvidenceCheckbox?.disabled).toBe(true);
    expect(modeSelect?.value).toBe("clean_frozen");

    await act(async () => {
      kindSelect!.value = "prediction_noise";
      kindSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      distributionSelect!.value = "uniform";
      distributionSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      attachCheckbox!.click();
    });
    expect(publishEvidenceCheckbox?.disabled).toBe(false);
    await act(async () => {
      publishEvidenceCheckbox!.click();
    });
    await act(async () => {
      getButton(view.container, "Execute Here").click();
    });

    expect(mocks.execute).toHaveBeenCalledTimes(1);
    const launchPayload = mocks.execute.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(launchPayload.robustness).toEqual({
      mode: "clean_frozen",
      scenarios: [
        {
          distribution: "uniform",
          kind: "prediction_noise",
          severity: 0,
        },
      ],
      publish_evidence: {
        spectral_replay: {
          X: "dataset_partition",
          predictor_bundle: "exported_model_bundle",
          destination: "result_metadata.robustness_evidence",
          fail_closed: true,
        },
      },
    });

    await view.unmount();
  });
});
