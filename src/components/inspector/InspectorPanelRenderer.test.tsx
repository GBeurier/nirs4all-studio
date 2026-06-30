/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildInspectorFocusState } from "@/lib/inspector/focus";
import { buildInspectorPanelData } from "@/lib/inspector/panelData";
import type { InspectorChainSummary } from "@/types/inspector";

import {
  InspectorPanelRenderer,
  type InspectorPanelRendererProps,
  type InspectorPanelRendererQueries,
} from "./InspectorPanelRenderer";

vi.mock("@/hooks/useInspectorExport", () => ({
  useInspectorExport: () => ({
    exportAllVisiblePanelsPng: vi.fn(),
    exportDataAsCsv: vi.fn(),
    exportPanelAsPng: vi.fn(),
  }),
}));

vi.mock("./visualizations/RankingsTable", () => ({
  RankingsTable: ({ data }: { data: { rankings: unknown[] } }) => (
    <div data-testid="rankings-table">rankings:{data.rankings.length}</div>
  ),
}));
vi.mock("./visualizations/ScoreHistogram", () => ({
  ScoreHistogram: () => <div data-testid="score-histogram" />,
}));
vi.mock("./visualizations/PerformanceHeatmap", () => ({
  PerformanceHeatmap: () => <div data-testid="performance-heatmap" />,
}));
vi.mock("./visualizations/CandlestickChart", () => ({
  CandlestickChart: () => <div data-testid="candlestick-chart" />,
}));
vi.mock("./visualizations/PreprocessingImpact", () => ({
  PreprocessingImpact: () => <div data-testid="preprocessing-impact" />,
}));
vi.mock("./visualizations/HyperparameterSensitivity", () => ({
  HyperparameterSensitivity: () => <div data-testid="hyperparameter-sensitivity" />,
}));
vi.mock("./visualizations/BranchComparisonChart", () => ({
  BranchComparisonChart: () => <div data-testid="branch-comparison-chart" />,
}));
vi.mock("./visualizations/BranchTopologyDiagram", () => ({
  BranchTopologyDiagram: () => <div data-testid="branch-topology-diagram" />,
}));
vi.mock("./visualizations/PredVsObsChart", () => ({
  PredVsObsChart: () => <div data-testid="pred-vs-obs-chart" />,
}));
vi.mock("./visualizations/ResidualsChart", () => ({
  ResidualsChart: () => <div data-testid="residuals-chart" />,
}));
vi.mock("./visualizations/FoldStabilityChart", () => ({
  FoldStabilityChart: () => <div data-testid="fold-stability-chart" />,
}));
vi.mock("./visualizations/ConfusionMatrixChart", () => ({
  ConfusionMatrixChart: () => <div data-testid="confusion-matrix-chart" />,
}));
vi.mock("./visualizations/BiasVariance", () => ({
  BiasVariance: () => <div data-testid="bias-variance-chart" />,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function makeChain(overrides: Partial<InspectorChainSummary> = {}): InspectorChainSummary {
  return {
    chain_id: "chain-1",
    run_id: "run-1",
    pipeline_id: "pipeline-1",
    pipeline_name: "Pipeline 1",
    model_class: "PLSRegression",
    model_name: "PLS",
    preprocessings: null,
    preprocessing_steps: [],
    branch_path: [],
    source_index: null,
    metric: "r2",
    task_type: "regression",
    dataset_name: "Dataset 1",
    best_params: null,
    variant_params: null,
    cv_val_score: 0.82,
    cv_test_score: 0.78,
    cv_train_score: 0.91,
    cv_fold_count: 5,
    final_test_score: null,
    final_train_score: null,
    pipeline_status: "completed",
    ...overrides,
  };
}

function makeQueries(): InspectorPanelRendererQueries {
  return {
    scatter: { data: undefined, error: null, isLoading: false },
    foldStability: { data: undefined, error: null, isLoading: false },
    confusion: { data: undefined, error: null, isLoading: false },
    biasVariance: { data: undefined, error: null, isLoading: false },
    topology: { data: undefined, error: null, isLoading: false },
  };
}

function makeProps(chains: InspectorChainSummary[] = [makeChain()]): InspectorPanelRendererProps {
  const scoreColumn = "cv_val_score";
  return {
    panelType: "rankings",
    viewState: "visible",
    isMaximized: false,
    selectedCount: 0,
    actions: {
      onHide: vi.fn(),
      onMaximize: vi.fn(),
      onMinimize: vi.fn(),
      onRestore: vi.fn(),
    },
    filteredChainCount: chains.length,
    focusedChainCount: chains.length,
    visibleGroups: [],
    panelData: buildInspectorPanelData({
      chains,
      scoreColumn,
      selection: {
        heatmapXAxis: null,
        heatmapYAxis: null,
        selectedHyperParam: "",
      },
    }),
    focus: buildInspectorFocusState({
      chains,
      scoreColumn,
      selectedChainIds: new Set(),
      pinnedChainIds: new Set(),
      limit: 8,
    }),
    partition: "test",
    queries: makeQueries(),
    controls: {
      biasVarianceGroupBy: "model_class",
      onBiasVarianceGroupByChange: vi.fn(),
      onHeatmapXAxisChange: vi.fn(),
      onHeatmapYAxisChange: vi.fn(),
      onHyperParamChange: vi.fn(),
    },
  };
}

async function renderNode(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(node);
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

afterEach(() => {
  vi.clearAllMocks();
});

describe("InspectorPanelRenderer", () => {
  it("renders local rankings data through the shared InspectorPanel shell", async () => {
    const mounted = await renderNode(<InspectorPanelRenderer {...makeProps()} />);

    expect(mounted.container.querySelector('[data-panel-type="rankings"]')).not.toBeNull();
    expect(mounted.container.textContent).toContain("1 rows");
    expect(mounted.container.querySelector('[data-testid="rankings-table"]')?.textContent).toBe("rankings:1");

    await mounted.unmount();
  });

  it("renders result-analysis summary counters in the rankings header when provided", async () => {
    const mounted = await renderNode(
      <InspectorPanelRenderer
        {...makeProps()}
        resultAnalysisSummaryCounters={[
          {
            id: "leaderboard.total",
            source: "leaderboard",
            label: "Chains",
            value: 1,
            formattedValue: "1",
          },
          {
            id: "leaderboard.scored",
            source: "leaderboard",
            label: "Scored chains",
            value: 1,
            formattedValue: "1",
          },
        ]}
      />,
    );

    expect(mounted.container.textContent).toContain("Chains: 1");
    expect(mounted.container.textContent).toContain("Scored chains: 1");

    await mounted.unmount();
  });

  it("renders task notices before diagnostic chart content", async () => {
    const props = makeProps([makeChain({
      model_class: "RandomForestClassifier",
      model_name: "Random forest",
      task_type: "classification",
    })]);
    const mounted = await renderNode(
      <InspectorPanelRenderer
        {...props}
        panelType="scatter"
      />
    );

    expect(mounted.container.textContent).toContain("Predicted vs observed requires regression");
    expect(mounted.container.querySelector('[data-testid="pred-vs-obs-chart"]')).toBeNull();

    await mounted.unmount();
  });

  it("renders diagnostic query errors before async chart content", async () => {
    const props = makeProps();
    const mounted = await renderNode(
      <InspectorPanelRenderer
        {...props}
        panelType="branch_topology"
        queries={{
          ...props.queries,
          topology: {
            data: undefined,
            error: new Error("Topology service unavailable"),
            isLoading: false,
          },
        }}
      />,
    );

    expect(mounted.container.textContent).toContain("Topology service unavailable");
    expect(mounted.container.querySelector('[data-testid="branch-topology-diagram"]')).toBeNull();

    await mounted.unmount();
  });
});
