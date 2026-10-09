import type { TFunction } from "i18next";
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
    panelNameKey: string;
    requiredTask: InspectorTaskPanelRequirement;
    errorFallbackKey: string;
  }
  | {
    kind: "topology";
    queryKey: InspectorDiagnosticQueryKey;
    errorFallbackKey: string;
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
      errorFallbackKey: "inspector.errors.topology",
    },
  },
  scatter: {
    panelType: "scatter",
    minHeight: "420px",
    itemCountScope: "focused",
    diagnostic: {
      kind: "task",
      queryKey: "scatter",
      panelNameKey: "inspector.panelDefs.scatter.name",
      requiredTask: "regression",
      errorFallbackKey: "inspector.errors.scatter",
    },
  },
  residuals: {
    panelType: "residuals",
    minHeight: "420px",
    itemCountScope: "focused",
    diagnostic: {
      kind: "task",
      queryKey: "scatter",
      panelNameKey: "inspector.panelDefs.residuals.name",
      requiredTask: "regression",
      errorFallbackKey: "inspector.errors.residuals",
    },
  },
  fold_stability: {
    panelType: "fold_stability",
    minHeight: "360px",
    itemCountScope: "focused",
    diagnostic: {
      kind: "task",
      queryKey: "foldStability",
      panelNameKey: "inspector.panelDefs.fold_stability.name",
      requiredTask: "regression",
      errorFallbackKey: "inspector.errors.foldStability",
    },
  },
  confusion: {
    panelType: "confusion",
    minHeight: "420px",
    itemCountScope: "focused",
    diagnostic: {
      kind: "task",
      queryKey: "confusion",
      panelNameKey: "inspector.panelDefs.confusion.name",
      requiredTask: "classification",
      errorFallbackKey: "inspector.errors.confusion",
    },
  },
  bias_variance: {
    panelType: "bias_variance",
    minHeight: "360px",
    itemCountScope: "focused",
    diagnostic: {
      kind: "task",
      queryKey: "biasVariance",
      panelNameKey: "inspector.panelDefs.bias_variance.name",
      requiredTask: "regression",
      errorFallbackKey: "inspector.errors.biasVariance",
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
  t: TFunction;
}

export function getInspectorPanelDiagnosticRenderState({
  config,
  focus,
  error,
  t,
}: InspectorPanelDiagnosticRenderStateInput): InspectorPanelRenderState {
  const diagnostic = config.diagnostic;
  if (!diagnostic) {
    return { kind: "ready" };
  }

  const notice = diagnostic.kind === "topology"
    ? getInspectorTopologyPanelNotice(focus.topologyPipelineId, t)
    : getInspectorTaskPanelNotice({
      panelName: t(diagnostic.panelNameKey),
      requiredTask: diagnostic.requiredTask,
      focus,
      t,
    });

  return getInspectorPanelRenderState({
    notice,
    error,
    errorFallback: t(diagnostic.errorFallbackKey),
  });
}
