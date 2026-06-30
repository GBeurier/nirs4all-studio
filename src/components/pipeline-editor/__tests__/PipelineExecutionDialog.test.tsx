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
});
