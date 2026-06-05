/**
 * @vitest-environment jsdom
 */

import {
  act,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactNode,
} from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPipeline: vi.fn(),
  savePipeline: vi.fn(),
  getChainPipelineSteps: vi.fn(),
  getRunPipelineSteps: vi.fn(),
  previewPipelineImport: vi.fn(),
  renderCanonicalPipeline: vi.fn(),
  listPipelineSamples: vi.fn(),
  getPipelineSample: vi.fn(),
  loadPipeline: vi.fn(),
  setIsFavorite: vi.fn(),
  hasPersistedPipelineState: vi.fn(() => false),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}));

vi.mock("@/api/pipelines", () => ({
  getPipeline: mocks.getPipeline,
  savePipeline: mocks.savePipeline,
  previewPipelineImport: mocks.previewPipelineImport,
  renderCanonicalPipeline: mocks.renderCanonicalPipeline,
  listPipelineSamples: mocks.listPipelineSamples,
  getPipelineSample: mocks.getPipelineSample,
}));

vi.mock("@/api/aggregatedPredictions", () => ({
  getChainPipelineSteps: mocks.getChainPipelineSteps,
  getRunPipelineSteps: mocks.getRunPipelineSteps,
}));

vi.mock("@/hooks/usePipelineEditor", () => ({
  hasPersistedPipelineState: mocks.hasPersistedPipelineState,
  usePipelineEditor: () => ({
    steps: [],
    pipelineName: "Loading Pipeline...",
    pipelineConfig: {},
    selectedStepId: null,
    isFavorite: false,
    isDirty: false,
    canUndo: false,
    canRedo: false,
    stepCounts: {
      preprocessing: 0,
      y_processing: 0,
      splitting: 0,
      model: 0,
      flow: 0,
      utility: 0,
      generator: 0,
      branch: 0,
      merge: 0,
      filter: 0,
      augmentation: 0,
      sample_augmentation: 0,
      feature_augmentation: 0,
      sample_filter: 0,
      concat_transform: 0,
      sequential: 0,
      chart: 0,
      comment: 0,
    },
    totalSteps: 0,
    setPipelineName: vi.fn(),
    setPipelineConfig: vi.fn(),
    setSelectedStepId: vi.fn(),
    setIsFavorite: mocks.setIsFavorite,
    addStep: vi.fn(),
    addStepAtPath: vi.fn(),
    removeStep: vi.fn(),
    duplicateStep: vi.fn(),
    moveStep: vi.fn(),
    reorderSteps: vi.fn(),
    updateStep: vi.fn(),
    addBranch: vi.fn(),
    removeBranch: vi.fn(),
    addChild: vi.fn(),
    removeChild: vi.fn(),
    updateChild: vi.fn(),
    handleDrop: vi.fn(),
    handleReorder: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    getSelectedStep: () => null,
    clearPipeline: vi.fn(),
    loadPipeline: mocks.loadPipeline,
    exportPipeline: () => ({ name: "Loading Pipeline...", steps: [], config: {} }),
    exportToNirs4all: vi.fn(),
    clearPersistedData: vi.fn(),
  }),
}));

vi.mock("@/hooks/useDatasetBinding", () => ({
  useDatasetBinding: () => ({
    boundDataset: null,
    datasets: [],
    isLoading: false,
    bindDataset: vi.fn(),
    clearBinding: vi.fn(),
    selectTarget: vi.fn(),
    refreshDatasets: vi.fn(),
    error: null,
  }),
}));

vi.mock("@/hooks/useVariantCount", () => ({
  useVariantCount: () => ({
    count: 1,
    breakdown: {},
    isLoading: false,
  }),
  formatVariantCount: (count: number) => String(count),
  getVariantCountColor: () => "",
  getVariantCountSeverity: () => "low",
}));

vi.mock("@/hooks/useKeyboardNavigation", () => ({
  useKeyboardNavigation: () => ({
    focusedPanel: "tree",
    setFocusedPanel: vi.fn(),
    panelRefs: { palette: { current: null }, tree: { current: null }, config: { current: null } },
    isCommandPaletteOpen: false,
    isShortcutsHelpOpen: false,
    openCommandPalette: vi.fn(),
    closeCommandPalette: vi.fn(),
    openShortcutsHelp: vi.fn(),
    closeShortcutsHelp: vi.fn(),
  }),
  KEYBOARD_SHORTCUTS: [],
  formatShortcut: () => "",
}));

vi.mock("@/components/pipeline-editor", () => {
  const PassThrough = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    StepPalette: () => <div data-testid="step-palette" />,
    PipelineTree: () => <div data-testid="pipeline-tree" />,
    StepConfigPanel: () => <div data-testid="step-config" />,
    PipelineDndProvider: PassThrough,
    CommandPalette: () => null,
    KeyboardShortcutsDialog: () => null,
    ExecutionPreviewCompact: () => null,
    FocusPanelRing: () => null,
    NavigationStatusBar: () => null,
    DatasetBinding: () => null,
    PipelineYAMLView: () => null,
  };
});

