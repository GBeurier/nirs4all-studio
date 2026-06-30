import type { InspectorFocusState } from "@/lib/inspector/focus";
import type {
  BiasVarianceRequest,
  BranchTopologyRequest,
  ConfusionMatrixRequest,
  FoldStabilityRequest,
  InspectorPanelType,
  ScatterRequest,
  ScoreColumn,
  ScoreRef,
} from "@/types/inspector";

export interface InspectorPanelQueryInputs {
  scatter: ScatterRequest | null;
  foldStability: FoldStabilityRequest | null;
  confusion: ConfusionMatrixRequest | null;
  biasVariance: BiasVarianceRequest | null;
  topology: BranchTopologyRequest | null;
}

export interface BuildInspectorPanelQueryInputsOptions {
  activePanels: ReadonlySet<InspectorPanelType>;
  focus: Pick<InspectorFocusState, "chainIds" | "task" | "topologyPipelineId">;
  partition: string;
  targetIndex?: number;
  scoreColumn: ScoreColumn;
  scoreRef?: ScoreRef | null;
  biasVarianceGroupBy: string;
}

function hasFocusedChains(focus: Pick<InspectorFocusState, "chainIds">): boolean {
  return focus.chainIds.length > 0;
}

function isActive(activePanels: ReadonlySet<InspectorPanelType>, panel: InspectorPanelType): boolean {
  return activePanels.has(panel);
}

function buildScoreRequestPayload(
  scoreColumn: ScoreColumn,
  scoreRef: ScoreRef | null | undefined,
): { score_column: ScoreColumn; score_ref?: ScoreRef } {
  return scoreRef == null
    ? { score_column: scoreColumn }
    : { score_column: scoreColumn, score_ref: scoreRef };
}

export function buildInspectorPanelQueryInputs({
  activePanels,
  focus,
  partition,
  targetIndex = 0,
  scoreColumn,
  scoreRef,
  biasVarianceGroupBy,
}: BuildInspectorPanelQueryInputsOptions): InspectorPanelQueryInputs {
  const hasChains = hasFocusedChains(focus);
  const canQueryRegressionFocus = focus.task === "regression" && hasChains;
  const canQueryClassificationFocus = focus.task === "classification" && hasChains;
  const scoreRequestPayload = buildScoreRequestPayload(scoreColumn, scoreRef);
  const targetRequestPayload = targetIndex > 0 ? { target_index: targetIndex } : {};

  return {
    scatter: (isActive(activePanels, "scatter") || isActive(activePanels, "residuals")) && canQueryRegressionFocus
      ? { chain_ids: focus.chainIds, partition, ...targetRequestPayload }
      : null,
    foldStability: isActive(activePanels, "fold_stability") && canQueryRegressionFocus
      ? { chain_ids: focus.chainIds, ...scoreRequestPayload, partition }
      : null,
    confusion: isActive(activePanels, "confusion") && canQueryClassificationFocus
      ? { chain_ids: focus.chainIds, partition, ...targetRequestPayload }
      : null,
    biasVariance: isActive(activePanels, "bias_variance") && canQueryRegressionFocus
      ? { chain_ids: focus.chainIds, ...scoreRequestPayload, group_by: biasVarianceGroupBy }
      : null,
    topology: isActive(activePanels, "branch_topology") && focus.topologyPipelineId
      ? { pipeline_id: focus.topologyPipelineId, ...scoreRequestPayload }
      : null,
  };
}
