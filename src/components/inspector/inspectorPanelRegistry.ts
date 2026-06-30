import type { InspectorFocusState } from "@/lib/inspector/focus";
import {
  getInspectorTaskPanelNotice,
  getInspectorTopologyPanelNotice,
  type InspectorTaskPanelRequirement,
} from "@/lib/inspector/panelNotices";
import { getInspectorPanelRenderState, type InspectorPanelRenderState } from "@/lib/inspector/panelRenderState";
import type { InspectorPanelType } from "@/types/inspector";

export type InspectorPanelItemCountScope = "filtered" | "focused";
export type InspectorDiagnosticQueryKey = "scatter" | "foldStability" | "confusion" | "biasVariance" | "topology";

export interface InspectorPanelRendererConfig {
  panelType: InspectorPanelType;
  minHeight: string;
  itemCountScope: InspectorPanelItemCountScope;
  compactClassName?: string;
  diagnostic?: InspectorPanelDiagnosticConfig;
}

export type InspectorPanelDiagnosticConfig =
  | {
    kind: "task";
    queryKey: InspectorDiagnosticQueryKey;
    panelName: string;
    requiredTask: InspectorTaskPanelRequirement;
    errorFallback: string;
  }
  | {
    kind: "topology";
    queryKey: InspectorDiagnosticQueryKey;
    errorFallback: string;
  };

export const INSPECTOR_PANEL_RENDERER_CONFIGS: Record<InspectorPanelType, InspectorPanelRendererConfig> = {
  rankings: {
    panelType: "rankings",
    minHeight: "420px",
    itemCountScope: "filtered",
    compactClassName: "max-h-[560px] overflow-hidden",
  },
  heatmap: {
    panelType: "heatmap",
    minHeight: "420px",
    itemCountScope: "filtered",
  },
  histogram: {
    panelType: "histogram",
    minHeight: "360px",
    itemCountScope: "filtered",
  },
  candlestick: {
    panelType: "candlestick",
    minHeight: "360px",
    itemCountScope: "filtered",
  },
  preprocessing_impact: {
    panelType: "preprocessing_impact",
    minHeight: "360px",
    itemCountScope: "filtered",
  },
  hyperparameter: {
    panelType: "hyperparameter",
    minHeight: "420px",
    itemCountScope: "filtered",
  },
  branch_comparison: {
    panelType: "branch_comparison",
    minHeight: "360px",
    itemCountScope: "filtered",
  },
  branch_topology: {
    panelType: "branch_topology",
    minHeight: "420px",
    itemCountScope: "focused",
    diagnostic: {
      kind: "topology",
      queryKey: "topology",
      errorFallback: "Failed to load topology.",
    },
  },
  scatter: {
    panelType: "scatter",
    minHeight: "420px",
    itemCountScope: "focused",
    diagnostic: {
      kind: "task",
      queryKey: "scatter",
      panelName: "Predicted vs observed",
      requiredTask: "regression",
      errorFallback: "Failed to load scatter data.",
    },
  },
  residuals: {
    panelType: "residuals",
    minHeight: "420px",
    itemCountScope: "focused",
    diagnostic: {
      kind: "task",
      queryKey: "scatter",
      panelName: "Residuals",
      requiredTask: "regression",
      errorFallback: "Failed to load residual data.",
    },
  },
  fold_stability: {
    panelType: "fold_stability",
    minHeight: "360px",
    itemCountScope: "focused",
    diagnostic: {
      kind: "task",
      queryKey: "foldStability",
      panelName: "Fold stability",
      requiredTask: "regression",
      errorFallback: "Failed to load fold stability.",
    },
  },
  confusion: {
    panelType: "confusion",
    minHeight: "420px",
    itemCountScope: "focused",
    diagnostic: {
      kind: "task",
      queryKey: "confusion",
      panelName: "Confusion matrix",
      requiredTask: "classification",
      errorFallback: "Failed to load confusion matrix.",
    },
  },
  bias_variance: {
    panelType: "bias_variance",
    minHeight: "360px",
    itemCountScope: "focused",
    diagnostic: {
      kind: "task",
      queryKey: "biasVariance",
      panelName: "Bias-variance",
      requiredTask: "regression",
      errorFallback: "Failed to load bias-variance data.",
    },
  },
};

export interface InspectorPanelItemCountInput {
  filteredChainCount: number;
  focusedChainCount: number;
}

export function getInspectorPanelItemCount(
  config: InspectorPanelRendererConfig,
  counts: InspectorPanelItemCountInput,
): number {
  return config.itemCountScope === "focused"
    ? counts.focusedChainCount
    : counts.filteredChainCount;
}

export function getInspectorPanelClassName(
  config: InspectorPanelRendererConfig,
  isMaximized: boolean,
): string | undefined {
  if (isMaximized) return undefined;
  return config.compactClassName;
}

export interface InspectorPanelDiagnosticRenderStateInput {
  config: InspectorPanelRendererConfig;
  focus: Pick<InspectorFocusState, "chainIds" | "task" | "topologyPipelineId">;
  error: unknown;
}

export function getInspectorPanelDiagnosticRenderState({
  config,
  focus,
  error,
}: InspectorPanelDiagnosticRenderStateInput): InspectorPanelRenderState {
  const diagnostic = config.diagnostic;
  if (!diagnostic) {
    return { kind: "ready" };
  }

  const notice = diagnostic.kind === "topology"
    ? getInspectorTopologyPanelNotice(focus.topologyPipelineId)
    : getInspectorTaskPanelNotice({
      panelName: diagnostic.panelName,
      requiredTask: diagnostic.requiredTask,
      focus,
    });

  return getInspectorPanelRenderState({
    notice,
    error,
    errorFallback: diagnostic.errorFallback,
  });
}