vi.mock("@/components/pipeline-editor/contexts", () => ({
  DatasetBindingProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
  NodeRegistryProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
  OperatorAvailabilityProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
  PipelineEditorPreferencesProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/motion", () => ({
  motion: {
    div: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  },
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, ...props }: LabelHTMLAttributes<HTMLLabelElement>) => (
    <label {...props}>{children}</label>
  ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/tooltip", () => {
  const PassThrough = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Tooltip: PassThrough,
    TooltipProvider: PassThrough,
    TooltipTrigger: PassThrough,
    TooltipContent: PassThrough,
  };
});

vi.mock("@/components/ui/dropdown-menu", () => {
  const PassThrough = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    DropdownMenu: PassThrough,
    DropdownMenuContent: PassThrough,
    DropdownMenuItem: PassThrough,
    DropdownMenuSeparator: PassThrough,
    DropdownMenuTrigger: PassThrough,
    DropdownMenuSub: PassThrough,
    DropdownMenuSubContent: PassThrough,
    DropdownMenuSubTrigger: PassThrough,
  };
});

vi.mock("@/components/ui/alert-dialog", () => {
  const PassThrough = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    AlertDialog: PassThrough,
    AlertDialogAction: PassThrough,
    AlertDialogCancel: PassThrough,
    AlertDialogContent: PassThrough,
    AlertDialogDescription: PassThrough,
    AlertDialogFooter: PassThrough,
    AlertDialogHeader: PassThrough,
    AlertDialogTitle: PassThrough,
  };
});

vi.mock("@/components/ui/popover", () => {
  const PassThrough = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Popover: PassThrough,
    PopoverContent: PassThrough,
    PopoverTrigger: PassThrough,
  };
});

vi.mock("sonner", () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
    info: mocks.toastInfo,
  },
}));

import PipelineEditor from "./PipelineEditor";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

async function waitFor(assertion: () => void, timeoutMs: number = 1000): Promise<void> {
  const start = Date.now();
  while (true) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() - start >= timeoutMs) {
        throw error;
      }
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
  }
}

async function renderPage(route: string) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = createQueryClient();

  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/pipelines/:id" element={<PipelineEditor />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });

  return {
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
      client.clear();
    },
  };
}

afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("PipelineEditor route loading", () => {
  it("loads an existing pipeline from the backend instead of using placeholder steps", async () => {
    const advancedSteps = [
      { id: "split", type: "splitting", name: "SPXYFold", params: { n_splits: 3 } },
      { id: "gen", type: "flow", subType: "generator", name: "Generator", params: {}, generatorKind: "cartesian" },
      { id: "scale", type: "preprocessing", name: "StandardScaler", params: { with_std: false } },
      {
        id: "model",
        type: "model",
        name: "PLSRegression",
        params: { scale: false },
        finetuneConfig: {
          enabled: true,
          n_trials: 25,
          approach: "single",
          eval_mode: "best",
          model_params: [{ name: "n_components", type: "int", low: 1, high: 25, rawValue: ["int", 1, 25] }],
        },
      },
    ];

    mocks.getPipeline.mockResolvedValue({
      id: "preset-1",
      name: "Advanced PLS Pipeline",
      description: "PLS finetuning preset",
      category: "preset",
      steps: advancedSteps,
      created_at: "2026-04-09T10:00:00",
      updated_at: "2026-04-09T10:00:00",
      is_favorite: true,
    });

    const view = await renderPage("/pipelines/preset-1");

    await waitFor(() => {
      expect(mocks.getPipeline).toHaveBeenCalledWith("preset-1");
      expect(mocks.loadPipeline).toHaveBeenCalledWith(
        advancedSteps,
        "Advanced PLS Pipeline",
      );
      expect(mocks.setIsFavorite).toHaveBeenCalledWith(true);
    });

    await view.unmount();
  });

  it("does not overwrite an existing persisted draft for the same pipeline", async () => {
    mocks.hasPersistedPipelineState.mockReturnValue(true);

    const view = await renderPage("/pipelines/preset-2");

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

    expect(mocks.getPipeline).not.toHaveBeenCalled();
    expect(mocks.loadPipeline).not.toHaveBeenCalled();

    await view.unmount();
  });

  it("labels chain reloads as chain snapshots", async () => {
    const importedSteps = [
      { id: "split", type: "splitting", name: "ShuffleSplit", params: { n_splits: 4 } },
      { id: "scale", type: "preprocessing", name: "SNV", params: {} },
      { id: "model", type: "model", name: "XGBClassifier", params: { n_estimators: 25 } },
    ];

    mocks.getChainPipelineSteps.mockResolvedValue({
      chain_id: "chain-001",
      name: "SNV → XGBClassifier",
      pipeline: [
        { split: "ShuffleSplit", n_splits: 4 },
        "SNV",
        { model: "XGBClassifier", n_estimators: 25 },
      ],
      reload: {
        source: "chain_snapshot",
        selection_scope: "preprocessing_chain_plus_selected_model",
        is_editable_template: false,
      },
    });
    mocks.previewPipelineImport.mockResolvedValue({
      success: true,
      name: "SNV → XGBClassifier",
      description: "",
      steps: importedSteps,
    });

    const view = await renderPage("/pipelines/new?chainId=chain-001");

    await waitFor(() => {
      expect(mocks.getChainPipelineSteps).toHaveBeenCalledWith("chain-001");
      expect(mocks.previewPipelineImport).toHaveBeenCalledWith({
        content: undefined,
        payload: {
          name: "SNV → XGBClassifier",
          pipeline: [
            { split: "ShuffleSplit", n_splits: 4 },
            "SNV",
            { model: "XGBClassifier", n_estimators: 25 },
          ],
        },
        format: undefined,
      });
      expect(mocks.loadPipeline).toHaveBeenCalledWith(importedSteps, "SNV → XGBClassifier");
      expect(mocks.toastSuccess).toHaveBeenCalledWith("Chain snapshot loaded", {
        description: "3 steps loaded from this chain snapshot (preprocessing chain + selected model), not the original template.",
      });
    });

    await view.unmount();
  });

  it("loads the original authoring template from the query string when available", async () => {
    const importedSteps = [
      { id: "split", type: "splitting", name: "ShuffleSplit", params: { n_splits: 4 } },
      { id: "scale", type: "preprocessing", name: "SNV", params: {} },
      { id: "model-a", type: "model", name: "PLSRegression", params: { n_components: 8 } },
      { id: "model-b", type: "model", name: "SVR", params: { kernel: "rbf" } },
    ];

    mocks.getRunPipelineSteps.mockResolvedValue({
      pipeline_id: "pipe-run-1",
      name: "Run Variant A",
      pipeline: [
        { split: "ShuffleSplit", n_splits: 4 },
        "SNV",
        { model: "PLSRegression", n_components: 8 },
        { model: "SVR", kernel: "rbf" },
      ],
      reload: {
        source: "authoring_template",
        is_editable_template: true,
        is_legacy_fallback: false,
      },
    });
    mocks.previewPipelineImport.mockResolvedValue({
      success: true,
      name: "Run Variant A",
      description: "",
      steps: importedSteps,
    });

    const view = await renderPage("/pipelines/new?runPipelineId=pipe-run-1");

    await waitFor(() => {
      expect(mocks.getRunPipelineSteps).toHaveBeenCalledWith("pipe-run-1");
      expect(mocks.previewPipelineImport).toHaveBeenCalledWith({
        content: undefined,
        payload: {
          name: "Run Variant A",
          pipeline: [
            { split: "ShuffleSplit", n_splits: 4 },
            "SNV",
            { model: "PLSRegression", n_components: 8 },
            { model: "SVR", kernel: "rbf" },
          ],
        },
        format: undefined,
      });
      expect(mocks.loadPipeline).toHaveBeenCalledWith(importedSteps, "Run Variant A");
      expect(mocks.toastSuccess).toHaveBeenCalledWith("Original template loaded", {
        description: "4 steps loaded from the original editable template.",
      });
    });

    await view.unmount();
  });

  it("labels legacy run reloads as expanded snapshots", async () => {
    const importedSteps = [
      { id: "split", type: "splitting", name: "ShuffleSplit", params: { n_splits: 4 } },
      { id: "scale", type: "preprocessing", name: "SNV", params: {} },
      { id: "model-a", type: "model", name: "PLSRegression", params: { n_components: 8 } },
    ];

    mocks.getRunPipelineSteps.mockResolvedValue({
      pipeline_id: "pipe-run-legacy",
      name: "Legacy Run Variant",
      pipeline: [
        { split: "ShuffleSplit", n_splits: 4 },
        "SNV",
        { model: "PLSRegression", n_components: 8 },
      ],
      reload: {
        source: "expanded_snapshot",
        is_editable_template: false,
        is_legacy_fallback: true,
      },
    });
    mocks.previewPipelineImport.mockResolvedValue({
      success: true,
      name: "Legacy Run Variant",
      description: "",
      steps: importedSteps,
    });

    const view = await renderPage("/pipelines/new?runPipelineId=pipe-run-legacy");

    await waitFor(() => {
      expect(mocks.getRunPipelineSteps).toHaveBeenCalledWith("pipe-run-legacy");
      expect(mocks.loadPipeline).toHaveBeenCalledWith(importedSteps, "Legacy Run Variant");
      expect(mocks.toastSuccess).toHaveBeenCalledWith("Legacy run snapshot loaded", {
        description: "3 steps loaded from an expanded executed snapshot, not the original template.",
      });
    });

    await view.unmount();
  });
});
